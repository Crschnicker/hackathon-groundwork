// Two checks, both must pass before the snapshot or the graph is trusted:
//   1. files  — data/*.csv matches the manifest and contains nothing that looks like PII
//   2. graph  — Neo4j holds exactly what plan.ts says it should, and the smoke queries answer
//
//   npm run verify                     both
//   npm run verify -- --files-only     only the CSV checks (no database needed)
//
// Optional: LEAK_CHECK_TERMS="Some Name,Some Street" (in .env or the shell, never committed) —
// real names you know are in the source; any hit in data/ fails the check.
import fs from 'node:fs';
import path from 'node:path';
import { closeDriver, run, verifyConnectivity } from '../src/driver.ts';
import { dataDir } from '../src/env.ts';
import { getFactorCodeKit, searchItems } from '../src/queries/items.ts';
import { buildPlan, parsePlanOptions, readManifest, readTable, type PlanOptions } from './plan.ts';
import { decodeLegacy, EMAIL_RE, PHONE_RE } from './scrub.ts';

const argv = process.argv.slice(2);
let failures = 0;

function check(ok: boolean, message: string, detail?: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}${detail ? `  — ${detail}` : ''}`);
}

const FORBIDDEN_COLUMNS = ['password_hash', 'reset_token', 'reset_token_expiration', 'last_login', 'ip_address'];
// Reference data published by the state / typed from supplier catalogs: a "phone-shaped"
// number in there is a part number, not a contact.
const CATALOG_TABLES = new Set(['inventory', 'factor_code', 'factor_code_items', 'conversion_code', 'inventory_conversion_code', 'inventory_cross_reference']);

function verifyFiles(): void {
  console.log('Files (data/*.csv)');
  const manifest = readManifest();
  const terms = (process.env.LEAK_CHECK_TERMS ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3);

  const hits = { email: new Map<string, number>(), phone: new Map<string, number>(), term: new Map<string, number>() };
  const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
  let rowMismatch = 0;
  let forbidden = 0;
  let cells = 0;

  for (const [table, info] of Object.entries(manifest.tables)) {
    for (const f of info.files) if (!fs.existsSync(path.join(dataDir, f))) check(false, `${f} is listed in the manifest but missing`);
    const rows = readTable(manifest, table);
    if (rows.length !== info.rows) {
      rowMismatch++;
      check(false, `${table}: ${rows.length} rows on disk, manifest says ${info.rows}`);
    }
    forbidden += info.columns.filter((c) => FORBIDDEN_COLUMNS.includes(c)).length;

    for (const row of rows) {
      for (const [column, raw] of Object.entries(row)) {
        if (raw === '' || info.types[column] !== 'string') continue;
        cells++;
        const value = decodeLegacy(raw);
        for (const e of value.match(EMAIL_RE) ?? []) if (!e.toLowerCase().endsWith('@example.com')) bump(hits.email, `${table}.${column}`);
        if (!CATALOG_TABLES.has(table)) {
          for (const p of value.match(PHONE_RE) ?? []) if (!/^555-01\d\d$/.test(p)) bump(hits.phone, `${table}.${column}`);
        }
        if (terms.length) {
          const lower = value.toLowerCase();
          for (const t of terms) if (lower.includes(t)) bump(hits.term, `${table}.${column}`);
        }
      }
    }
  }

  const where = (m: Map<string, number>): string => [...m].map(([k, n]) => `${k} ×${n}`).join(', ');
  check(rowMismatch === 0, `${Object.keys(manifest.tables).length} tables present with the row counts in the manifest`);
  check(forbidden === 0, 'no credential / login / IP columns');
  check(hits.email.size === 0, 'no email addresses other than @example.com', where(hits.email));
  check(hits.phone.size === 0, 'no phone numbers other than 555-01xx', where(hits.phone));
  if (terms.length) check(hits.term.size === 0, `none of the ${terms.length} LEAK_CHECK_TERMS appear`, where(hits.term));
  else console.log('  skip  LEAK_CHECK_TERMS not set (optional: real names you know, to prove they are gone)');

  const users = readTable(manifest, 'user');
  check(users.every((u) => (u.email ?? '').endsWith('@example.com')), `all ${users.length} user emails are @example.com`);
  console.log(`  (${cells.toLocaleString()} text cells scanned)`);

  for (const f of fs.readdirSync(dataDir)) {
    const size = fs.statSync(path.join(dataDir, f)).size;
    if (size > 95 * 1024 * 1024) check(false, `${f} is ${(size / 1e6).toFixed(0)} MB — over GitHub's 100 MB limit`);
  }
}

