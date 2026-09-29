// data/*.csv → Neo4j. Rebuilds the whole graph from the committed snapshot; no Postgres needed.
//
//   npm run load -- --reset              wipe the database first, then load everything
//   npm run load                         load on top of what is there (idempotent: MERGE on keys)
//   npm run load -- --catalog-only       items, factor codes, vendors, tax, users only
//   npm run load -- --max-bids 200       catalog + the 200 most recent bids and what hangs off them
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDriver, getDriver, run, runBatches, verifyConnectivity } from '../src/driver.ts';
import { env } from '../src/env.ts';
import { buildPlan, parsePlanOptions, type Plan } from './plan.ts';

// AuraDB Free: 200k nodes / 400k relationships. Leave headroom for what the app itself creates.
const MAX_NODES = 190_000;
const MAX_RELS = 390_000;
// Small on purpose — Aura Free has a hard per-transaction memory cap.
const NODE_BATCH = 2000;
const REL_BATCH = 1000;

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

const ident = (name: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `\`${name}\``;
};

function progress(label: string): (done: number, total: number) => void {
  return (done, total) => {
    process.stdout.write(`\r  ${label.padEnd(58)} ${String(done).padStart(7)} / ${total}`);
    if (done === total) process.stdout.write('\n');
  };
}

async function reset(): Promise<void> {
  console.log('Wiping the database (--reset)…');
  // CALL … IN TRANSACTIONS needs an auto-commit transaction, hence a plain session.
  const session = getDriver().session({ database: env.NEO4J_DATABASE });
  try {
    await session.run('MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 5000 ROWS');
  } finally {
    await session.close();
  }
}

async function applyConstraints(): Promise<void> {
  const statements = fs
    .readFileSync(path.join(here, '../constraints.cypher'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await run(s, {}, { write: true });
  await run('CALL db.awaitIndexes(120)', {}, { write: true });
  console.log(`Applied ${statements.length} constraints and indexes`);
}

async function loadPlan(plan: Plan): Promise<void> {
  console.log('Nodes');
  for (const b of plan.nodes) {
    const cypher = `UNWIND $rows AS r MERGE (n:${ident(b.label)} {${ident(b.key)}: r.${ident(b.key)}}) SET n += r`;
    await runBatches(cypher, b.rows, NODE_BATCH, progress(`(:${b.label})`));
  }
  console.log('Relationships');
  for (const b of plan.rels) {
    const rel = b.byId ? `[x:${ident(b.type)} {id: r.id}]` : `[x:${ident(b.type)}]`;
    const cypher = `UNWIND $rows AS r
      MATCH (a:${ident(b.from.label)} {${ident(b.from.key)}: r.from})
      MATCH (b:${ident(b.to.label)} {${ident(b.to.key)}: r.to})
      MERGE (a)-${rel}->(b)
      SET x += r.props`;
    await runBatches(cypher, b.rows, REL_BATCH, progress(`(:${b.from.label})-[:${b.type}]->(:${b.to.label})  ← ${b.source}`));
  }
}

const started = Date.now();
try {
  const plan = buildPlan(parsePlanOptions(argv));
  console.log(`Snapshot extracted ${plan.manifest.extractedAt} — plan: ${plan.totals.nodes} nodes, ${plan.totals.rels} relationships`);

  if (plan.totals.nodes > MAX_NODES || plan.totals.rels > MAX_RELS) {
    throw new Error(
      `The plan exceeds the AuraDB Free limits (${MAX_NODES} nodes / ${MAX_RELS} relationships). ` +
        'Re-run with --max-bids N or --catalog-only.',
    );
  }

  await verifyConnectivity();
  if (argv.includes('--reset')) await reset();
  await applyConstraints();
  await loadPlan(plan);

  if (plan.notes.length) {
    console.log('\nNotes');
    for (const n of plan.notes) console.log(`  - ${n}`);
  }
  console.log(`\nLoaded in ${((Date.now() - started) / 1000).toFixed(0)}s. Next: npm run verify`);
} catch (err) {
  console.error(`\nLoad failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeDriver();
}
