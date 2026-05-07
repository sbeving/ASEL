import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Notification } from '../models/Notification.js';
import { notFound } from '../utils/AppError.js';
import { isGlobalRole } from '../utils/roles.js';
import { refreshInstallmentNotifications } from '../services/installmentNotifications.service.js';
import { normalizeNotificationRoleTargets } from '../services/notification.service.js';
import { audit } from '../services/audit.service.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

function visibilityFilter(user: NonNullable<Express.Request['user']>) {
  const sharedClauses: Record<string, unknown>[] = [
    { userId: null },
    {
      $or: [
        { roleTargets: user.role },
        { roleTarget: user.role },
      ],
    },
  ];

  if (isGlobalRole(user.role)) {
    // Role-targets still apply for global users; franchise scope does not.
  } else if (user.franchiseId) {
    sharedClauses.push({
      $or: [{ franchiseId: null }, { franchiseId: user.franchiseId }],
    });
  } else {
    sharedClauses.push({ franchiseId: null });
  }

  return {
    $or: [
      { userId: user.sub },
      { $and: sharedClauses },
    ],
  };
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
    await refreshInstallmentNotifications();
    await normalizeNotificationRoleTargets();
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
    await refreshInstallmentNotifications();
    await normalizeNotificationRoleTargets();
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
    await audit(req, {
      action: 'notification.read_all',
      entity: 'Notification',
      details: { updated: result.modifiedCount },
    });
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
    const notification = await Notification.findOne({
      _id: id,
      ...visibilityFilter(req.user!),
    });
    if (!notification) throw notFound('Notification not found');

    if (!notification.readAt) {
      notification.readAt = new Date();
      await notification.save();
      await audit(req, {
        action: 'notification.read',
        entity: 'Notification',
        entityId: notification._id.toString(),
        franchiseId: notification.franchiseId?.toString() ?? null,
        details: { title: notification.title, type: notification.type, dedupeKey: notification.dedupeKey },
      });
    }

    res.json({ notification });
  }),
);

export default router;
