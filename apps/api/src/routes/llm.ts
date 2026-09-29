// LLM plumbing endpoints: which providers are configured, and a raw chat passthrough for testing.
import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../http.ts';
import { chat } from '../llm/chat.ts';
import { describeProviders } from '../llm/providers.ts';

export const llmRouter = Router();

llmRouter.get('/llm/providers', (_req, res) => {
  res.json({ providers: describeProviders() });
});

const chatBody = z.object({
  provider: z.enum(['openrouter', 'crusoe']).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  messages: z
    .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().min(1).max(100_000) }))
    .min(1)
    .max(50),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(16_000).optional(),
});

llmRouter.post('/llm/chat', async (req, res) => {
  const body = parse(chatBody, req.body);
  res.json(await chat(body));
});
