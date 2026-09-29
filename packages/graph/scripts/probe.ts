// Read-only look at the source database → data/_source_stats.json.
// This is the sizing check for Aura Free (200k nodes / 400k relationships) and the place
// where schema drift shows up: tables or columns the scrub spec (tables.ts) does not know.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../src/env.ts';
import { columnType, connectSource, listColumns, listTables } from './source.ts';
import { TABLES, quoteIdent } from './tables.ts';

const client = await connectSource();
try {
  const version = (await client.query<{ v: string }>("SELECT current_setting('server_version') AS v")).rows[0]?.v ?? 'unknown';
  const dbSize = (await client.query<{ s: number }>('SELECT pg_database_size(current_database()) AS s')).rows[0]?.s ?? 0;

  const present = await listTables(client);
  const spec = new Map(TABLES.map((t) => [t.table, t]));

  const tables: Record<string, { rows: number; bytes: number; status: string; columns: Record<string, string> }> = {};
  for (const table of present) {
    const rows = (await client.query<{ n: number }>(`SELECT count(*) AS n FROM ${quoteIdent(table)}`)).rows[0]?.n ?? 0;
    const bytes =
      (await client.query<{ s: number }>('SELECT pg_total_relation_size($1::regclass) AS s', [`public.${quoteIdent(table)}`])).rows[0]?.s ?? 0;
    const columns = Object.fromEntries((await listColumns(client, table)).map((c) => [c.name, columnType(c.dataType)]));
    const t = spec.get(table);
    tables[table] = { rows, bytes, status: !t ? 'not in spec (ignored)' : t.exclude ? `excluded: ${t.exclude}` : 'exported', columns };
  }
  const missing = TABLES.filter((t) => !present.includes(t.table)).map((t) => t.table);

  const itemTypes = present.includes('inventory')
    ? (await client.query<{ type: string | null; n: number }>('SELECT type, count(*) AS n FROM inventory GROUP BY type ORDER BY n DESC')).rows
    : [];

  const stats = {
    probedAt: new Date().toISOString(),
    serverVersion: version,
    databaseBytes: dbSize,
    tables,
    missingFromSource: missing,
    inventoryTypes: itemTypes,
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, '_source_stats.json'), `${JSON.stringify(stats, null, 2)}\n`);

  console.log(`Postgres ${version}, ${(dbSize / 1e6).toFixed(0)} MB`);
  console.table(
    Object.entries(tables)
      .sort((a, b) => b[1].rows - a[1].rows)
      .map(([table, t]) => ({ table, rows: t.rows, MB: +(t.bytes / 1e6).toFixed(1), status: t.status })),
  );
  if (missing.length) console.warn(`In the spec but not in the source: ${missing.join(', ')}`);
  console.log(`Wrote ${path.join(dataDir, '_source_stats.json')}`);
} finally {
  await client.end();
}
