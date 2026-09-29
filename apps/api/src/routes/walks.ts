// Walk endpoints: a walkthrough recorded in short chunks, transcribed and extracted as it goes.
// The recorder (mobile app or scripts/simulate-walk.ts) creates a walk, posts each chunk as the
// device closes it, and anyone can poll the walk for the transcript and site model so far.
import { timingSafeEqual } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../env.ts';
import { HttpError, parse } from '../http.ts';
import { plaudConfigured, plaudTranscriptionConfigured } from '../plaud/client.ts';
import { extractIfComplete, isExtracting, processChunk } from '../walks/pipeline.ts';
import {
  DEFAULT_CUT_SECONDS,
  createWalk,
  getWalk,
  listWalks,
  orderedChunks,
  save,
  siteModelCovers,
  stitchTranscript,
  type Walk,
  type WalkChunk,
} from '../walks/store.ts';

export const walksRouter = Router();

/** The recorder reaches these through a public tunnel, so they take a shared token when one is set. */
export function requireWalkToken(req: Request, _res: Response, next: NextFunction): void {
  const expected = env.WALK_API_TOKEN;
  if (!expected) return next();
  const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'Missing or wrong walk API token');
  next();
}
walksRouter.use('/walks', requireWalkToken);

function requireWalk(id: string | undefined): Walk {
  const walk = id ? getWalk(id) : undefined;
  if (!walk) throw new HttpError(404, 'Walk not found');
  return walk;
}

function chunkView(chunk: WalkChunk, withSegments: boolean) {
  const { segments, timings, ...rest } = chunk;
  return {
    ...rest,
    timings,
    /** Milliseconds from the chunk arriving here to its transcript being ready. */
    latencyMs: timings.transcribedAt === null ? null : timings.transcribedAt - timings.receivedAt,
    ...(withSegments ? { segments } : {}),
  };
}

function walkView(walk: Walk, withSegments = false) {
  const chunks = orderedChunks(walk);
  const { transcript, chunkKeys } = stitchTranscript(walk);
  const count = (status: WalkChunk['status']) => chunks.filter((c) => c.status === status).length;
  const inFlight = chunks.length - count('done') - count('failed');
  return {
    id: walk.id,
    userId: walk.userId,
    status: walk.status,
    cutSeconds: walk.cutSeconds,
    createdAt: walk.createdAt,
    finishedAt: walk.finishedAt,
    counts: { total: chunks.length, done: count('done'), failed: count('failed'), inFlight },
    /** True once the walk is finished and nothing is left to transcribe or extract. */
    settled: walk.status === 'finished' && inFlight === 0 && !isExtracting(walk.id),
    transcript,
    siteModel: walk.siteModel,
    siteModelMeta: walk.siteModelMeta,
    siteModelError: walk.siteModelError,
    siteModelUpdatedAt: walk.siteModelUpdatedAt,
    siteModelPass: walk.siteModelPass ?? null,
    /**
     * False while newer transcripts exist than the ones the site model was extracted from, or while
     * a finished walk still has only a live model (its final extraction is pending or failed).
     */
    siteModelCurrent:
      !isExtracting(walk.id) &&
      siteModelCovers(walk, chunkKeys) &&
      !(walk.status === 'finished' && inFlight === 0 && walk.siteModelPass === 'live'),
    chunks: chunks.map((c) => chunkView(c, withSegments)),
  };
}

walksRouter.post('/walks', (req, res) => {
  if (!plaudConfigured() || !plaudTranscriptionConfigured()) {
    throw new HttpError(503, 'Plaud is not configured — set PLAUD_CLIENT_ID, PLAUD_SECRET_KEY and PLAUD_API_KEY in .env');
  }
  const body = parse(
    z.object({
      userId: z.string().trim().min(6).max(120),
      cutSeconds: z.number().int().min(15).max(3600).default(DEFAULT_CUT_SECONDS),
      language: z.string().trim().min(2).max(20).optional(),
      diarization: z.boolean().default(false),
      hotwords: z.string().trim().max(2000).optional(),
    }),
    req.body,
  );
  const walk = createWalk({ ...body, language: body.language ?? null, hotwords: body.hotwords ?? null });
  res.status(201).json(walkView(walk));
});

walksRouter.get('/walks', (_req, res) => {
  res.json(
    listWalks().map((walk) => ({
      id: walk.id,
      userId: walk.userId,
      status: walk.status,
      createdAt: walk.createdAt,
      chunks: walk.chunks.length,
    })),
  );
});

walksRouter.get('/walks/:id', (req, res) => {
  const query = parse(z.object({ segments: z.enum(['true', 'false']).default('false') }), req.query);
  res.json(walkView(requireWalk(req.params.id), query.segments === 'true'));
});

/**
 * One chunk of audio. Raw bytes in the body; ?key= identifies the chunk (the recorder's session
 * id), ?startedAt= is the epoch second it began, ?filetype=mp3|m4a|wav. Answers as soon as the
 * bytes are in hand; upload and transcription carry on in the background.
 */
walksRouter.post('/walks/:id/chunks', express.raw({ type: () => true, limit: '100mb' }), (req, res) => {
  const walk = requireWalk(req.params.id);
  const query = parse(
    z.object({
      key: z.string().trim().min(1).max(100),
      filetype: z.enum(['mp3', 'm4a', 'wav']),
      startedAt: z.coerce.number().int().positive().optional(),
      gapMs: z.coerce.number().int().min(0).optional(),
    }),
    req.query,
  );
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Request body must be the raw audio file');

  // Recorders retry on a flaky connection; only a chunk that failed is worth processing again.
  const existing = walk.chunks.find((c) => c.key === query.key);
  if (existing && existing.status !== 'failed') {
    res.status(200).json(chunkView(existing, false));
    return;
  }
  if (existing) walk.chunks.splice(walk.chunks.indexOf(existing), 1);

  const chunk: WalkChunk = {
    key: query.key,
    startedAt: query.startedAt ?? null,
    filetype: query.filetype,
    bytes: req.body.length,
    gapMs: query.gapMs ?? null,
    status: 'received',
    error: null,
    fileId: null,
    transcriptionId: null,
    transcript: null,
    language: null,
    durationSec: null,
    segments: [],
    timings: { receivedAt: Date.now(), uploadedAt: null, submittedAt: null, transcribedAt: null },
  };
  walk.chunks.push(chunk);
  save();
  processChunk(walk, chunk, req.body);
  res.status(202).json(chunkView(chunk, false));
});

/** The recorder has stopped for good. Chunks still in flight finish as usual. */
walksRouter.post('/walks/:id/finish', (req, res) => {
  const walk = requireWalk(req.params.id);
  if (walk.status !== 'finished') {
    walk.status = 'finished';
    walk.finishedAt = Date.now();
    save();
    extractIfComplete(walk);
  }
  res.json(walkView(walk));
});
