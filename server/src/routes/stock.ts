import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Stock } from '../models/Stock.js';
import { Movement } from '../models/Movement.js';
import { Product } from '../models/Product.js';
import { applyStockDelta } from '../services/stock.service.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

function resolveFranchiseId(user: Express.Request['user'], requested?: string): string {
  if (!user) throw forbidden();
  if (user.role === 'admin' || user.role === 'manager') {
    if (!requested) throw badRequest('franchiseId is required');
    return requested;
  }
  if (!user.franchiseId) throw forbidden('No franchise assigned');
  if (requested && requested !== user.franchiseId) throw forbidden('Cross-franchise access denied');
  return user.franchiseId;
}

const listQuery = z.object({
  franchiseId: objectId.optional(),
  lowOnly: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * Stock levels for a single franchise, joined with product data and
 * the per-product low-stock threshold.
 */
router.get(
  '/',
  requireAuth,
  requirePermission('stock.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, lowOnly, q, page, pageSize, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const effectivePageSize = limit ?? pageSize;
    const skip = (page - 1) * effectivePageSize;
    const fid = resolveFranchiseId(req.user, franchiseId);

    const pipeline: mongoose.PipelineStage[] = [
      { $match: { franchiseId: new mongoose.Types.ObjectId(fid) } },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.categoryId',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    ];

    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      pipeline.push({
        $match: {
          $or: [{ 'product.name': rx }, { 'product.reference': rx }, { 'product.barcode': rx }],
        },
      });
    }

    if (lowOnly) {
      pipeline.push({ $match: { $expr: { $lte: ['$quantity', '$product.lowStockThreshold'] } } });
    }

    const countPipeline: mongoose.PipelineStage[] = [...pipeline, { $count: 'total' }];
    pipeline.push({ $sort: { 'product.name': 1 } }, { $skip: skip }, { $limit: effectivePageSize });

    const [items, totalResult] = await Promise.all([
      Stock.aggregate(pipeline),
      Stock.aggregate(countPipeline),
    ]);
    const total = totalResult[0]?.total ?? 0;
    res.json({
      franchiseId: fid,
      items,
      meta: {
        page,
        pageSize: effectivePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / effectivePageSize)),
      },
    });
  }),
);

const entrySchema = z.object({
  franchiseId: objectId.optional(),
  productId: objectId,
  quantity: z.number().int().positive(),
  unitPrice: z.number().min(0).optional(),
  note: z.string().max(500).optional(),
});

router.post(
  '/entry',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('stock.entry'),
  validate(entrySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof entrySchema>;
    const fid = resolveFranchiseId(req.user, body.franchiseId);

    const product = await Product.findById(body.productId);
    if (!product) throw badRequest('Product not found');

    await applyStockDelta({
      franchiseId: fid,
      productId: body.productId,
      delta: body.quantity,
      type: 'stock_in',
      userId: req.user!.sub,
      unitPrice: body.unitPrice ?? product.purchasePrice ?? 0,
      note: body.note,
    });
    await audit(req, {
      action: 'stock.entry',
      entity: 'Stock',
      franchiseId: fid,
      details: { productId: body.productId, quantity: body.quantity },
    });
    res.status(201).json({ ok: true });
  }),
);

const adjustSchema = z.object({
  franchiseId: objectId.optional(),
  productId: objectId,
  delta: z.number().int().refine((v) => v !== 0, { message: 'delta must be non-zero' }),
  note: z.string().max(500).optional(),
});

router.post(
  '/adjust',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('stock.adjust'),
  validate(adjustSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof adjustSchema>;
    const fid = resolveFranchiseId(req.user, body.franchiseId);
    await applyStockDelta({
      franchiseId: fid,
      productId: body.productId,
      delta: body.delta,
      type: 'adjustment',
      userId: req.user!.sub,
      note: body.note,
    });
    await audit(req, {
      action: 'stock.adjust',
      entity: 'Stock',
      franchiseId: fid,
      details: { productId: body.productId, delta: body.delta },
    });
    res.status(201).json({ ok: true });
  }),
);

const movementsQuery = z.object({
  franchiseId: objectId.optional(),
  productId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get(
  '/movements',
  requireAuth,
  requirePermission('stock.movements.view'),
  validate(movementsQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, productId, limit } = req.query as unknown as z.infer<typeof movementsQuery>;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (productId) filter.productId = productId;
    const movements = await Movement.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('productId', 'name reference')
      .populate('userId', 'username fullName');
    res.json({ movements });
  }),
);

export default router;
