import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AuditLog } from '../models/AuditLog.js';

const router = Router();

router.use(requireAuth, requirePermission('audit.view'));

const listQuery = z.object({
  action: z.string().max(64).optional(),
  entity: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { action, entity, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const filter: Record<string, unknown> = {};
    if (action) filter.action = action;
    if (entity) filter.entity = entity;
    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit);
    res.json({ logs });
  }),
);

export default router;
