import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Franchise } from '../models/Franchise.js';
import { audit } from '../services/audit.service.js';
import { notFound } from '../utils/AppError.js';

const router = Router();

const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const upsertSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  address: z.string().max(255).trim().optional(),
  phone: z.string().max(50).trim().optional(),
  manager: z.string().max(100).trim().optional(),
  active: z.boolean().optional(),
});

// All authenticated users can list franchises (needed for dropdowns),
// but only admin can mutate.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const filter = user.role === 'admin' || user.role === 'manager'
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
  validate(upsertSchema),
  asyncHandler(async (req, res) => {
    const franchise = await Franchise.create(req.body);
    await audit(req, { action: 'franchise.create', entity: 'Franchise', entityId: franchise._id.toString() });
    res.status(201).json({ franchise });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  validate(z.object({ id: objectId }), 'params'),
  validate(upsertSchema.partial()),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const franchise = await Franchise.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    if (!franchise) throw notFound('Franchise not found');
    await audit(req, { action: 'franchise.update', entity: 'Franchise', entityId: id });
    res.json({ franchise });
  }),
);

export default router;
