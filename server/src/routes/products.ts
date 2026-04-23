import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Product } from '../models/Product.js';
import { audit } from '../services/audit.service.js';
import { notFound } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const upsertSchema = z.object({
  name: z.string().min(1).max(150).trim(),
  categoryId: objectId,
  supplierId: objectId.nullable().optional(),
  brand: z.string().max(80).trim().optional(),
  reference: z.string().max(80).trim().optional(),
  barcode: z.string().max(80).trim().optional(),
  description: z.string().max(1000).trim().optional(),
  purchasePrice: z.number().min(0).optional(),
  sellPrice: z.number().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const listQuery = z.object({
  q: z.string().max(100).optional(),
  categoryId: objectId.optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get(
  '/',
  requireAuth,
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { q, categoryId, active, page, pageSize, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const effectivePageSize = limit ?? pageSize;
    const skip = (page - 1) * effectivePageSize;
    const filter: Record<string, unknown> = {};
    if (categoryId) filter.categoryId = categoryId;
    if (active !== undefined) filter.active = active;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { barcode: q },
        { reference: q },
        { name: rx },
        { reference: rx },
        { barcode: rx },
        { brand: rx },
      ];
    }

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort({ name: 1 }).skip(skip).limit(effectivePageSize).lean(),
    ]);

    res.json({
      products,
      meta: {
        page,
        pageSize: effectivePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / effectivePageSize)),
      },
    });
  }),
);

router.get(
  '/:id',
  requireAuth,
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) throw notFound('Product not found');
    res.json({ product });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  validate(upsertSchema),
  asyncHandler(async (req, res) => {
    const product = await Product.create(req.body);
    await audit(req, { action: 'product.create', entity: 'Product', entityId: product._id.toString() });
    res.status(201).json({ product });
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
    const product = await Product.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    if (!product) throw notFound('Product not found');
    await audit(req, { action: 'product.update', entity: 'Product', entityId: id });
    res.json({ product });
  }),
);

export default router;
