// Typed fetch wrapper for the Groundwork API (apps/api).
// Requests go to this page's own origin; next.config.ts forwards /api/* and /health to the API.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    /** The request never reached the API: it is down, or the network is. */
    public unreachable = false,
  ) {
    super(message);
  }

  /** The walk endpoints want the shared walk token and did not get the right one. */
  get needsToken(): boolean {
    return this.status === 401;
  }
}

export const UNREACHABLE_MESSAGE = "Groundwork can't reach its server.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, UNREACHABLE_MESSAGE, undefined, true);
  }
  const body: unknown = await res.json().catch(() => null);
  // /health answers 503 with a useful body when Neo4j is down — let the caller read it.
  if (!res.ok && !(path === "/health" && body)) {
    const err = body as { error?: string; details?: unknown } | null;
    if (err?.error) throw new ApiError(res.status, err.error, err.details);
    // The API always answers in JSON, so a bare 5xx came from the proxy in front of it.
    if (res.status >= 500) throw new ApiError(res.status, UNREACHABLE_MESSAGE, undefined, true);
    throw new ApiError(res.status, `The server refused the request (${res.status}).`);
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

export type Sun = "full_sun" | "part_sun" | "part_shade" | "full_shade";
export type ChangeCategory = "removal" | "hardscape" | "plants" | "irrigation" | "drainage" | "lighting" | "other";

export interface SiteArea {
  name: string;
  existingFeatures: { feature: string; condition: string | null }[];
  measurements: {
    subject: string;
    lengthFt: number | null;
    widthFt: number | null;
    areaSqFt: number | null;
    asSpoken: string | null;
  }[];
  conditions: { sun: Sun | string | null; slope: string | null; drainage: string | null; notes: string | null };
  removals: { item: string; quantity: number | null; reason: string | null }[];
  proposedChanges: { change: string; category: ChangeCategory | string; material: string | null }[];
}

export interface OpenQuestion {
  area: string | null;
  question: string;
}

export interface SiteModel {
  areas: SiteArea[];
  clientPreferences: string[];
  missing: OpenQuestion[];
}

export interface SiteModelMeta {
  provider: ProviderName;
  model: string;
  latencyMs: number;
}

export interface SiteModelResult {
  siteModel: SiteModel;
  meta: SiteModelMeta;
}

// Walks: a site walk recorded on the phone in short recordings, transcribed as it goes.

export type WalkStatus = "active" | "finished";
export type RecordingStatus = "received" | "uploading" | "transcribing" | "done" | "failed";

export interface WalkSummary {
  id: string;
  userId: string;
  status: WalkStatus;
  /** Epoch milliseconds. */
  createdAt: number;
  /** How many recordings have arrived. */
  chunks: number;
}

export interface WalkRecording {
  key: string;
  /** Epoch seconds the recording started on the device. */
  startedAt: number | null;
  bytes: number;
  gapMs: number | null;
  status: RecordingStatus;
  error: string | null;
  transcript: string | null;
  durationSec: number | null;
  /** Milliseconds from the recording arriving to its transcript being ready. */
  latencyMs: number | null;
}

export interface Walk {
  id: string;
  userId: string;
  status: WalkStatus;
  cutSeconds: number;
  createdAt: number;
  finishedAt: number | null;
  counts: { total: number; done: number; failed: number; inFlight: number };
  /** True once the walk is finished and nothing is left to transcribe or extract. */
  settled: boolean;
  transcript: string;
  siteModel: SiteModel | null;
  siteModelMeta: SiteModelMeta | null;
  siteModelError: string | null;
  siteModelUpdatedAt: number | null;
  /** "live" while the walk is in progress; "final" once extracted from the whole finished walk. */
  siteModelPass: "live" | "final" | null;
  /** False while newer transcripts exist than the ones the site model was built from. */
  siteModelCurrent: boolean;
  chunks: WalkRecording[];
}

/** The server puts this in a transcript where a recording has not been transcribed yet. */
export const TRANSCRIPT_GAP = "[part of the recording is not transcribed yet]";

// The walk endpoints take a shared token when the server has one set (it is reached through a
// public tunnel). The phone has it typed in; the browser keeps it here once it has been entered.
const WALK_TOKEN_KEY = "groundwork.walkToken";

export function getWalkToken(): string {
  try {
    return window.localStorage.getItem(WALK_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setWalkToken(token: string): void {
  try {
    if (token.trim()) window.localStorage.setItem(WALK_TOKEN_KEY, token.trim());
    else window.localStorage.removeItem(WALK_TOKEN_KEY);
  } catch {
    // Private browsing: the token lasts until the page is closed, which is fine.
  }
}

function walkHeaders(): HeadersInit {
  const token = typeof window === "undefined" ? "" : getWalkToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>("/health", { signal }),
  providers: () => request<{ providers: Provider[] }>("/api/llm/providers"),
  itemTypes: () => request<{ types: ItemType[] }>("/api/item-types"),
  searchItems: (params: { q: string; type?: string; limit?: number }, signal?: AbortSignal) => {
    const query = new URLSearchParams({ q: params.q, limit: String(params.limit ?? 25) });
    if (params.type) query.set("type", params.type);
    return request<{ count: number; total?: number; items: Item[] }>(`/api/items?${query}`, { signal });
  },
  factorCode: (code: string) => request<FactorCodeKit>(`/api/factor-codes/${encodeURIComponent(code)}`),
  extractSiteModel: (transcript: string, provider?: ProviderName, signal?: AbortSignal) =>
    request<SiteModelResult>("/api/site-model/extract", {
      method: "POST",
      body: JSON.stringify({ transcript, ...(provider ? { provider } : {}) }),
      signal,
    }),
  walks: (signal?: AbortSignal) => request<WalkSummary[]>("/api/walks", { headers: walkHeaders(), signal }),
  walk: (id: string, signal?: AbortSignal) =>
    request<Walk>(`/api/walks/${encodeURIComponent(id)}`, { headers: walkHeaders(), signal }),
};
