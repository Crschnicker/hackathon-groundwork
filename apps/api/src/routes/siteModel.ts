// POST /api/site-model/extract — walkthrough transcript → structured site model (journey step 4).
import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../http.ts';
import { extractSiteModel } from '../site-model/extract.ts';

export const siteModelRouter = Router();

const body = z.object({
  transcript: z.string().trim().min(20).max(200_000),
  provider: z.enum(['openrouter', 'crusoe']).optional(),
  model: z.string().trim().min(1).max(200).optional(),
});

siteModelRouter.post('/site-model/extract', async (req, res) => {
  const { transcript, provider, model } = parse(body, req.body);
  res.json(await extractSiteModel(transcript, { provider, model }));
});
