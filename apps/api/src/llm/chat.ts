// One chat client for OpenRouter and Crusoe (OpenAI-compatible). Plain fetch, no SDK.
import { z } from 'zod';
import { HttpError } from '../http.ts';
import { logger } from '../logger.ts';
import { PROVIDERS, isConfigured, providerOrder, type Provider, type ProviderName } from './providers.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  /** Force one provider (no fallback). Default: LLM_PROVIDER, falling back to the other. */
  provider?: ProviderName;
  /** Provider-specific model id; only honoured together with `provider`. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** OpenAI-style response_format, passed through as-is. */
  responseFormat?: unknown;
  timeoutMs?: number;
}

export interface ChatResult {
  provider: ProviderName;
  model: string;
  content: string;
  usage: { promptTokens: number | null; completionTokens: number | null };
  latencyMs: number;
}

interface CompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

class ProviderError extends Error {
  provider: ProviderName;
  status: number;

  constructor(provider: ProviderName, status: number, message: string) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}

async function callProvider(p: Provider, opts: ChatOptions, model: string, responseFormat: unknown): Promise<ChatResult> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json', ...p.headers },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 8000,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });
  } catch (err) {
    throw new ProviderError(p.name, 504, `${p.label} request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const text = await res.text();
  let body: CompletionResponse = {};
  try {
    body = JSON.parse(text) as CompletionResponse;
  } catch {
    // non-JSON error page; handled below
  }
  if (!res.ok || body.error) {
    throw new ProviderError(p.name, res.status, `${p.label} ${res.status}: ${body.error?.message ?? text.slice(0, 300)}`);
  }
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new ProviderError(p.name, 502, `${p.label} returned an empty completion`);

  return {
    provider: p.name,
    model: body.model ?? model,
    content,
    usage: { promptTokens: body.usage?.prompt_tokens ?? null, completionTokens: body.usage?.completion_tokens ?? null },
    latencyMs: Date.now() - started,
  };
}

/** Try one provider; if it rejects `response_format` (400/422), retry once without it. */
async function callWithFormatRetry(p: Provider, opts: ChatOptions, model: string, responseFormat: unknown): Promise<ChatResult> {
  try {
    return await callProvider(p, opts, model, responseFormat);
  } catch (err) {
    if (responseFormat && err instanceof ProviderError && (err.status === 400 || err.status === 422)) {
      logger.warn({ provider: p.name, err: err.message }, 'response_format rejected; retrying without it');
      return callProvider(p, opts, model, undefined);
    }
    throw err;
  }
}

function candidates(opts: Pick<ChatOptions, 'provider'>): Provider[] {
  if (opts.provider) {
    const p = PROVIDERS[opts.provider];
    if (!isConfigured(p)) throw new HttpError(503, `${p.label} is not configured — set ${p.keyVar} in .env`);
    return [p];
  }
  const order = providerOrder();
  if (order.length === 0) throw new HttpError(503, 'No LLM provider configured — set OPENROUTER_API_KEY or CRUSOE_API_KEY in .env');
  return order;
}

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const errors: string[] = [];
  for (const p of candidates(opts)) {
    const model = opts.provider && opts.model ? opts.model : p.defaultModel;
    try {
      return await callWithFormatRetry(p, opts, model, opts.responseFormat);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ provider: p.name, model, err: message }, 'LLM call failed');
      errors.push(message);
    }
  }
  throw new HttpError(502, 'All LLM providers failed', errors);
}

/** Pull the JSON value out of a completion that may be wrapped in prose or code fences. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[{[]/);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (start === -1 || end <= start) throw new Error('no JSON found in completion');
  return JSON.parse(body.slice(start, end + 1));
}

export interface ChatJsonOptions<S extends z.ZodType> extends Omit<ChatOptions, 'responseFormat'> {
  schema: S;
  /** Name for the JSON schema (letters, digits, _). */
  schemaName: string;
}

/**
 * Chat that returns data validated against a zod schema. Providers with structured output get
 * the JSON schema; the others get JSON mode plus the schema in the prompt. Either way the
 * result is validated here, with one repair round-trip if validation fails.
 */
export async function chatJson<S extends z.ZodType>(
  opts: ChatJsonOptions<S>,
): Promise<{ data: z.infer<S>; meta: Omit<ChatResult, 'content'> }> {
  const jsonSchema = z.toJSONSchema(opts.schema);
  const schemaHint: ChatMessage = {
    role: 'system',
    content: `Reply with a single JSON object and nothing else. It must validate against this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
  };
  const errors: string[] = [];

  for (const p of candidates(opts)) {
    const model = opts.provider && opts.model ? opts.model : p.defaultModel;
    const responseFormat = p.supportsJsonSchema
      ? { type: 'json_schema', json_schema: { name: opts.schemaName, strict: true, schema: jsonSchema } }
      : { type: 'json_object' };
    let messages: ChatMessage[] = [schemaHint, ...opts.messages];

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await callWithFormatRetry(p, { ...opts, messages }, model, responseFormat);
        const parsed = opts.schema.safeParse(extractJson(result.content));
        if (parsed.success) {
          return {
            data: parsed.data,
            meta: { provider: result.provider, model: result.model, usage: result.usage, latencyMs: result.latencyMs },
          };
        }
        const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        errors.push(`${p.label} attempt ${attempt}: schema validation failed (${problems})`);
        messages = [
          ...messages,
          { role: 'assistant', content: result.content },
          { role: 'user', content: `That did not validate: ${problems}. Reply again with the corrected JSON object only.` },
        ];
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        break; // transport/provider error → next provider
      }
    }
    logger.warn({ provider: p.name, model }, 'structured LLM call failed; trying next provider');
  }
  throw new HttpError(502, 'No LLM provider returned valid structured output', errors);
}
