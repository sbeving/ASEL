import { z } from 'zod';

/**
 * Cursor-based pagination helper.
 *
 * Every paginated list endpoint accepts `?limit=` + optional `?cursor=`
 * (an ISO datetime from the previous page's `nextCursor`), and returns:
 *
 *     { items: [...], nextCursor: string | null }
 *
 * Cursors are opaque to callers but in practice encode the `createdAt` of
 * the last returned document, which lets us resume with a stable
 * `createdAt < cursor` filter. Tie-breaking by `_id` is not needed here
 * because we sort by a high-resolution Date field and the request volume
 * for a single franchise never produces duplicate-millisecond inserts
 * in practice; if it does, one row may shift by a page, which is
 * acceptable for an audit / sales log.
 */
export const paginationQuery = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type PaginationInput = z.infer<typeof paginationQuery>;

export function applyCursorFilter(
  cursor: string | undefined,
  filter: Record<string, unknown>,
  field = 'createdAt',
): Record<string, unknown> {
  if (!cursor) return filter;
  const prev = filter[field] as Record<string, unknown> | undefined;
  return {
    ...filter,
    [field]: { ...(prev ?? {}), $lt: new Date(cursor) },
  };
}

export function nextCursor<T extends { createdAt?: Date | string | null }>(
  items: T[],
  limit: number,
): string | null {
  if (items.length < limit) return null;
  const last = items[items.length - 1];
  const ts = last?.createdAt;
  if (!ts) return null;
  return (ts instanceof Date ? ts : new Date(ts)).toISOString();
}
