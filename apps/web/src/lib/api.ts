// Typed fetch wrapper for the Groundwork API (apps/api).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, `Can't reach the API at ${API_URL}. Is \`npm run dev\` running?`);
  }
  const body: unknown = await res.json().catch(() => null);
  // /health answers 503 with a useful body when Neo4j is down — let the caller read it.
  if (!res.ok && !(path === "/health" && body)) {
    const err = body as { error?: string; details?: unknown } | null;
    throw new ApiError(res.status, err?.error ?? `Request failed (${res.status})`, err?.details);
  }
  return body as T;
}

export interface Item {
  partNumber: string;
  description: string | null;
  type: string | null;
  typeLabel: string | null;
  unit: string | null;
  size: string | null;
  cost: number | null;
  salePrice: number | null;
  factorCode: string | null;
}

export interface ItemType {
  code: string;
  label: string;
  itemCount: number;
}

export interface FactorCodeKit {
  code: string;
  description: string | null;
  laborHours: number | null;
  items: {
    partNumber: string;
    description: string | null;
    quantity: number | null;
    unit: string | null;
    cost: number | null;
    salePrice: number | null;
    bestVendorPrice: number | null;
  }[];
}

export type ProviderName = "openrouter" | "crusoe";

export interface Health {
  status: "ok" | "degraded";
  neo4j: string;
  llm: Record<ProviderName, string>;
  plaud: string;
}

export interface Provider {
  name: ProviderName;
  label: string;
  configured: boolean;
  defaultModel: string;
  isDefault: boolean;
}

export interface SiteModel {
  areas: {
    name: string;
    existingFeatures: { feature: string; condition: string | null }[];
    measurements: {
      subject: string;
      lengthFt: number | null;
      widthFt: number | null;
      areaSqFt: number | null;
      asSpoken: string | null;
    }[];
    conditions: { sun: string | null; slope: string | null; drainage: string | null; notes: string | null };
    removals: { item: string; quantity: number | null; reason: string | null }[];
    proposedChanges: { change: string; category: string; material: string | null }[];
  }[];
  clientPreferences: string[];
  missing: { area: string | null; question: string }[];
}

export interface SiteModelResult {
  siteModel: SiteModel;
  meta: { provider: ProviderName; model: string; latencyMs: number };
}

export const api = {
  health: () => request<Health>("/health"),
  providers: () => request<{ providers: Provider[] }>("/api/llm/providers"),
  itemTypes: () => request<{ types: ItemType[] }>("/api/item-types"),
  searchItems: (params: { q: string; type?: string; limit?: number }, signal?: AbortSignal) => {
    const query = new URLSearchParams({ q: params.q, limit: String(params.limit ?? 25) });
    if (params.type) query.set("type", params.type);
    return request<{ count: number; items: Item[] }>(`/api/items?${query}`, { signal });
  },
  factorCode: (code: string) => request<FactorCodeKit>(`/api/factor-codes/${encodeURIComponent(code)}`),
  extractSiteModel: (transcript: string, provider?: ProviderName) =>
    request<SiteModelResult>("/api/site-model/extract", {
      method: "POST",
      body: JSON.stringify({ transcript, ...(provider ? { provider } : {}) }),
    }),
};
