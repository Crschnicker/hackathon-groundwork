// Walk photos: the image files, and mapping each photo to a site model area. A photo is matched
// by what the architect was saying when it was taken ("spokenContext"), so it can sit in that
// area's section of the proposal. Mapping runs in the background and never holds up an upload.
import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { HttpError } from '../http.ts';
import { chatJson } from '../llm/chat.ts';
import type { ProviderName } from '../llm/providers.ts';
import { logger } from '../logger.ts';
import type { TranscriptionSegment } from '../plaud/client.ts';
import { save, stateDir, type PhotoContentType, type Walk, type WalkPhoto } from './store.ts';

export const MAX_PHOTOS_PER_WALK = 200;
export const MAX_CAPTION_CHARS = 300;
export const MAX_AREA_CHARS = 120;

/** Mapping runs after every live extraction, so it goes to the fast provider first (it falls back). */
const MAPPING_PROVIDER: ProviderName = 'crusoe';
/** Words spoken this long either side of the shutter count as what the photo is about. */
const CONTEXT_WINDOW_SEC = 25;
/** With nothing in the window, the nearest words still count if they were this close. */
const NEAREST_SEGMENT_SEC = 90;
const MAX_CONTEXT_CHARS = 600;
const MAX_AUTO_CAPTION_CHARS = 90;

const EXTENSIONS: Record<PhotoContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// ---------------------------------------------------------------------------------------------
// Files

function photoDir(walkId: string): string {
  return path.join(stateDir, 'photos', walkId);
}

function photoPath(walkId: string, photo: WalkPhoto): string {
  return path.join(photoDir(walkId), `${photo.id}.${EXTENSIONS[photo.contentType]}`);
}

/** The Content-Type header a sender may use; image/jpg is a common misspelling of image/jpeg. */
export function acceptedContentType(header: string | undefined): boolean {
  const type = (header ?? '').split(';')[0]!.trim().toLowerCase();
  return type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png' || type === 'image/webp';
}

/** What the bytes actually are, by their magic numbers; null for anything but JPEG, PNG or WebP. */
export function detectImageType(bytes: Buffer): PhotoContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** The walk's photos, oldest first. */
export function sortedPhotos(walk: Walk): WalkPhoto[] {
  return [...(walk.photos ?? [])].sort((a, b) => a.takenAt - b.takenAt || a.receivedAt - b.receivedAt);
}

export function requirePhoto(walk: Walk, photoId: string | undefined): WalkPhoto {
  const photo = photoId ? walk.photos?.find((p) => p.id === photoId) : undefined;
  if (!photo) throw new HttpError(404, 'Photo not found');
  return photo;
}

export interface NewPhoto {
  key: string;
  takenAt: number;
  source: WalkPhoto['source'];
  sectionId: string | null;
  promptId: string | null;
}

/**
 * Store a photo. Re-sending a key returns the photo already stored (`created: false`). The file
 * is written before the record is added, so a listed photo always has its bytes.
 */
export function addPhoto(walk: Walk, init: NewPhoto, bytes: Buffer): { photo: WalkPhoto; created: boolean } {
  const photos = (walk.photos ??= []);
  const existing = photos.find((p) => p.key === init.key);
  if (existing) return { photo: existing, created: false };
  if (photos.length >= MAX_PHOTOS_PER_WALK) throw new HttpError(409, `A walk can have at most ${MAX_PHOTOS_PER_WALK} photos`);
  const contentType = detectImageType(bytes);
  if (!contentType) throw new HttpError(400, 'The file is not a JPEG, PNG or WebP image');

  const photo: WalkPhoto = {
    ...init,
    id: randomUUID(),
    receivedAt: Date.now(),
    contentType,
    bytes: bytes.length,
    caption: null,
    area: null,
    areaSource: null,
    spokenContext: spokenContext(walk, init.takenAt),
  };
  // Synchronous on purpose: nothing else runs in between, so two retries of one key cannot both land.
  mkdirSync(photoDir(walk.id), { recursive: true });
  writeFileSync(photoPath(walk.id, photo), bytes);
  photos.push(photo);
  save();
  return { photo, created: true };
}

