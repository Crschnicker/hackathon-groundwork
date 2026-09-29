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

  // LLM providers (both OpenAI-compatible). See apps/api/src/llm.
  LLM_PROVIDER: z.enum(['openrouter', 'crusoe']).default('openrouter'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL: z.string().default('openai/gpt-6.1-sol'),
  CRUSOE_API_KEY: z.string().optional(),
  CRUSOE_BASE_URL: z.string().default('https://api.inference.crusoecloud.com/v1'),
  CRUSOE_MODEL: z.string().default('zai-org/GLM-5.3-Flash'),

  // Plaud developer platform (Embedded SDK app). See apps/api/src/plaud.
  PLAUD_CLIENT_ID: z.string().optional(),
  PLAUD_SECRET_KEY: z.string().optional(),
  PLAUD_API_KEY: z.string().optional(),
  PLAUD_BASE_URL: z.string().default('https://platform-us.plaud.ai/developer/api'),

  // Shared secret for /api/walks, which the recorder reaches through a public tunnel. Unset = open.
  WALK_API_TOKEN: z.string().min(16).optional(),
});

// "KEY=" in .env means unset, so defaults apply.
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));

export const env = schema.parse(raw);

/** Throws a readable error when a script needs a var that isn't set. */
export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const v = env[key];
  if (v === undefined || v === '') {
    throw new Error(`${key} is not set — add it to ${path.join(repoRoot, '.env')} (see .env.example)`);
  }
  return v as NonNullable<(typeof env)[K]>;
}
