// Plaud Embedded — server side. Three credentials, three jobs:
//   client id + secret key  → partner token → per-user tokens (mobile SDK, File Upload API)
//   user token              → File Upload API (3-step S3 multipart → 24h DownloadUrl)
//   client id + API key     → Transcription API (submit a file URL, poll for the transcript)
// Reference: .agents/skills/plaud-embedded-*-skill and https://docs.plaud.ai/plaud-embedded/
import { createHash } from 'node:crypto';
import { env } from '../env.ts';
import { HttpError } from '../http.ts';

const base = () => env.PLAUD_BASE_URL.replace(/\/$/, '');

export function plaudConfigured(): boolean {
  return Boolean(env.PLAUD_CLIENT_ID && env.PLAUD_SECRET_KEY);
}

export function plaudTranscriptionConfigured(): boolean {
  return Boolean(env.PLAUD_CLIENT_ID && env.PLAUD_API_KEY);
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { signal: AbortSignal.timeout(30_000), ...init });
  } catch (err) {
    throw new HttpError(504, `Plaud request failed on ${path}`, err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `Plaud ${res.status} on ${path}`, text.slice(0, 500));
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, `Plaud returned non-JSON on ${path}`, text.slice(0, 200));
  }
}

// ---------- authentication ----------

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let partner: { token: string; expiresAt: number } | undefined;

/** Application-level token, cached in memory until a minute before it expires. */
export async function getPartnerToken(): Promise<string> {
  if (!plaudConfigured()) throw new HttpError(503, 'Plaud is not configured — set PLAUD_CLIENT_ID and PLAUD_SECRET_KEY in .env');
  if (partner && partner.expiresAt > Date.now() + 60_000) return partner.token;

  const basic = Buffer.from(`${env.PLAUD_CLIENT_ID}:${env.PLAUD_SECRET_KEY}`).toString('base64');
  const body = await request<TokenResponse>('/oauth/partner/access-token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  partner = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return partner.token;
}

/** User-level token. `userId` is our own stable id for the architect (6–120 chars). */
export async function issueUserToken(userId: string, expiresIn = 86_400): Promise<{ accessToken: string; expiresIn: number }> {
  const token = await getPartnerToken();
  const body = await request<TokenResponse>('/open/partner/users/access-token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, expires_in: expiresIn }),
  });
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

const userTokens = new Map<string, Promise<{ token: string; expiresAt: number }>>();

/**
 * User token for our own server-side calls, shared between callers. Plaud answers 500 when the
 * same user's token is requested several times at once, which a walk's chunks otherwise do.
 */
async function getUserToken(userId: string): Promise<string> {
  const cached = await userTokens.get(userId)?.catch(() => undefined);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const pending = issueUserToken(userId).then((t) => ({ token: t.accessToken, expiresAt: Date.now() + t.expiresIn * 1000 }));
  userTokens.set(userId, pending);
  try {
    return (await pending).token;
  } catch (err) {
    if (userTokens.get(userId) === pending) userTokens.delete(userId);
    throw err;
  }
}

// ---------- file upload ----------

interface PresignedResponse {
  FileId: string;
  UploadId: string;
  ChunkSize: number;
  Parts: { PartNumber: number; PresignedUrl: string }[];
}

interface CompleteResponse {
  FileId: string;
  FileType: string;
  DownloadUrl: string;
  FileMd5?: string;
}

export type AudioFileType = 'mp3' | 'm4a' | 'wav' | 'opus';

/** Upload audio bytes to Plaud storage; returns a download URL valid for ~24h. */
export async function uploadAudio(userId: string, bytes: Buffer, filetype: AudioFileType): Promise<{ fileId: string; downloadUrl: string }> {
  const accessToken = await getUserToken(userId);
  const auth = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  const presigned = await request<PresignedResponse>('/open/partner/files/upload/generate-presigned-urls', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ filesize: bytes.length, filetype }),
  });

  const partList: { PartNumber: number; ETag: string }[] = [];
  for (const part of [...presigned.Parts].sort((a, b) => a.PartNumber - b.PartNumber)) {
    const start = (part.PartNumber - 1) * presigned.ChunkSize;
    const chunk = bytes.subarray(start, start + presigned.ChunkSize);
    // Presigned S3 URL: no auth header, raw bytes.
    const put = await fetch(part.PresignedUrl, { method: 'PUT', body: new Uint8Array(chunk), signal: AbortSignal.timeout(120_000) });
    const etag = put.headers.get('etag');
    if (!put.ok || !etag) throw new HttpError(502, `Plaud upload failed on part ${part.PartNumber} (${put.status})`);
    partList.push({ PartNumber: part.PartNumber, ETag: etag });
  }

  const done = await request<CompleteResponse>('/open/partner/files/upload/complete-upload', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      file_id: presigned.FileId,
      upload_id: presigned.UploadId,
      part_list: partList,
      filetype,
      file_md5: createHash('md5').update(bytes).digest('hex'),
    }),
  });
  return { fileId: done.FileId, downloadUrl: done.DownloadUrl };
}