export async function readPhoto(walkId: string, photo: WalkPhoto): Promise<Buffer> {
  try {
    return await readFile(photoPath(walkId, photo));
  } catch (err) {
    logger.error({ walkId, photoId: photo.id, err }, 'Walk photo file is missing');
    throw new HttpError(404, 'Photo file not found');
  }
}

/** The architect's edit. Their word is final: the mapper never touches the photo again. */
export function updatePhoto(photo: WalkPhoto, change: { caption?: string | null; area?: string | null }): WalkPhoto {
  if (change.caption !== undefined) photo.caption = change.caption?.trim() || null;
  if (change.area !== undefined) photo.area = change.area?.trim() || null;
  if (change.caption !== undefined || change.area !== undefined) {
    photo.areaSource = 'architect';
    save();
  }
  return photo;
}

/** Remove the record and the file. Proposals referencing the photo are the caller's to update. */
export function deletePhoto(walk: Walk, photo: WalkPhoto): void {
  const photos = walk.photos ?? [];
  const index = photos.indexOf(photo);
  if (index !== -1) photos.splice(index, 1);
  save();
  try {
    unlinkSync(photoPath(walk.id, photo));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ walkId: walk.id, photoId: photo.id, err }, 'Could not delete walk photo file');
  }
}

// ---------------------------------------------------------------------------------------------
// What was being said

interface TimedText {
  /** Epoch seconds. */
  start: number;
  end: number;
  text: string;
}

