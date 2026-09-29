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
  /** Site photos taken on the walk, oldest first. Absent from the scripted sample walk. */
  photos?: WalkPhoto[];
  /** What to photograph, measure and ask on this walk; null until the first recording is read. */
  guide?: WalkGuide | null;
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

  // Walk photos. The image bytes need the walk token too, so an <img> cannot load them by URL:
  // photoBlob fetches one and the caller shows it through URL.createObjectURL.
  uploadPhoto: (
    walkId: string,
    image: Blob,
    opts: { key: string; takenAt: number; sectionId?: string; promptId?: string },
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({ key: opts.key, takenAt: String(Math.round(opts.takenAt)), source: "web" });
    if (opts.sectionId) query.set("sectionId", opts.sectionId);
    if (opts.promptId) query.set("promptId", opts.promptId);
    return request<WalkPhoto>(`/api/walks/${encodeURIComponent(walkId)}/photos?${query}`, {
      method: "POST",
      headers: { ...walkHeaders(), "Content-Type": image.type || "image/jpeg" },
      body: image,
      signal,
    });
  },
  photoBlob: (walkId: string, photoId: string, signal?: AbortSignal) =>
    requestBlob(`/api/walks/${encodeURIComponent(walkId)}/photos/${encodeURIComponent(photoId)}`, {
      headers: walkHeaders(),
      signal,
    }),
  updatePhoto: (walkId: string, photoId: string, change: { caption?: string | null; area?: string | null }) =>
    request<WalkPhoto>(`/api/walks/${encodeURIComponent(walkId)}/photos/${encodeURIComponent(photoId)}`, {
      method: "PATCH",
      headers: walkHeaders(),
      body: JSON.stringify(change),
    }),
  deletePhoto: (walkId: string, photoId: string) =>
    request<{ deleted: true }>(`/api/walks/${encodeURIComponent(walkId)}/photos/${encodeURIComponent(photoId)}`, {
      method: "DELETE",
      headers: walkHeaders(),
    }),

  // Proposals, for the architect. They take the walk token like the walks they are made from.
  generateProposal: (walkId: string, signal?: AbortSignal) =>
    request<Proposal>(`/api/walks/${encodeURIComponent(walkId)}/proposals`, {
      method: "POST",
      headers: walkHeaders(),
      body: "{}",
      signal,
    }),
  proposals: (signal?: AbortSignal) =>
    request<ProposalSummary[]>("/api/proposals", { headers: walkHeaders(), signal }),
  proposal: (id: string, signal?: AbortSignal) =>
    request<Proposal>(`/api/proposals/${encodeURIComponent(id)}`, { headers: walkHeaders(), signal }),
  saveProposal: (id: string, edit: ProposalEdit, signal?: AbortSignal) =>
    request<Proposal>(`/api/proposals/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: walkHeaders(),
      body: JSON.stringify(edit),
      signal,
    }),
  setProposalStatus: (id: string, status: ProposalStatus) =>
    request<Proposal>(`/api/proposals/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: walkHeaders(),
      body: JSON.stringify({ status }),
    }),
  deleteProposal: (id: string) =>
    request<{ deleted: true }>(`/api/proposals/${encodeURIComponent(id)}`, { method: "DELETE", headers: walkHeaders() }),

  // The client's side: no walk token, the share token in the link is the key.
  clientProposal: (token: string, signal?: AbortSignal) =>
    request<ClientProposal>(`/api/p/${encodeURIComponent(token)}`, { signal }),
  acceptProposal: (token: string, name: string) =>
    request<ClientProposal>(`/api/p/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  // The walk guide for a pasted walkthrough, without a walk behind it.
  guidePreview: (transcript: string, signal?: AbortSignal) =>
    request<{ guide: WalkGuide }>("/api/guide", {
      method: "POST",
      body: JSON.stringify({ transcript }),
      signal,
    }),
};

/** The client's copy of a photo: an ordinary URL, because the share token is in it. */
export const clientPhotoUrl = (token: string, photoId: string) =>
  `/api/p/${encodeURIComponent(token)}/photos/${encodeURIComponent(photoId)}`;

/** Like request, for an answer that is a file rather than JSON. */
async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, UNREACHABLE_MESSAGE, undefined, true);
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    if (err?.error) throw new ApiError(res.status, err.error);
    if (res.status >= 500) throw new ApiError(res.status, UNREACHABLE_MESSAGE, undefined, true);
    throw new ApiError(res.status, `The server refused the request (${res.status}).`);
  }
  return res.blob();
}

// Walk photos: taken on the phone during the walk (or added here), each tied to an area.

export interface WalkPhoto {
  id: string;
  key: string;
  /** Epoch ms the photo was taken. */
  takenAt: number;
  receivedAt: number;
  source: "phone" | "web";
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  caption: string | null;
  /** Name of the site model area the photo shows; null until it is known. */
  area: string | null;
  /** "auto" when Groundwork matched it from what was being said; "architect" once set by hand. */
  areaSource: "auto" | "architect" | null;
  /** What the architect was saying when the photo was taken, once that is transcribed. */
  spokenContext: string | null;
  /** The walk guide's section and photo prompt this photo answers; null for a free photo. */
  sectionId: string | null;
  promptId: string | null;
}

// Proposals: generated from a walk, reviewed by the architect, sent to the client. The shapes
// mirror apps/api/src/proposals/types.ts; the API's zod schemas decide what may be saved.

export type ProposalStatus = "draft" | "pending" | "won" | "lost";
export type LineCategory = ChangeCategory;

export interface ProposalLine {
  id: string;
  kind: "material" | "labor" | "custom";
  category: LineCategory;
  partNumber: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  /** Dollars per unit to the client; null until known. */
  unitPrice: number | null;
  priceSource: "catalog" | "labor_rate" | "architect" | null;
  /** How the quantity was arrived at. Architect only. */
  basis: string | null;
  /** What to check before sending. Architect only. */
  toConfirm: string | null;
}

export interface ProposalSection {
  id: string;
  area: string;
  summary: string;
  photoIds: string[];
  lines: ProposalLine[];
}

export interface ProposalEdit {
  title: string;
  client: { name: string; email: string; address: string };
  intro: string;
  sections: ProposalSection[];
  /** Sales tax on material lines as a fraction; null for none. */
  taxRate: number | null;
  terms: string;
  openQuestions: OpenQuestion[];
}

export interface ProposalTotals {
  sections: Record<string, number>;
  materials: number;
  labor: number;
  other: number;
  subtotal: number;
  tax: number;
  total: number;
  /** Lines left out of the sums for want of a quantity or a price. */
  unpriced: number;
}

export interface Proposal extends ProposalEdit {
  id: string;
  walkId: string;
  status: ProposalStatus;
  shareToken: string;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
  decidedAt: number | null;
  decidedBy: "client" | "architect" | null;
  acceptedName: string | null;
  generatedBy: { provider: string; model: string; latencyMs: number } | null;
  totals: ProposalTotals;
  /** The walk's photos, so the review screen can offer the ones not yet in a section. */
  photos: WalkPhoto[];
}

export interface ProposalSummary {
  id: string;
  walkId: string;
  title: string;
  clientName: string;
  status: ProposalStatus;
  total: number;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
  decidedAt: number | null;
}

/** What the client sees: no part numbers, cost basis, notes to self or open questions. */
export interface ClientProposal {
  title: string;
  client: { name: string; address: string };
  intro: string;
  status: Exclude<ProposalStatus, "draft">;
  sentAt: number | null;
  decidedAt: number | null;
  decidedBy: "client" | "architect" | null;
  acceptedName: string | null;
  sections: {
    id: string;
    area: string;
    summary: string;
    photos: { id: string; caption: string | null }[];
    lines: { id: string; description: string; quantity: number | null; unit: string | null; unitPrice: number | null; amount: number | null }[];
    subtotal: number;
  }[];
  totals: Pick<ProposalTotals, "subtotal" | "tax" | "total">;
  taxRate: number | null;
  terms: string;
}

// The walk guide: what kind of job this walk is, and section by section what to photograph,
// measure and ask. It is rewritten after each recording; sections keep their ids and order.

export interface GuidePhoto {
  /** Unique within its section, and stable. */
  id: string;
  /** What to photograph. */
  prompt: string;
  /** What the photo is for. */
  reason: string | null;
}

export interface GuideSection {
  /** Never changes once issued for a walk. */
  id: string;
  title: string;
  /** "heard" when the architect talked about it; "suggested" when this kind of job usually needs it. */
  source: "heard" | "suggested";
  /** Why the job needs a suggested section; null for a heard one. */
  why: string | null;
  photos: GuidePhoto[];
  /** Things to measure or ask while standing there. */
  ask: string[];
}

export interface WalkGuide {
  /** "Backyard remodel", "New front yard". */
  projectType: string;
  /** One sentence on what this walk is about. */
  headline: string;
  /** "rules" when it was derived from the site model because the language model call failed. */
  basis: "model" | "rules";
  /** Epoch milliseconds. */
  updatedAt: number;
  /** False while newer transcripts exist than the ones this guide was written from. */
  current: boolean;
  sections: GuideSection[];
}
