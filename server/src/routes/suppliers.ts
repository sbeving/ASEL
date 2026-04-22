import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Supplier } from '../models/Supplier.js';
import { audit } from '../services/audit.service.js';
import { notFound } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const upsertSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  phone: z.string().max(50).trim().optional(),
  email: z.string().email().max(120).optional().or(z.literal('')),
  address: z.string().max(255).trim().optional(),
  active: z.boolean().optional(),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const suppliers = await Supplier.find().sort({ name: 1 });
    res.json({ suppliers });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  validate(upsertSchema),
  asyncHandler(async (req, res) => {
    const supplier = await Supplier.create(req.body);
    await audit(req, { action: 'supplier.create', entity: 'Supplier', entityId: supplier._id.toString() });
    res.status(201).json({ supplier });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager'),
  validate(z.object({ id: objectId }), 'params'),
  validate(upsertSchema.partial()),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const supplier = await Supplier.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    if (!supplier) throw notFound('Supplier not found');
    await audit(req, { action: 'supplier.update', entity: 'Supplier', entityId: id });
    res.json({ supplier });
  }),
);

export default router;