/** Every transcribed segment of the walk on one clock (epoch seconds), in order. */
function timedSegments(walk: Walk): TimedText[] {
  const out: TimedText[] = [];
  for (const chunk of walk.chunks) {
    if (chunk.status !== 'done' || chunk.startedAt === null) continue;
    let segments: TranscriptionSegment[] = chunk.segments;
    // A transcript without segments still places its words somewhere in the chunk.
    if (segments.length === 0 && chunk.transcript?.trim() && chunk.durationSec) {
      segments = [{ start: 0, end: chunk.durationSec, text: chunk.transcript }];
    }
    for (const s of segments) {
      const text = s.text.trim();
      if (text) out.push({ start: chunk.startedAt + s.start, end: chunk.startedAt + Math.max(s.end, s.start), text });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Cut `text` to MAX_CONTEXT_CHARS centred on `at` (a character offset), on word boundaries. */
function trimAround(text: string, at: number): string {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  let from = Math.max(0, Math.min(Math.round(at - MAX_CONTEXT_CHARS / 2), text.length - MAX_CONTEXT_CHARS));
  let to = from + MAX_CONTEXT_CHARS;
  if (from > 0) {
    const space = text.indexOf(' ', from);
    if (space !== -1 && space < to) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to);
    if (space > from) to = space;
  }
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

/**
 * The words spoken within about ±25 s of `takenAt` (epoch ms). Segments can be most of a minute
 * long, so any segment overlapping the window counts, and the text is trimmed around the point
 * where the photo falls. Null when nothing transcribed is close enough.
 */
export function spokenContext(walk: Walk, takenAt: number): string | null {
  const t = takenAt / 1000;
  const segments = timedSegments(walk);
  const inWindow = segments.filter((s) => s.end >= t - CONTEXT_WINDOW_SEC && s.start <= t + CONTEXT_WINDOW_SEC);

  if (inWindow.length === 0) {
    let nearest: TimedText | null = null;
    let distance = Infinity;
    for (const s of segments) {
      const d = Math.max(0, s.start - t, t - s.end);
      if (d < distance) [nearest, distance] = [s, d];
    }
    if (!nearest || distance > NEAREST_SEGMENT_SEC) return null;
    return trimAround(nearest.text, t < nearest.start ? 0 : nearest.text.length);
  }

  // Join the segments, noting the character offset that lines up with the shutter.
  let text = '';
  let at: number | null = null;
  for (const s of inWindow) {
    if (text) text += ' ';
    if (at === null && t < s.start) at = text.length;
    if (at === null && t <= s.end) {
      const share = s.end > s.start ? (t - s.start) / (s.end - s.start) : 0.5;
      at = text.length + share * s.text.length;
    }
    text += s.text;
  }
  return trimAround(text, at ?? text.length);
}

// ---------------------------------------------------------------------------------------------
// Mapping photos to areas

/** The walk guide's section title for a photo taken from a guide prompt. The guide may not exist. */
function guideSectionTitle(walk: Walk, photo: WalkPhoto): string | null {
  if (!photo.sectionId) return null;
  const guide = (walk as unknown as { guide?: { sections?: { id?: string; title?: string }[] } | null }).guide;
  const title = guide?.sections?.find((s) => s.id === photo.sectionId)?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

/** The site model's spelling of an area name, matched case-insensitively; null when it has none. */
function canonicalArea(areaNames: string[], name: string | null | undefined): string | null {
  const wanted = name?.trim().toLowerCase();
  if (!wanted) return null;
  return areaNames.find((n) => n.trim().toLowerCase() === wanted) ?? null;
}

const STOPWORDS = new Set(['the', 'and', 'area', 'for', 'with', 'from', 'near', 'along', 'side', 'front', 'back']);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where in `text` the area is mentioned: the whole name, or else all its significant words.
 * Returns the character offset of the mention, or -1.
 */
function mentionAt(text: string, area: string): number {
  const lower = text.toLowerCase();
  const whole = new RegExp(`\\b${escapeRegExp(area.trim().toLowerCase())}\\b`).exec(lower);
  if (whole) return whole.index;
  const words = area
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (words.length === 0) return -1;
  const hits = words.map((w) => new RegExp(`\\b${escapeRegExp(w)}`).exec(lower)?.index ?? -1);
  return hits.includes(-1) ? -1 : Math.min(...hits);
}

/**
 * The deterministic match: a guide section title naming an area wins; otherwise the area named
 * in what was said, nearest the middle (the context is centred on the shutter). Null if none.
 */
function fallbackArea(areaNames: string[], guideTitle: string | null, context: string | null): string | null {
  if (guideTitle) {
    const byTitle = areaNames.filter((a) => mentionAt(guideTitle, a) !== -1);
    if (byTitle.length > 0) return byTitle.sort((a, b) => b.length - a.length)[0]!;
  }
  if (!context) return null;
  const middle = context.length / 2;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const area of areaNames) {
    const at = mentionAt(context, area);
    if (at === -1) continue;
    const distance = Math.abs(at - middle);
    if (distance < bestDistance || (distance === bestDistance && best !== null && area.length > best.length)) {
      [best, bestDistance] = [area, distance];
    }
  }
  return best;
}

const mappingSchema = z.object({
  photos: z.array(
    z.object({
      id: z.string(),
      /** Exactly one of the area names given, or null. */
      area: z.string().nullable(),
      caption: z.string().nullable(),
    }),
  ),
});

const SYSTEM = `You match site photos from a landscape architect's walkthrough to the areas of the property.
For each photo you get what the architect was saying around the moment it was taken, and sometimes the walk guide section it was taken for.
Rules:
- "area" must be exactly one of the area names given, or null when what was said does not make the area clear. Never invent an area.
- "caption" is a short plain description of what the photo most likely shows, at most 90 characters, e.g. "Cracked concrete at the back patio". Base it only on what was said; null if nothing was said about it.
- Return one entry per photo id given.`;

function formatOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function describeAreas(walk: Walk): string {
  const areas = walk.siteModel?.areas ?? [];
  return areas
    .map((a) => {
      const bits = [
        a.existingFeatures.length ? `features: ${a.existingFeatures.map((f) => f.feature).join(', ')}` : '',
        a.proposedChanges.length ? `changes: ${a.proposedChanges.map((c) => c.change).join('; ')}` : '',
        a.removals.length ? `removals: ${a.removals.map((r) => r.item).join(', ')}` : '',
      ].filter(Boolean);
      return `- ${JSON.stringify(a.name)}${bits.length ? ` (${bits.join(' | ')})` : ''}`;
    })
    .join('\n');
}

interface Candidate {
  photo: WalkPhoto;
  guideTitle: string | null;
}

// One mapping run per walk at a time; photos or models that arrive during a run mark it dirty,
// and one follow-up run covers them all. The fingerprint of the last run that reached the LLM
// lets a run with nothing new skip the call.
const mapping = new Map<string, { dirty: boolean }>();
const fingerprints = new Map<string, string>();

/** Map the walk's photos to its site model's areas, in the background. Returns immediately. */
export function schedulePhotoMapping(walk: Walk): void {
  const running = mapping.get(walk.id);
  if (running) {
    running.dirty = true;
    return;
  }
  const state = { dirty: false };
  mapping.set(walk.id, state);

  void (async () => {
    try {
      do {
        state.dirty = false;
        try {
          await mapOnce(walk);
        } catch (err) {
          logger.error({ walkId: walk.id, err }, 'Walk photo mapping failed');
        }
      } while (state.dirty);
    } finally {
      mapping.delete(walk.id);
    }
  })();
}

async function mapOnce(walk: Walk): Promise<void> {
  const photos = walk.photos ?? [];
  if (photos.length === 0) return;

  // Transcripts arrive after the photos they explain, so the context is refreshed every run.
  let changed = false;
  for (const photo of photos) {
    const context = spokenContext(walk, photo.takenAt);
    if (context !== photo.spokenContext) {
      photo.spokenContext = context;
      changed = true;
    }
  }

  const areaNames = (walk.siteModel?.areas ?? []).map((a) => a.name).filter((n) => n.trim());
  const candidates: Candidate[] = [];
  for (const photo of photos) {
    if (photo.areaSource === 'architect') continue;
    // An area the site model no longer has cannot stay; the photo is mapped afresh below.
    if (photo.area !== null) {
      const canonical = canonicalArea(areaNames, photo.area);
      if (canonical !== photo.area) {
        photo.area = canonical;
        changed = true;
      }
    }
    const guideTitle = guideSectionTitle(walk, photo);
    // With nothing said and no guide section there is nothing to match on.
    if (photo.spokenContext || guideTitle) candidates.push({ photo, guideTitle });
  }
  if (changed) save();
  if (areaNames.length === 0 || candidates.length === 0) return;

  const fingerprint = JSON.stringify([
    areaNames,
    candidates.map((c) => [c.photo.id, c.photo.spokenContext, c.guideTitle]),
  ]);
  if (fingerprints.get(walk.id) === fingerprint) return;

  let answers: Map<string, { area: string | null; caption: string | null }>;
  try {
    const { data, meta } = await chatJson({
      schema: mappingSchema,
      schemaName: 'photo_areas',
      prefer: MAPPING_PROVIDER,
      temperature: 0,
      maxTokens: 4000,
      timeoutMs: 60_000,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            `Areas:\n${describeAreas(walk)}`,
            `Photos:\n${candidates
              .map(({ photo, guideTitle }) =>
                JSON.stringify({
                  id: photo.id,
                  takenIntoWalk: formatOffset(photo.takenAt - walk.createdAt),
                  guideSection: guideTitle,
                  said: photo.spokenContext,
                }),
              )
              .join('\n')}`,
          ].join('\n\n'),
        },
      ],
    });
    answers = new Map(
      data.photos.map((p) => [
        p.id,
        {
          area: canonicalArea(areaNames, p.area),
          caption: p.caption?.trim().replace(/\s+/g, ' ').slice(0, MAX_AUTO_CAPTION_CHARS).trim() || null,
        },
      ]),
    );
    fingerprints.set(walk.id, fingerprint);
    logger.info({ walkId: walk.id, photos: candidates.length, provider: meta.provider, ms: meta.latencyMs }, 'Walk photos mapped');
  } catch (err) {
    // No LLM, or none answered: match area names in the words instead. The fingerprint is left
    // unset so the next run tries the LLM again.
    logger.warn({ walkId: walk.id, err: err instanceof Error ? err.message : String(err) }, 'Photo mapping fell back to name matching');
    answers = new Map(
      candidates.map(({ photo, guideTitle }) => [
        photo.id,
        { area: fallbackArea(areaNames, guideTitle, photo.spokenContext) ?? photo.area, caption: null },
      ]),
    );
  }

  // The architect may have set a photo, or deleted it, while the LLM was thinking.
  const current = new Set(walk.photos ?? []);
  for (const { photo } of candidates) {
    const answer = answers.get(photo.id);
    if (!answer || !current.has(photo) || photo.areaSource === 'architect') continue;
    // A site model extracted meanwhile may have dropped the area; the next run maps it again.
    photo.area = canonicalArea((walk.siteModel?.areas ?? []).map((a) => a.name), answer.area);
    if (answer.caption) photo.caption = answer.caption;
    if (photo.area !== null || photo.caption !== null) photo.areaSource = 'auto';
  }
  save();
}
