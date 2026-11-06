import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError, ProviderError } from '../errors.js';
import { logger } from '../logger.js';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details ?? null } });
    return;
  }
  if (error instanceof ProviderError) {
    const status = error.kind === 'validation' ? 400 : error.kind === 'configuration' ? 409 : 502;
    res.status(status).json({
      error: {
        code: `ENGAGELAB_${error.kind.toUpperCase()}`,
        message: error.message,
        details: { kind: error.kind, providerCode: error.providerCode ?? null, providerBody: error.providerBody ?? null },
      },
    });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON.' } });
    return;
  }
  if (error instanceof Error && 'type' in error && (error as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'VIDEO_TOO_LARGE', message: 'The video file is larger than 150 MB.' } });
    return;
  }
  logger.error({ name: error instanceof Error ? error.name : 'Error' }, 'Unhandled request error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The server could not complete the request.' } });
}
