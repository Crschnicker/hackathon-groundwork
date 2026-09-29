// Per-chunk processing for a walk: upload → transcribe → poll, then re-extract the site model
// from everything transcribed so far. Runs in the background; progress is read from the store.
import { HttpError } from '../http.ts';
import { logger } from '../logger.ts';
import { getTranscription, isTerminalFailure, submitTranscription, uploadAudio } from '../plaud/client.ts';
import { extractSiteModel } from '../site-model/extract.ts';
import { listWalks, save, stitchTranscript, type Walk, type WalkChunk } from './store.ts';

const POLL_INTERVAL_MS = 5_000;
/** 20 min, the same headroom Plaud's own starter app allows for a backed-up queue. */
const MAX_POLLS = 240;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;
/** extractSiteModel needs something to work with; shorter than this is a cough or a greeting. */
const MIN_TRANSCRIPT_CHARS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function describe(err: unknown): string {
  if (err instanceof HttpError && typeof err.details === 'string') return `${err.message}: ${err.details}`;
  return err instanceof Error ? err.message : String(err);
}

function fail(walk: Walk, chunk: WalkChunk, err: unknown): void {
  chunk.status = 'failed';
  chunk.error = describe(err);
  logger.error({ walkId: walk.id, chunk: chunk.key, err: chunk.error }, 'Walk chunk failed');
  save();
}

/** Start processing a chunk that was just received. Returns immediately. */
export function processChunk(walk: Walk, chunk: WalkChunk, audio: Buffer): void {
  void (async () => {
    try {
      chunk.status = 'uploading';
      save();
      const { fileId, downloadUrl } = await uploadAudio(walk.userId, audio, chunk.filetype);
      chunk.fileId = fileId;
      chunk.timings.uploadedAt = Date.now();

      const task = await submitTranscription(downloadUrl, {
        language: walk.language ?? undefined,
        diarization: walk.diarization,
        hotwords: walk.hotwords ?? undefined,
      });
      chunk.transcriptionId = task.transcription_id;
      chunk.timings.submittedAt = Date.now();
      chunk.status = 'transcribing';
      save();
    } catch (err) {
      fail(walk, chunk, err);
      return;
    }
    await pollChunk(walk, chunk);
  })();
}

async function pollChunk(walk: Walk, chunk: WalkChunk): Promise<void> {
  const id = chunk.transcriptionId;
  if (!id) return;
  let errors = 0;

  for (let poll = 0; poll < MAX_POLLS; poll++) {
    await sleep(POLL_INTERVAL_MS);
    let task;
    try {
      task = await getTranscription(id);
      errors = 0;
    } catch (err) {
      if (++errors >= MAX_CONSECUTIVE_POLL_ERRORS) return fail(walk, chunk, err);
      continue;
    }
    if (isTerminalFailure(task.status)) return fail(walk, chunk, `Transcription ${task.status.toLowerCase()}`);
    if (task.status !== 'SUCCESS') continue;

    chunk.transcript = task.data?.text ?? '';
    chunk.language = task.data?.language ?? null;
    chunk.durationSec = task.data?.duration ?? null;
    chunk.segments = task.data?.results ?? [];
    chunk.timings.transcribedAt = Date.now();
    chunk.status = 'done';
    save();
    logger.info(
      { walkId: walk.id, chunk: chunk.key, chars: chunk.transcript.length, ms: chunk.timings.transcribedAt - chunk.timings.receivedAt },
      'Walk chunk transcribed',
    );
    scheduleExtraction(walk);
    return;
  }
  fail(walk, chunk, `Transcription still running after ${(MAX_POLLS * POLL_INTERVAL_MS) / 60_000} minutes`);
}

// One extraction per walk at a time. Chunks that finish while one is running mark the walk
// dirty, and a single follow-up run then covers all of them.
const extracting = new Map<string, { dirty: boolean }>();

export function isExtracting(walkId: string): boolean {
  return extracting.has(walkId);
}

export function scheduleExtraction(walk: Walk): void {
  const running = extracting.get(walk.id);
  if (running) {
    running.dirty = true;
    return;
  }
  const state = { dirty: false };
  extracting.set(walk.id, state);

  void (async () => {
    try {
      do {
        state.dirty = false;
        const { transcript, chunkKeys } = stitchTranscript(walk);
        if (transcript.length < MIN_TRANSCRIPT_CHARS) continue;
        try {
          const { siteModel, meta } = await extractSiteModel(transcript);
          walk.siteModel = siteModel;
          walk.siteModelMeta = meta;
          walk.siteModelError = null;
          walk.siteModelChunkKeys = chunkKeys;
          walk.siteModelUpdatedAt = Date.now();
          logger.info({ walkId: walk.id, chunks: chunkKeys.length, areas: siteModel.areas.length, ms: meta.latencyMs }, 'Walk site model updated');
        } catch (err) {
          // Keep the previous model: a stale one is more use to the architect than none.
          walk.siteModelError = describe(err);
          logger.error({ walkId: walk.id, err: walk.siteModelError }, 'Walk site model extraction failed');
        }
        save();
      } while (state.dirty);
    } finally {
      extracting.delete(walk.id);
    }
  })();
}

/** After a restart: carry on polling what Plaud is still transcribing; the rest cannot be recovered. */
export function resumeWalks(): void {
  for (const walk of listWalks()) {
    for (const chunk of walk.chunks) {
      if (chunk.status === 'transcribing' && chunk.transcriptionId) {
        void pollChunk(walk, chunk);
      } else if (chunk.status === 'received' || chunk.status === 'uploading') {
        fail(walk, chunk, 'The server restarted before this chunk was uploaded; send it again');
      }
    }
  }
}
