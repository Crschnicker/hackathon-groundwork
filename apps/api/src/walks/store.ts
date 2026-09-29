// Walks: one site walkthrough recorded as a series of short audio chunks (the recorder is cut
// every ~90 s) so transcription and extraction run during the walk instead of after it.
// State lives in memory and is mirrored to .groundwork/walks.json so a dev-server restart
// (tsx watch) does not lose a walk that is in progress.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '@groundwork/graph/env';
import type { ChatResult } from '../llm/chat.ts';
import { logger } from '../logger.ts';
import type { AudioFileType, TranscriptionSegment } from '../plaud/client.ts';
import type { SiteModel } from '../site-model/schema.ts';

export const DEFAULT_CUT_SECONDS = 90;

export type ChunkStatus = 'received' | 'uploading' | 'transcribing' | 'done' | 'failed';

export interface WalkChunk {
  /** Unique within the walk; the recorder's session id. Re-sending the same key is a no-op. */
  key: string;
  /** Epoch seconds the chunk started recording; orders the chunks. */
  startedAt: number | null;
  filetype: AudioFileType;
  bytes: number;
  /** Audio lost between the previous chunk's stop and this chunk's start, as measured by the recorder. */
  gapMs: number | null;
  status: ChunkStatus;
  error: string | null;
  fileId: string | null;
  transcriptionId: string | null;
  transcript: string | null;
  language: string | null;
  durationSec: number | null;
  segments: TranscriptionSegment[];
  /** Epoch ms of each stage, for measuring how far behind the walk the pipeline runs. */
  timings: { receivedAt: number; uploadedAt: number | null; submittedAt: number | null; transcribedAt: number | null };
}

export type SiteModelPass = 'live' | 'final';

export interface Walk {
  id: string;
  userId: string;
  cutSeconds: number;
  language: string | null;
  diarization: boolean;
  hotwords: string | null;
  status: 'active' | 'finished';
  createdAt: number;
  finishedAt: number | null;
  chunks: WalkChunk[];
  siteModel: SiteModel | null;
  siteModelMeta: Omit<ChatResult, 'content'> | null;
  siteModelError: string | null;
  /** Keys of the chunks whose transcripts the current site model was extracted from. */
  siteModelChunkKeys: string[];
  siteModelUpdatedAt: number | null;
  /**
   * 'live' while the walk is in progress; 'final' once extracted from the finished walk's full
   * transcript. Missing on walks saved before there was a final pass.
   */
  siteModelPass?: SiteModelPass | null;
}

const file = path.join(repoRoot, '.groundwork', 'walks.json');
const walks = new Map<string, Walk>();

function load(): void {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return; // first run
  }
  try {
    for (const walk of JSON.parse(raw) as Walk[]) walks.set(walk.id, walk);
  } catch (err) {
    logger.warn({ err, file }, 'Could not read saved walks; starting empty');
  }
}
load();

let saveTimer: NodeJS.Timeout | undefined;

/** Persist soon; bursts of updates collapse into one write. */
export function save(): void {
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify([...walks.values()]));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      logger.error({ err, file }, 'Could not save walks');
    }
  }, 250);
}

export function createWalk(init: Pick<Walk, 'userId' | 'cutSeconds' | 'language' | 'diarization' | 'hotwords'>): Walk {
  const walk: Walk = {
    ...init,
    id: randomUUID(),
    status: 'active',
    createdAt: Date.now(),
    finishedAt: null,
    chunks: [],
    siteModel: null,
    siteModelMeta: null,
    siteModelError: null,
    siteModelChunkKeys: [],
    siteModelUpdatedAt: null,
    siteModelPass: null,
  };
  walks.set(walk.id, walk);
  save();
  return walk;
}

export function getWalk(id: string): Walk | undefined {
  return walks.get(id);
}

export function listWalks(): Walk[] {
  return [...walks.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Chunks in recording order; chunks without a start time keep their arrival order. */
export function orderedChunks(walk: Walk): WalkChunk[] {
  return [...walk.chunks].sort(
    (a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity) || a.timings.receivedAt - b.timings.receivedAt,
  );
}

export const GAP_MARKER = '[part of the recording is not transcribed yet]';

/**
 * The walk so far as one transcript. Chunks are joined with a space so a sentence split by a
 * cut reads straight through; a chunk that has not finished leaves a marker in its place.
 */
/** Whether the site model was extracted from exactly these chunks (as returned by stitchTranscript). */
export function siteModelCovers(walk: Walk, chunkKeys: string[]): boolean {
  return chunkKeys.length === walk.siteModelChunkKeys.length && chunkKeys.every((k, i) => k === walk.siteModelChunkKeys[i]);
}

export function stitchTranscript(walk: Walk): { transcript: string; chunkKeys: string[] } {
  const parts: string[] = [];
  const chunkKeys: string[] = [];
  for (const chunk of orderedChunks(walk)) {
    if (chunk.status === 'done') {
      const text = chunk.transcript?.trim();
      if (text) parts.push(text);
      chunkKeys.push(chunk.key);
    } else if (parts.at(-1) !== GAP_MARKER) {
      parts.push(GAP_MARKER);
    }
  }
  while (parts.at(-1) === GAP_MARKER) parts.pop(); // nothing after it yet, so it separates nothing
  return { transcript: parts.join(' '), chunkKeys };
}
