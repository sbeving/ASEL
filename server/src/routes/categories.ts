import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Category } from '../models/Category.js';
import { audit } from '../services/audit.service.js';
import { notFound } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const upsertSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(500).trim().optional(),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const categories = await Category.find().sort({ name: 1 });
    res.json({ categories });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('categories.manage'),
  validate(upsertSchema),
  asyncHandler(async (req, res) => {
    const category = await Category.create(req.body);
    await audit(req, { action: 'category.create', entity: 'Category', entityId: category._id.toString() });
    res.status(201).json({ category });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('categories.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(upsertSchema.partial()),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const category = await Category.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    if (!category) throw notFound('Category not found');
    await audit(req, { action: 'category.update', entity: 'Category', entityId: id });
    res.json({ category });
  }),
);

export default router;
