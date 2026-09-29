// POST /api/guide: a transcript in, the walk guide out. Lets the guide be tried and shown
// without a recorder or a walk. Send the guide from the last answer back as `previous`, with
// a longer transcript, to see it grow the way it does during a walk.
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parse } from '../http.ts';
import type { ChatResult } from '../llm/chat.ts';
import { logger } from '../logger.ts';
import { extractSiteModel } from '../site-model/extract.ts';
import type { SiteModel } from '../site-model/schema.ts';
import { generateGuide, guideFromSiteModel, walkGuideSchema, type WalkGuide } from '../walks/guide.ts';

export const guideRouter = Router();

const body = z.object({
  transcript: z.string().trim().min(20).max(20_000),
  previous: walkGuideSchema.nullish(),
});

type Meta = Omit<ChatResult, 'content'>;

guideRouter.post('/guide', async (req, res) => {
  const { transcript, previous } = parse(body, req.body);

  let siteModel: SiteModel | null = null;
  let siteModelMeta: Meta | null = null;
  try {
    ({ siteModel, meta: siteModelMeta } = await extractSiteModel(transcript, { prefer: 'crusoe' }));
  } catch (err) {
    // The guide can still be written from the transcript alone.
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Guide: site model extraction failed');
  }

  let guide: WalkGuide;
  let guideMeta: Meta | null = null;
  try {
    ({ guide, meta: guideMeta } = await generateGuide({ transcript, siteModel, previous }));
  } catch (err) {
    if (!siteModel) throw err instanceof HttpError ? err : new HttpError(502, 'The guide could not be written');
    guide = guideFromSiteModel(siteModel, previous ?? null);
  }
  res.json({ guide, meta: { guide: guideMeta, siteModel: siteModelMeta } });
});
