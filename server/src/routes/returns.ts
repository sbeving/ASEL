import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Product } from '../models/Product.js';
import { Return } from '../models/Return.js';
import { applyStockDelta } from '../services/stock.service.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden } from '../utils/AppError.js';
import { isGlobalRole } from '../utils/roles.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

function resolveFranchiseId(user: Express.Request['user'], requested?: string): string {
  if (!user) throw forbidden();
  if (isGlobalRole(user.role)) {
    if (!requested) throw badRequest('franchiseId is required');
    return requested;
  }
  if (!user.franchiseId) throw forbidden('No franchise assigned');
  if (requested && requested !== user.franchiseId) throw forbidden('Cross-franchise access denied');
  return user.franchiseId;
}

const listQuery = z.object({
  franchiseId: objectId.optional(),
  productId: objectId.optional(),
  returnType: z.enum(['return', 'exchange']).optional(),
  q: z.string().trim().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(30),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get(
  '/',
  requireAuth,
  requirePermission('returns.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, productId, returnType, q, from, to, page, pageSize, limit } =
      req.query as unknown as z.infer<typeof listQuery>;
    const effectivePageSize = limit ?? pageSize;
    const skip = (page - 1) * effectivePageSize;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };

    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (productId) filter.productId = productId;
    if (returnType) filter.returnType = returnType;

    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to) createdAt.$lt = new Date(`${to}T23:59:59.999Z`);
      filter.createdAt = createdAt;
    }

    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      const products = await Product.find(
        { $or: [{ name: rx }, { reference: rx }, { barcode: rx }, { brand: rx }] },
        { _id: 1 },
      )
        .limit(300)
        .lean();
      if (products.length === 0) {
        return res.json({
          returns: [],
          summary: {
            returnCount: 0,
            exchangeCount: 0,
            returnedValue: 0,
            totalQuantity: 0,
          },
          meta: {
            page,
            pageSize: effectivePageSize,
            total: 0,
            totalPages: 1,
          },
        });
      }
      filter.productId = { $in: products.map((p) => p._id) };
    }

    const [total, rows, summaryRows] = await Promise.all([
      Return.countDocuments(filter),
      Return.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(effectivePageSize)
        .populate('franchiseId', 'name')
        .populate('productId', 'name reference barcode')
        .populate('userId', 'fullName username')
        .lean(),
      Return.aggregate<{
        _id: null;
        returnCount: number;
        exchangeCount: number;
        returnedValue: number;
        totalQuantity: number;
      }>([
        { $match: filter },
        {
          $group: {
            _id: null,
            returnCount: {
              $sum: {
                $cond: [{ $eq: ['$returnType', 'return'] }, 1, 0],
              },
            },
            exchangeCount: {
              $sum: {
                $cond: [{ $eq: ['$returnType', 'exchange'] }, 1, 0],
              },
            },
            returnedValue: {
              $sum: {
                $cond: [{ $eq: ['$returnType', 'return'] }, { $multiply: ['$quantity', '$unitPrice'] }, 0],
              },
            },
            totalQuantity: { $sum: '$quantity' },
          },
        },
      ]),
    ]);

    const summary = summaryRows[0] ?? {
      returnCount: 0,
      exchangeCount: 0,
      returnedValue: 0,
      totalQuantity: 0,
    };

    res.json({
      returns: rows,
      summary,
      meta: {
        page,
        pageSize: effectivePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / effectivePageSize)),
      },
    });
  }),
);

const createSchema = z.object({
  franchiseId: objectId.optional(),
  productId: objectId,
  quantity: z.number().int().positive(),
  returnType: z.enum(['return', 'exchange']),
  reason: z.string().trim().max(500).optional(),
});

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise', 'seller', 'vendeur'),
  requirePermission('returns.create'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;
    const fid = resolveFranchiseId(req.user, input.franchiseId);
    const product = await Product.findById(input.productId);
    if (!product) throw badRequest('Product not found');

    const session = await mongoose.startSession();
    let createdId: string | null = null;

    try {
      const committedId = await session.withTransaction(async () => {
        const docs = await Return.create(
          [
            {
              franchiseId: fid,
              productId: input.productId,
              quantity: input.quantity,
              returnType: input.returnType,
              reason: input.reason ?? '',
              unitPrice: product.sellPrice ?? 0,
              userId: req.user!.sub,
            },
          ],
          { session },
        );
        const created = docs[0];
        if (!created) throw badRequest('Failed to create return record');

        if (input.returnType === 'return') {
          await applyStockDelta({
            franchiseId: fid,
            productId: input.productId,
            delta: input.quantity,
            type: 'return',
            unitPrice: product.sellPrice ?? 0,
            note: input.reason,
            userId: req.user!.sub,
            refId: created._id as mongoose.Types.ObjectId,
            session,
          });
        }
        return created._id.toString();
      });
      createdId = committedId ?? null;
    } finally {
      await session.endSession();
    }

    if (!createdId) throw badRequest('Failed to create return record');
    await audit(req, {
      action: 'return.create',
      entity: 'Return',
      entityId: createdId.toString(),
      franchiseId: fid,
      details: {
        productId: input.productId,
        quantity: input.quantity,
        returnType: input.returnType,
      },
    });

    const row = await Return.findById(createdId)
      .populate('franchiseId', 'name')
      .populate('productId', 'name reference barcode')
      .populate('userId', 'fullName username')
      .lean();
    res.status(201).json({ return: row });
  }),
);

export default router;