// ---------- transcription ----------

export type TranscriptionStatus = 'PENDING' | 'RECEIVED' | 'STARTED' | 'PROGRESS' | 'SUCCESS' | 'FAILURE' | 'REVOKED';

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker_id?: string;
  language?: string;
}

export interface Transcription {
  transcription_id: string;
  status: TranscriptionStatus;
  data?: { text?: string; language?: string; duration?: number; results?: TranscriptionSegment[] };
}

export interface TranscriptionParams {
  /** BCP-47 code or "auto" */
  language?: string;
  diarization?: boolean;
  /** comma-separated custom vocabulary, e.g. plant and material names */
  hotwords?: string;
}

function transcriptionHeaders(): Record<string, string> {
  if (!plaudTranscriptionConfigured()) {
    throw new HttpError(503, 'Plaud Transcription API is not configured — set PLAUD_API_KEY in .env (Portal → App Settings → API Keys)');
  }
  return { 'X-Client-Id': env.PLAUD_CLIENT_ID ?? '', 'X-Client-Api-Key': env.PLAUD_API_KEY ?? '', 'Content-Type': 'application/json' };
}

/** Start an async transcription of an M4A / MP3 / WAV file reachable at `fileUrl`. */
export async function submitTranscription(fileUrl: string, params: TranscriptionParams = {}): Promise<Transcription> {
  try {
    return await request<Transcription>('/open/partner/ai/transcriptions/', {
      method: 'POST',
      headers: transcriptionHeaders(),
      body: JSON.stringify({
        file_url: fileUrl,
        params: {
          transcribe: { language: params.language ?? 'auto' },
          diarization: { enabled: params.diarization ?? false },
          ...(params.hotwords ? { hotwords: params.hotwords } : {}),
        },
      }),
    });
  } catch (err) {
    // Plaud keeps the Transcription API locked until the app has bound a device through the SDK.
    if (err instanceof HttpError && typeof err.details === 'string' && err.details.includes('DEVICE_MISSING')) {
      throw new HttpError(409, 'Plaud will not transcribe until a Plaud device has been bound through the mobile app (DEVICE_MISSING)');
    }
    throw err;
  }
}

export async function getTranscription(id: string): Promise<Transcription> {
  const task = await request<Transcription>(`/open/partner/ai/transcriptions/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: transcriptionHeaders(),
  });

  // Plaud documents `text`, `language` and `duration` beside the segments but in practice sends
  // only the segments. Fill in whatever is missing from them so callers can rely on all three.
  const segments = task.data?.results ?? [];
  if (task.data && segments.length > 0) {
    task.data.text ??= segments.map((s) => s.text.trim()).filter(Boolean).join(' ');
    task.data.language ??= segments.find((s) => s.language)?.language;
    task.data.duration ??= Math.max(...segments.map((s) => s.end));
  }
  return task;
}

export function isTerminalFailure(status: TranscriptionStatus): boolean {
  return status === 'FAILURE' || status === 'REVOKED';
}
