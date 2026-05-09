import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import {
  requireAuth,
  requirePermission,
  requireRole,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Franchise } from '../models/Franchise.js';
import { audit } from '../services/audit.service.js';
import { notFound } from '../utils/AppError.js';
import { isGlobalRole } from '../utils/roles.js';

const router = Router();

const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const workScheduleSchema = z.object({
  enabled: z.boolean().default(true),
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .default([1, 2, 3, 4, 5, 6]),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('09:00'),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('19:00'),
  timezone: z.string().trim().min(1).max(80).default('Africa/Tunis'),
});

const creditPolicySchema = z.object({
  enabled: z.boolean().default(true),
  minimumScoreForInstallment: z.number().min(0).max(100).default(50),
  blockRiskyTier: z.boolean().default(true),
  blockLateInstallments: z.boolean().default(true),
  maxDebtToRecommendedLimitRatio: z.number().min(0).max(5).default(1),
  maxMonthlyPaymentRatio: z.number().min(0).max(5).default(1),
});

const upsertSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  address: z.string().max(255).trim().optional(),
  phone: z.string().max(50).trim().optional(),
  manager: z.string().max(100).trim().optional(),
  taxId: z.string().max(80).trim().optional(),
  gps: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .nullable()
    .optional(),
  workSchedule: workScheduleSchema.optional(),
  creditPolicy: creditPolicySchema.optional(),
  active: z.boolean().optional(),
});

// All authenticated users can list franchises (needed for dropdowns),
// but only admin can mutate.
router.get(
  '/',
  requireAuth,
  requirePermission('franchises.view'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const filter = isGlobalRole(user.role)
      ? {}
      : user.franchiseId
        ? { _id: user.franchiseId }
        : { _id: null };
    const franchises = await Franchise.find(filter).sort({ name: 1 });
    res.json({ franchises });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  requirePermission('franchises.manage'),
  validate(upsertSchema),
  asyncHandler(async (req, res) => {
    const franchise = await Franchise.create(req.body);
    await audit(req, {
      action: 'franchise.create',
      entity: 'Franchise',
      entityId: franchise._id.toString(),
    });
    res.status(201).json({ franchise });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('franchises.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(upsertSchema.partial()),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as Partial<z.infer<typeof upsertSchema>>;
    if (!isGlobalRole(req.user!.role)) {
      if (req.user!.franchiseId !== id) throw notFound('Franchise not found');
      const allowedKeys = new Set(['workSchedule']);
      const forbiddenKeys = Object.keys(input).filter(
        (key) => !allowedKeys.has(key),
      );
      if (forbiddenKeys.length > 0) throw notFound('Franchise not found');
    }
    const franchise = await Franchise.findByIdAndUpdate(id, input, {
      new: true,
      runValidators: true,
    });
    if (!franchise) throw notFound('Franchise not found');
    await audit(req, {
      action: 'franchise.update',
      entity: 'Franchise',
      entityId: id,
      franchiseId: id,
      details: {
        changedFields: Object.keys(input),
        workSchedule: input.workSchedule,
        creditPolicy: input.creditPolicy,
      },
    });
    res.json({ franchise });
  }),
);

export default router;
