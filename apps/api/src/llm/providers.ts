// The two LLM providers Groundwork talks to. Both speak the OpenAI chat-completions protocol,
// so one client (chat.ts) serves both; only base URL, key, default model and headers differ.
import { env } from '../env.ts';

export type ProviderName = 'openrouter' | 'crusoe';

export interface Provider {
  name: ProviderName;
  label: string;
  /** Name of the .env variable holding the key (for error messages). */
  keyVar: string;
  baseUrl: string;
  apiKey: string | undefined;
  defaultModel: string;
  /** Extra request headers (OpenRouter uses these for app attribution). */
  headers: Record<string, string>;
  /** Whether `response_format: {type: 'json_schema'}` is sent; otherwise JSON mode + prompt. */
  supportsJsonSchema: boolean;
}

export const PROVIDERS: Record<ProviderName, Provider> = {
  openrouter: {
    name: 'openrouter',
    label: 'OpenRouter',
    keyVar: 'OPENROUTER_API_KEY',
    baseUrl: env.OPENROUTER_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY,
    defaultModel: env.OPENROUTER_MODEL,
    headers: {
      'HTTP-Referer': 'https://github.com/Crschnicker/hackathon-groundwork',
      'X-OpenRouter-Title': 'Groundwork',
    },
    supportsJsonSchema: true,
  },
  crusoe: {
    name: 'crusoe',
    label: 'Crusoe Cloud',
    keyVar: 'CRUSOE_API_KEY',
    baseUrl: env.CRUSOE_BASE_URL,
    apiKey: env.CRUSOE_API_KEY,
    defaultModel: env.CRUSOE_MODEL,
    headers: {},
    supportsJsonSchema: false,
  },
};

export function isConfigured(p: Provider): boolean {
  return Boolean(p.apiKey);
}

/** Preferred provider first (LLM_PROVIDER), then the other one as fallback; unconfigured ones dropped. */
export function providerOrder(preferred: ProviderName = env.LLM_PROVIDER): Provider[] {
  const other: ProviderName = preferred === 'openrouter' ? 'crusoe' : 'openrouter';
  return [PROVIDERS[preferred], PROVIDERS[other]].filter(isConfigured);
}

/** Safe to return to the browser: never includes keys. */
export function describeProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    name: p.name,
    label: p.label,
    configured: isConfigured(p),
    defaultModel: p.defaultModel,
    isDefault: p.name === env.LLM_PROVIDER,
  }));
}
