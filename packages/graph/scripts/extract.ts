// Postgres → scrubbed CSV snapshot in data/ (one file per table + _manifest.json).
// Read-only on the source. What is exported, dropped and anonymized is decided by tables.ts.
//
//   npm run extract
//
// Needs DATABASE_URL and SCRUB_SALT in .env. Teammates never need to run this: the snapshot is
// committed, and `npm run load` rebuilds the graph from it.
import { stringify } from 'csv-stringify/sync';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import Cursor from 'pg-cursor';
import { dataDir, requireEnv } from '../src/env.ts';
import { createScrubber, type LearnKind, type Scrubber } from './scrub.ts';
import { columnType, connectSource, listColumns, listTables } from './source.ts';
import { EXCLUDED_TABLES, EXPORTED_TABLES, quoteIdent, type ColumnType, type Manifest, type ScrubRule, type TableSpec } from './tables.ts';

const BATCH = 5000;
/** GitHub rejects files over 100 MB; roll to a new part well before that. */
const MAX_PART_BYTES = 45 * 1024 * 1024;
/** Catalog text defines which single words are ordinary vocabulary rather than names. */
const VOCABULARY_SOURCES: [table: string, column: string][] = [
  ['inventory', 'description'],
  ['factor_code', 'description'],
  ['conversion_code', 'description'],
];

type Row = Record<string, unknown>;

const LEARNED: Partial<Record<ScrubRule['kind'], LearnKind>> = {
  company: 'company',
  person: 'person',
  project: 'project',
  estimator: 'person',
  addr: 'addr',
  username: 'person',
};

async function readAll(client: pg.Client, sql: string, onRows: (rows: Row[]) => void): Promise<void> {
  const cursor = client.query(new Cursor<Row>(sql));
  try {
    for (;;) {
      const rows = await cursor.read(BATCH);
      if (rows.length === 0) break;
      onRows(rows);
    }
  } finally {
    await cursor.close();
  }
}

/** Pass 1: collect every real name/address so sweep() can find them inside free text. */
async function learnNames(client: pg.Client, scrubber: Scrubber, tables: TableSpec[], columnsOf: Map<string, string[]>): Promise<void> {
  const distinct = async (table: string, column: string, each: (v: string) => void): Promise<void> => {
    if (!columnsOf.get(table)?.includes(column)) return;
    const sql = `SELECT DISTINCT ${quoteIdent(column)} AS v FROM ${quoteIdent(table)} WHERE ${quoteIdent(column)} IS NOT NULL`;
    await readAll(client, sql, (rows) => {
      for (const r of rows) if (typeof r.v === 'string') each(r.v);
    });
  };

  // Places first: the tax table, then the city columns where nobody types names.
  await distinct('city_tax', 'city', (v) => scrubber.learnPlace(v));
  for (const t of tables) {
    for (const [column, rule] of Object.entries(t.scrub ?? {})) {
      if (rule.kind === 'city' && rule.trusted) await distinct(t.table, column, (v) => scrubber.learnPlace(v));
    }
  }
  // Whatever sits in the other city columns and is not a place is a contact name.
  for (const t of tables) {
    for (const [column, rule] of Object.entries(t.scrub ?? {})) {
      if (rule.kind !== 'city' || rule.trusted) continue;
      await distinct(t.table, column, (v) => {
        if (!scrubber.isPlace(v)) for (const name of v.split(/\s*[/&,]\s*|\s+-\s+/)) scrubber.learn('person', name);
      });
    }
  }

  for (const t of tables) {
    for (const [column, rule] of Object.entries(t.scrub ?? {})) {
      const kind = LEARNED[rule.kind];
      if (!kind || !columnsOf.get(t.table)?.includes(column)) continue;
      const sql = `SELECT DISTINCT ${quoteIdent(column)} AS v FROM ${quoteIdent(t.table)} WHERE ${quoteIdent(column)} IS NOT NULL`;
      await readAll(client, sql, (rows) => {
        for (const r of rows) if (typeof r.v === 'string') scrubber.learn(kind, r.v);
      });
    }
  }
  const vocabulary = new Set<string>();
  for (const [table, column] of VOCABULARY_SOURCES) {
    if (!columnsOf.get(table)?.includes(column)) continue;
    await readAll(client, `SELECT ${quoteIdent(column)} AS v FROM ${quoteIdent(table)} WHERE ${quoteIdent(column)} IS NOT NULL`, (rows) => {
      for (const r of rows) for (const w of String(r.v).toLowerCase().match(/[a-z]+/g) ?? []) vocabulary.add(w);
    });
  }
  scrubber.setCommonWords(vocabulary);
}

