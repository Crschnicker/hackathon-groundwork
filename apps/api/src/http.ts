// Small shared HTTP helpers for the route modules.
import type { Response } from 'express';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Parse with zod or throw a 400 carrying the field errors. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(400, 'Invalid request', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

export function sendError(res: Response, status: number, message: string, details?: unknown): void {
  res.status(status).json({ error: message, ...(details === undefined ? {} : { details }) });
}
