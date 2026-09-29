// Neo4j driver singleton + small helpers. One driver per process; always close on exit.
import neo4j, { type Driver, type QueryResult, type RecordShape } from 'neo4j-driver';
import { env, requireEnv } from './env.ts';

let driver: Driver | undefined;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      requireEnv('NEO4J_URI'),
      neo4j.auth.basic(env.NEO4J_USERNAME, requireEnv('NEO4J_PASSWORD')),
      // Return plain JS numbers instead of the driver's Integer type.
      { disableLosslessIntegers: true },
    );
  }
  return driver;
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = undefined;
  }
}

/** Fails fast with a readable message when the DB is unreachable (paused Aura, bad creds…). */
export async function verifyConnectivity(): Promise<void> {
  await getDriver().verifyConnectivity({ database: env.NEO4J_DATABASE });
}

export type Params = Record<string, unknown>;

/** Run one query in a managed transaction and return the records as plain objects. */
export async function run<T extends RecordShape = RecordShape>(
  cypher: string,
  params: Params = {},
  opts: { write?: boolean } = {},
): Promise<T[]> {
  const result: QueryResult<T> = await getDriver().executeQuery<QueryResult<T>>(cypher, params, {
    database: env.NEO4J_DATABASE,
    routing: opts.write ? 'WRITE' : 'READ',
  });
  return result.records.map((r) => r.toObject() as T);
}

/** Run one query and return the first record, or undefined. */
export async function runOne<T extends RecordShape = RecordShape>(cypher: string, params: Params = {}, opts: { write?: boolean } = {}): Promise<T | undefined> {
  const rows = await run<T>(cypher, params, opts);
  return rows[0];
}

/**
 * Write helper for bulk loads: runs `cypher` once per batch with `$rows` bound to a slice.
 * Batches are small on purpose — Aura Free has a hard transaction-memory cap.
 */
export async function runBatches(
  cypher: string,
  rows: unknown[],
  batchSize = 2000,
  onBatch?: (done: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    await getDriver().executeQuery(cypher, { rows: slice }, { database: env.NEO4J_DATABASE, routing: 'WRITE' });
    onBatch?.(Math.min(i + batchSize, rows.length), rows.length);
  }
}