function applyRule(rule: ScrubRule, value: unknown, row: Row, scrubber: Scrubber, adminUserId: unknown): unknown {
  const text = value === null || value === undefined ? null : String(value);
  switch (rule.kind) {
    case 'company':
      return scrubber.company(text);
    case 'person':
      return scrubber.person(text);
    case 'project':
      return scrubber.project(text);
    case 'estimator':
      return scrubber.estimator(text);
    case 'phone':
      return scrubber.phone(text);
    case 'addr':
      return scrubber.addr(text);
    case 'sweep':
      return scrubber.sweep(text);
    case 'bidId':
      return scrubber.bidId(text);
    case 'city':
      return scrubber.city(text);
    case 'state':
      return scrubber.state(text);
    case 'zip':
      return scrubber.zip(text);
    case 'null':
      return null;
    case 'const':
      return text === null ? null : rule.value;
    case 'template':
      return text === null ? null : rule.template.replace(/\{(\w+)\}/g, (_m, col: string) => String(row[col] ?? ''));
    case 'email':
      return text === null || text.trim() === '' ? text : `${rule.prefix}${String(row[rule.idColumn])}@example.com`;
    case 'username':
      return row.id === adminUserId ? 'admin' : `user${String(row.id)}`;
  }
}

/** One CSV cell. Empty means NULL; the loader restores types from the manifest. */
function cell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null; // 'NaN'::float exists in the source
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value).replaceAll('\u0000', '');
  return s === 'NaN' ? null : s;
}

class PartWriter {
  private part = 0;
  private bytes = 0;
  private fd: number | undefined;
  readonly files: string[] = [];
  private readonly table: string;
  private readonly header: string;

  constructor(table: string, columns: string[]) {
    this.table = table;
    this.header = stringify([columns]);
  }

  private open(): void {
    this.part++;
    const name = `${this.table}.part-${this.part}.csv`;
    this.fd = fs.openSync(path.join(dataDir, name), 'w');
    this.files.push(name);
    this.bytes = fs.writeSync(this.fd, this.header);
  }

  write(chunk: string): void {
    if (this.fd === undefined || this.bytes + Buffer.byteLength(chunk) > MAX_PART_BYTES) {
      this.close();
      this.open();
    }
    if (this.fd !== undefined) this.bytes += fs.writeSync(this.fd, chunk);
  }

  private close(): void {
    if (this.fd !== undefined) fs.closeSync(this.fd);
    this.fd = undefined;
  }

  /** A table that fits in one file is simply <table>.csv. */
  finish(): string[] {
    if (this.files.length === 0) this.open(); // empty table → header-only file
    this.close();
    const only = this.files[0];
    if (this.files.length === 1 && only) {
      const name = `${this.table}.csv`;
      fs.renameSync(path.join(dataDir, only), path.join(dataDir, name));
      return [name];
    }
    return this.files;
  }
}

// ---------------------------------------------------------------------------------------------

const scrubber = createScrubber(requireEnv('SCRUB_SALT'));
const client = await connectSource();

