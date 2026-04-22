import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

type Part = 'body' | 'query' | 'params';

export function validate<S extends ZodSchema>(schema: S, part: Part = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      next(result.error);
      return;
    }
    (req as any)[part] = result.data;
    next();
  };
}
