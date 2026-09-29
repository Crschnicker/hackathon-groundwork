// Read-only connection to the source Postgres (only probe.ts and extract.ts use this).
import pg from 'pg';
import { requireEnv } from '../src/env.ts';
import type { ColumnType } from './tables.ts';

// Keep dates/timestamps as the text Postgres sends: no JS Date, no timezone shifting.
const DATE = 1082;
const TIMESTAMP = 1114;
const TIMESTAMPTZ = 1184;
for (const oid of [DATE, TIMESTAMP, TIMESTAMPTZ]) pg.types.setTypeParser(oid, (v) => v);
// bigint (count(*), sizes) → number
pg.types.setTypeParser(20, (v) => Number(v));

export async function connectSource(): Promise<pg.Client> {
  const url = new URL(requireEnv('DATABASE_URL'));
  // pg warns when sslmode is in the URL and an ssl object is passed; we always verify TLS.
  url.searchParams.delete('sslmode');
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    statement_timeout: 120_000,
    application_name: 'groundwork-extract',
  });
  await client.connect();
  // Belt and braces: this session cannot write even if a statement tried to.
  await client.query('SET default_transaction_read_only = on');
  return client;
}

/** Tables that exist in the public schema. */
export async function listTables(client: pg.Client): Promise<string[]> {
  const res = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  return res.rows.map((r) => r.table_name);
}

export interface ColumnInfo {
  name: string;
  /** information_schema data_type, e.g. "character varying", "double precision" */
  dataType: string;
}

export async function listColumns(client: pg.Client, table: string): Promise<ColumnInfo[]> {
  const res = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return res.rows.map((r) => ({ name: r.column_name, dataType: r.data_type }));
}

/** Collapse Postgres types into the handful the loader cares about. */
export function columnType(dataType: string): ColumnType {
  switch (dataType) {
    case 'smallint':
    case 'integer':
    case 'bigint':
      return 'int';
    case 'real':
    case 'double precision':
    case 'numeric':
      return 'float';
    case 'boolean':
      return 'bool';
    case 'date':
      return 'date';
    case 'timestamp without time zone':
    case 'timestamp with time zone':
      return 'datetime';
    default:
      return 'string';
  }
}