try {
  const present = new Set(await listTables(client));
  const tables = EXPORTED_TABLES.filter((t) => present.has(t.table));

  const columnInfo = new Map<string, { name: string; type: ColumnType }[]>();
  for (const t of tables) {
    columnInfo.set(t.table, (await listColumns(client, t.table)).map((c) => ({ name: c.name, type: columnType(c.dataType) })));
  }
  const columnsOf = new Map([...columnInfo].map(([table, cols]) => [table, cols.map((c) => c.name)]));

  // A rule that names a column the source does not have is a typo or drift — say so.
  for (const t of tables) {
    const have = columnsOf.get(t.table) ?? [];
    const unknown = [...Object.keys(t.scrub ?? {}), ...(t.drop ?? []), ...t.key].filter((c) => !have.includes(c));
    if (unknown.length) console.warn(`  ! ${t.table}: spec mentions columns missing from the source: ${unknown.join(', ')}`);
  }

  console.log('Pass 1/2: learning names and addresses to sweep from free text…');
  await learnNames(client, scrubber, tables, columnsOf);
  console.log(`  learned ${scrubber.stats().learned} distinct values`);

  const admin = present.has('user')
    ? (await client.query<{ id: number }>('SELECT id FROM "user" ORDER BY is_super_admin DESC, is_admin DESC, id ASC LIMIT 1')).rows[0]?.id
    : undefined;

  fs.mkdirSync(dataDir, { recursive: true });
  for (const f of fs.readdirSync(dataDir)) if (f.endsWith('.csv')) fs.rmSync(path.join(dataDir, f));

  const manifest: Manifest = {
    extractedAt: new Date().toISOString(),
    source: 'Bid-Proposal-V2 Postgres (flask_bids), scrubbed',
    sourceVersion: (await client.query<{ v: string }>("SELECT current_setting('server_version') AS v")).rows[0]?.v ?? 'unknown',
    tables: {},
    excluded: Object.fromEntries([
      ...EXCLUDED_TABLES.map((t): [string, string] => [t.table, t.exclude ?? 'excluded']),
      ...EXPORTED_TABLES.filter((t) => !present.has(t.table)).map((t): [string, string] => [t.table, 'not present in the source database']),
    ]),
  };

  // table.column → how many verbatim cells still contain a learned name, email or phone number
  const audit = new Map<string, number>();

  console.log('Pass 2/2: exporting…');
  for (const t of tables) {
    const drop = new Set(t.drop ?? []);
    const cols = (columnInfo.get(t.table) ?? []).filter((c) => !drop.has(c.name));
    const names = cols.map((c) => c.name);
    const rules = t.scrub ?? {};
    const writer = new PartWriter(t.table, names);
    let count = 0;

    const orderBy = t.key.map(quoteIdent).join(', ');
    await readAll(client, `SELECT * FROM ${quoteIdent(t.table)} ORDER BY ${orderBy}`, (rows) => {
      const out = rows.map((row) =>
        names.map((name) => {
          const rule = rules[name];
          if (rule) return cell(applyRule(rule, row[name], row, scrubber, admin));
          const value = row[name];
          if (typeof value === 'string') {
            const hits = scrubber.detect(value);
            if (hits) audit.set(`${t.table}.${name}`, (audit.get(`${t.table}.${name}`) ?? 0) + 1);
          }
          return cell(value);
        }),
      );
      writer.write(stringify(out, { cast: { boolean: (v) => (v ? 'true' : 'false') } }));
      count += rows.length;
    });

    const files = writer.finish();
    manifest.tables[t.table] = { rows: count, columns: names, types: Object.fromEntries(cols.map((c) => [c.name, c.type])), files };
    console.log(`  ${t.table.padEnd(30)} ${String(count).padStart(7)} rows → ${files.join(', ')}`);
  }

  fs.writeFileSync(path.join(dataDir, '_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const s = scrubber.stats();
  console.log(`\nSwept from free text: ${s.sweptNames} names/addresses, ${s.sweptEmails} emails, ${s.sweptPhones} phone numbers`);
  for (const [table, why] of Object.entries(manifest.excluded)) console.log(`  skipped ${table}: ${why}`);

  if (process.env.SCRUB_DEBUG) console.table(scrubber.topMatches(Number(process.env.SCRUB_DEBUG) || 40));

  if (audit.size) {
    console.warn('\nAUDIT — verbatim columns whose text matches a known name, email or phone (rows):');
    for (const [column, rows] of [...audit].sort((a, b) => b[1] - a[1])) console.warn(`  ${column.padEnd(45)} ${rows}`);
    console.warn('Review these: add a rule in tables.ts, or confirm they are catalog/brand words.');
  } else {
    console.log('\nAUDIT — no verbatim column contains a known name, email or phone.');
  }
  console.log(`\nWrote ${Object.keys(manifest.tables).length} tables to ${dataDir}. Next: npm run verify -- --files-only`);
} finally {
  await client.end();
}
