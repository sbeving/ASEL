import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AuditLog } from '../models/AuditLog.js';
import { applyCursorFilter, nextCursor, paginationQuery } from '../utils/pagination.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

const listQuery = paginationQuery.extend({
  action: z.string().max(64).optional(),
  entity: z.string().max(64).optional(),
});

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { action, entity, limit, cursor } = req.query as unknown as z.infer<typeof listQuery>;
    let filter: Record<string, unknown> = {};
    if (action) filter.action = action;
    if (entity) filter.entity = entity;
    filter = applyCursorFilter(cursor, filter);
    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit);
    res.json({ logs, nextCursor: nextCursor(logs, limit) });
  }),
);

export default router;
