import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requirePermission, franchiseScopeFilter } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AuditLog } from '../models/AuditLog.js';

const router = Router();
const HIDDEN_ACTIONS = ['installment.notifications.refresh'];

router.use(requireAuth, requirePermission('audit.view'));

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  action: z.string().trim().max(64).optional(),
  entity: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(120).optional(),
  username: z.string().trim().max(120).optional(),
  franchiseId: z.string().trim().max(64).optional(),
  ip: z.string().trim().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contains(value: string) {
  return mongoose.trusted({ $regex: escapeRegex(value), $options: 'i' });
}

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { q, action, entity, entityId, username, franchiseId, ip, from, to, page, pageSize, limit } =
      req.query as unknown as z.infer<typeof listQuery>;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = {};
    if (action) filter.action = HIDDEN_ACTIONS.includes(action) ? '__hidden__' : action;
    else filter.action = mongoose.trusted({ $nin: HIDDEN_ACTIONS });
    if (entity) filter.entity = entity;
    if (entityId) filter.entityId = contains(entityId);
    if (username) filter.username = contains(username);
    if (scope._neverMatch) {
      filter._neverMatch = true;
    } else if (scope.franchiseId) {
      if (franchiseId && franchiseId !== scope.franchiseId) {
        filter._neverMatch = true;
      } else {
        filter.franchiseId = scope.franchiseId;
      }
    } else if (franchiseId) {
      filter.franchiseId = franchiseId;
    }
    if (ip) filter.ip = contains(ip);
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) createdAt.$gte = from;
      if (to) {
        const inclusiveTo = new Date(to);
        inclusiveTo.setHours(23, 59, 59, 999);
        createdAt.$lte = inclusiveTo;
      }
      filter.createdAt = mongoose.trusted(createdAt);
    }
    if (q) {
      const text = contains(q);
      filter.$or = [
        { action: text },
        { entity: text },
        { entityId: text },
        { username: text },
        { ip: text },
        { userAgent: text },
      ];
    }

    const effectivePageSize = limit ?? pageSize;
    const skip = (page - 1) * effectivePageSize;
    const visibleDistinctFilter: Record<string, unknown> = { action: mongoose.trusted({ $nin: HIDDEN_ACTIONS }) };
    if (filter.franchiseId) visibleDistinctFilter.franchiseId = filter.franchiseId;
    const [total, logs, actions, entities] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(effectivePageSize).lean(),
      AuditLog.distinct('action', visibleDistinctFilter),
      AuditLog.distinct('entity', visibleDistinctFilter),
    ]);

    res.json({
      logs,
      meta: {
        page,
        pageSize: effectivePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / effectivePageSize)),
      },
      filters: {
        actions: actions.filter(Boolean).sort(),
        entities: entities.filter(Boolean).sort(),
      },
    });
  }),
);

export default router;
