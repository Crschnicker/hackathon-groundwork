// Plaud endpoints: auth for the mobile SDK, audio upload, transcription, and the hand-off
// from a finished transcript into the site-model extraction (journey steps 3 → 4).
// NOTE: all unauthenticated for now — put these behind the app's own login before deploying.
import express, { Router } from 'express';
import { z } from 'zod';
import { HttpError, parse } from '../http.ts';
import {
  getPartnerToken,
  getTranscription,
  isTerminalFailure,
  issueUserToken,
  plaudConfigured,
  plaudTranscriptionConfigured,
  submitTranscription,
  uploadAudio,
} from '../plaud/client.ts';
import { extractSiteModel } from '../site-model/extract.ts';

export const plaudRouter = Router();

const userId = z.string().trim().min(6).max(120);
const transcriptionParams = {
  language: z.string().trim().min(2).max(20).optional(),
  diarization: z.coerce.boolean().optional(),
  hotwords: z.string().trim().max(2000).optional(),
};

/** Proves the client id + secret work by minting a partner token (the token itself is not returned). */
plaudRouter.get('/plaud/status', async (_req, res) => {
  const transcription = plaudTranscriptionConfigured() ? 'configured' : 'missing PLAUD_API_KEY';
  if (!plaudConfigured()) {
    res.json({ configured: false, auth: 'skipped', transcription });
    return;
  }
  try {
    await getPartnerToken();
    res.json({ configured: true, auth: 'ok', transcription });
  } catch (err) {
    const details = err instanceof HttpError ? err.details : undefined;
    res.status(502).json({ configured: true, auth: 'failed', transcription, error: err instanceof Error ? err.message : String(err), details });
  }
});

/** The mobile app (Embedded SDK) calls this to get the token it binds a device with. */
plaudRouter.post('/plaud/user-token', async (req, res) => {
  const body = parse(z.object({ userId }), req.body);
  res.json(await issueUserToken(body.userId));
});

/**
 * Upload a recording from the browser/phone and start transcribing it.
 * Raw audio bytes in the body; ?userId=&filetype=mp3|m4a|wav (+ optional language, diarization, hotwords).
 */
plaudRouter.post('/plaud/recordings', express.raw({ type: () => true, limit: '300mb' }), async (req, res) => {
  const query = parse(z.object({ userId, filetype: z.enum(['mp3', 'm4a', 'wav']), ...transcriptionParams }), req.query);
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Request body must be the raw audio file');

  const { fileId, downloadUrl } = await uploadAudio(query.userId, req.body, query.filetype);
  const task = await submitTranscription(downloadUrl, query);
  res.status(202).json({ fileId, transcriptionId: task.transcription_id, status: task.status });
});

/** Transcribe audio that is already reachable at a URL (e.g. synced by the mobile SDK). */
plaudRouter.post('/plaud/transcriptions', async (req, res) => {
  const body = parse(z.object({ fileUrl: z.url(), ...transcriptionParams }), req.body);
  const task = await submitTranscription(body.fileUrl, body);
  res.status(202).json({ transcriptionId: task.transcription_id, status: task.status });
});

/** Poll. `done` is true on SUCCESS and on terminal failures, so clients know when to stop. */
plaudRouter.get('/plaud/transcriptions/:id', async (req, res) => {
  const task = await getTranscription(req.params.id);
  res.json({
    transcriptionId: task.transcription_id,
    status: task.status,
    done: task.status === 'SUCCESS' || isTerminalFailure(task.status),
    transcript: task.status === 'SUCCESS' ? (task.data?.text ?? '') : null,
    language: task.data?.language ?? null,
    durationSeconds: task.data?.duration ?? null,
    segments: task.data?.results ?? [],
  });
});

/** Finished transcript → site model, in one call. 409 while the transcription is still running. */
plaudRouter.post('/plaud/transcriptions/:id/site-model', async (req, res) => {
  const opts = parse(
    z.object({ provider: z.enum(['openrouter', 'crusoe']).optional(), model: z.string().trim().min(1).max(200).optional() }),
    req.body ?? {},
  );
  const task = await getTranscription(req.params.id);
  if (isTerminalFailure(task.status)) throw new HttpError(422, `Transcription ${task.status.toLowerCase()}`);
  if (task.status !== 'SUCCESS') throw new HttpError(409, `Transcription not finished (${task.status})`);
  const transcript = task.data?.text?.trim() ?? '';
  if (transcript.length < 20) throw new HttpError(422, 'Transcript is empty or too short to extract from');

  res.json({ transcriptionId: task.transcription_id, transcript, ...(await extractSiteModel(transcript, opts)) });
});
