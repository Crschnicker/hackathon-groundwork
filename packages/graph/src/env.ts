// Single place that loads the repo-root .env and validates it.
// Everything else (API, ETL scripts) imports `env` from here.
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Absolute path of the monorepo root (…/hackathon-groundwork). */
export const repoRoot = path.resolve(here, '../../..');
/** Committed, scrubbed CSV snapshot lives here. */
export const dataDir = path.join(repoRoot, 'data');

loadDotenv({ path: path.join(repoRoot, '.env'), quiet: true });

const schema = z.object({
  NEO4J_URI: z.string().min(1).optional(),
  NEO4J_USERNAME: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().optional(),
  NEO4J_DATABASE: z.string().default('neo4j'),
  DATABASE_URL: z.string().optional(),
  SCRUB_SALT: z.string().optional(),
  API_PORT: z.coerce.number().int().positive().default(4000),
});

export const env = schema.parse(process.env);

/** Throws a readable error when a script needs a var that isn't set. */
export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const v = env[key];
  if (v === undefined || v === '') {
    throw new Error(`${key} is not set — add it to ${path.join(repoRoot, '.env')} (see .env.example)`);
  }
  return v as NonNullable<(typeof env)[K]>;
}
