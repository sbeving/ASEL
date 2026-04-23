import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * Attaches a request id (from X-Request-Id if provided, else a fresh UUID)
 * to both the incoming request and the outgoing response. Useful for
 * correlating logs across layers.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const headerId = req.get('x-request-id');
  const id = headerId && /^[\w-]{1,128}$/.test(headerId) ? headerId : randomUUID();
  res.setHeader('x-request-id', id);
  (req as { id?: string }).id = id;
  next();
};
