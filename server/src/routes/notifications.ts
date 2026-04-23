import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Notification } from '../models/Notification.js';
import { forbidden, notFound } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

function visibilityFilter(user: NonNullable<Express.Request['user']>) {
  const andClauses: Record<string, unknown>[] = [];

  andClauses.push({
    $or: [{ userId: null }, { userId: user.sub }],
  });

  andClauses.push({
    $or: [{ roleTarget: null }, { roleTarget: 'all' }, { roleTarget: user.role }],
  });

  if (user.franchiseId) {
    andClauses.push({
      $or: [{ franchiseId: null }, { franchiseId: user.franchiseId }],
    });
  } else {
    andClauses.push({ franchiseId: null });
  }

  return { $and: andClauses };
}

const listQuery = z.object({
  status: z.enum(['all', 'unread']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
});

router.get(
  '/',
  requireAuth,
  requirePermission('notifications.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const { status, page, pageSize } = req.query as unknown as z.infer<typeof listQuery>;
    const skip = (page - 1) * pageSize;
    const baseFilter = visibilityFilter(user);
    const filter: Record<string, unknown> = {
      ...baseFilter,
      ...(status === 'unread' ? { readAt: null } : {}),
    };

    const [total, notifications, unreadCount] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize),
      Notification.countDocuments({ ...baseFilter, readAt: null }),
    ]);

    res.json({
      notifications,
      unreadCount,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  }),
);

router.get(
  '/unread-count',
  requireAuth,
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const count = await Notification.countDocuments({
      ...visibilityFilter(req.user!),
      readAt: null,
    });
    res.json({ count });
  }),
);

router.post(
  '/read-all',
  requireAuth,
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const result = await Notification.updateMany(
      {
        ...visibilityFilter(req.user!),
        readAt: null,
      },
      {
        $set: { readAt: now },
      },
    );
    res.json({ updated: result.modifiedCount });
  }),
);

router.patch(
  '/:id/read',
  requireAuth,
  requirePermission('notifications.view'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const notification = await Notification.findById(id);
    if (!notification) throw notFound('Notification not found');

    const user = req.user!;
    const isAllowedUser =
      notification.userId == null || notification.userId.toString() === user.sub;
    const isAllowedRole =
      notification.roleTarget == null ||
      notification.roleTarget === 'all' ||
      notification.roleTarget === user.role;
    const isAllowedFranchise =
      notification.franchiseId == null ||
      (user.franchiseId != null && notification.franchiseId.toString() === user.franchiseId);
    if (!isAllowedUser || !isAllowedRole || !isAllowedFranchise) throw forbidden();

    if (!notification.readAt) {
      notification.readAt = new Date();
      await notification.save();
    }

    res.json({ notification });
  }),
);

export default router;