async function verifyGraph(): Promise<void> {
  console.log('\nGraph (Neo4j)');
  await verifyConnectivity();

  // Default to the options the graph was loaded with.
  let options: PlanOptions = parsePlanOptions(argv);
  const meta = (await run<{ catalogOnly: boolean | null; maxBids: number | null }>(
    "MATCH (m:GroundworkMeta {key: 'snapshot'}) RETURN m.catalogOnly AS catalogOnly, m.maxBids AS maxBids",
  ))[0];
  if (!meta) {
    check(false, 'the graph has no GroundworkMeta node — run `npm run load -- --reset` first');
    return;
  }
  if (!argv.includes('--catalog-only') && !argv.includes('--max-bids')) {
    options = { ...(meta.catalogOnly ? { catalogOnly: true } : {}), ...(meta.maxBids === null ? {} : { maxBids: meta.maxBids }) };
  }
  if (options.catalogOnly || options.maxBids !== undefined) console.log(`  (graph was loaded with ${JSON.stringify(options)})`);

  const plan = buildPlan(options);

  const labels = await run<{ label: string; n: number }>('MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS n');
  const types = await run<{ type: string; n: number }>('MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS n');
  const actualLabels = new Map(labels.map((r) => [r.label, r.n]));
  const actualTypes = new Map(types.map((r) => [r.type, r.n]));

  for (const [label, expected] of Object.entries(plan.totals.byLabel)) {
    check(actualLabels.get(label) === expected, `(:${label}) ${expected}`, actualLabels.get(label) === expected ? undefined : `found ${actualLabels.get(label) ?? 0}`);
  }
  for (const [type, expected] of Object.entries(plan.totals.byType)) {
    check(actualTypes.get(type) === expected, `[:${type}] ${expected}`, actualTypes.get(type) === expected ? undefined : `found ${actualTypes.get(type) ?? 0}`);
  }
  for (const label of actualLabels.keys()) {
    if (!(label in plan.totals.byLabel)) console.log(`  note  (:${label}) ${actualLabels.get(label)} nodes are not from the snapshot (created by the app)`);
  }
  const nodes = [...actualLabels.values()].reduce((a, b) => a + b, 0);
  const rels = [...actualTypes.values()].reduce((a, b) => a + b, 0);
  console.log(`  total ${nodes.toLocaleString()} nodes / ${rels.toLocaleString()} relationships (AuraDB Free allows 200,000 / 400,000)`);

  console.log('\nSmoke queries');
  const kitCode = (await run<{ code: string }>('MATCH (f:FactorCode)-[:INCLUDES]->(:Item) RETURN f.code AS code, count(*) AS n ORDER BY n DESC LIMIT 1'))[0]?.code;
  const kit = kitCode ? await getFactorCodeKit(kitCode) : [];
  check(kit.length > 0, 'factor-code kit query returns rows', kitCode ? `code ${kitCode}: ${kit.length} items, ${kit[0]?.laborHours ?? '?'} labor hours` : 'no factor code has items');

  const found = await searchItems({ q: 'juniper', limit: 5 });
  check(found.length > 0, 'item search "juniper" returns rows', found[0] ? `${found[0].partNumber} ${found[0].description ?? ''}` : undefined);

  const typeRows = await run<{ label: string; n: number }>('MATCH (i:Item)-[:OF_TYPE]->(t:ItemType) RETURN t.label AS label, count(i) AS n ORDER BY n DESC LIMIT 5');
  check(typeRows.length > 0, 'items are linked to types', typeRows.map((r) => `${r.label} ${r.n}`).join(', '));

  if (!options.catalogOnly) {
    const taxed = (await run<{ n: number }>('MATCH (:Project)-[:TAXED_AT]->(:CityTax) RETURN count(*) AS n'))[0]?.n ?? 0;
    check(taxed > 0, 'projects resolve to a city tax rate', `${taxed} projects`);
    const lines = (await run<{ n: number; total: number }>('MATCH (:Bid)-[l:HAS_LINE]->(:Item) RETURN count(l) AS n, sum(l.lineExtCost) AS total'))[0];
    check((lines?.n ?? 0) > 0, 'bid lines carry their numbers', `${lines?.n ?? 0} lines, $${Math.round(lines?.total ?? 0).toLocaleString()} extended cost`);
  }
}

try {
  verifyFiles();
  if (!argv.includes('--files-only')) await verifyGraph();
} catch (err) {
  failures++;
  console.error(`\nVerify crashed: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await closeDriver();
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
