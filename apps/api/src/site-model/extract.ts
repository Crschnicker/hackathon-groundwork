// Walkthrough transcript → structured site model (user journey step 4).
import { chatJson, type ChatResult } from '../llm/chat.ts';
import type { ProviderName } from '../llm/providers.ts';
import { siteModelSchema, type SiteModel } from './schema.ts';

const SYSTEM = `You turn a landscape architect's spoken site walkthrough into a structured site model.
Rules:
- One entry in "areas" per distinct part of the property the architect talks about.
- Only record what was said. Never invent measurements, conditions or features.
- Convert spoken sizes to feet ("20 by 15" -> lengthFt 20, widthFt 15, areaSqFt 300); keep the original words in asSpoken.
- Anything needed for a quote that was not said (a missing size, unknown sun exposure for a planting area, quantity of items to remove) goes in "missing" as a short question.
- Use null for unknown values.`;

export async function extractSiteModel(
  transcript: string,
  opts: { provider?: ProviderName; model?: string } = {},
): Promise<{ siteModel: SiteModel; meta: Omit<ChatResult, 'content'> }> {
  const { data, meta } = await chatJson({
    schema: siteModelSchema,
    schemaName: 'site_model',
    provider: opts.provider,
    model: opts.model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Transcript:\n"""\n${transcript}\n"""` },
    ],
  });
  return { siteModel: data, meta };
}
