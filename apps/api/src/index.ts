// Groundwork API — Express 5 over the Neo4j item graph, plus the LLM and Plaud integrations.
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { closeDriver, verifyConnectivity } from '@groundwork/graph';
import { env } from './env.ts';
import { HttpError, sendError } from './http.ts';
import { describeProviders } from './llm/providers.ts';
import { logger } from './logger.ts';
import { plaudConfigured } from './plaud/client.ts';
import { clientProposalsRouter } from './proposals/client.ts';
import { proposalsRouter } from './proposals/routes.ts';
import { guideRouter } from './routes/guide.ts';
import { itemsRouter } from './routes/items.ts';
import { llmRouter } from './routes/llm.ts';
import { plaudRouter } from './routes/plaud.ts';
import { siteModelRouter } from './routes/siteModel.ts';
import { walksRouter } from './routes/walks.ts';
import { resumeWalks } from './walks/pipeline.ts';

const app = express();

app.use(helmet());
app.use(cors({ origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',') }));
app.use(express.json({ limit: '2mb' }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

app.get('/health', async (_req, res) => {
  const integrations = {
    llm: Object.fromEntries(describeProviders().map((p) => [p.name, p.configured ? 'configured' : 'missing key'])),
    plaud: plaudConfigured() ? 'configured' : 'missing credentials',
  };
  try {
    await verifyConnectivity();
    res.json({ status: 'ok', neo4j: 'ok', ...integrations });
  } catch (err) {
    logger.error({ err }, 'Neo4j connectivity check failed');
    res.status(503).json({ status: 'degraded', neo4j: 'unreachable', ...integrations });
  }
});

app.use('/api', itemsRouter, llmRouter, siteModelRouter, guideRouter, plaudRouter, walksRouter, proposalsRouter, clientProposalsRouter);

app.use((_req, res) => sendError(res, 404, 'Not found'));

// Express 5 forwards rejected async handlers here.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    sendError(res, err.status, err.message, err.details);
    return;
  }
  req.log.error({ err }, 'Unhandled error');
  sendError(res, 500, 'Internal server error');
});

const server = app.listen(env.API_PORT, () => {
  logger.info(`Groundwork API listening on http://localhost:${env.API_PORT}`);
  resumeWalks();
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await closeDriver();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
