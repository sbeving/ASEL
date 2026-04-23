import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Sale } from '../models/Sale.js';
import { Movement } from '../models/Movement.js';
import { Product } from '../models/Product.js';
import { Stock } from '../models/Stock.js';
import { applyStockDelta } from '../services/stock.service.js';
import { applyCursorFilter, nextCursor, paginationQuery } from '../utils/pagination.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';

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

const saleSchema = z.object({
  franchiseId: objectId.optional(),
  items: z
    .array(
      z.object({
        productId: objectId,
        quantity: z.number().int().positive(),
        unitPrice: z.number().min(0),
      }),
    )
    .min(1),
  discount: z.number().min(0).default(0),
  paymentMethod: z.enum(['cash', 'card', 'transfer', 'other']).default('cash'),
  note: z.string().max(500).optional(),
});

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise', 'seller'),
  validate(saleSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof saleSchema>;
    const fid = resolveFranchiseId(req.user, input.franchiseId);

    // Validate all products exist before touching stock
    const productIds = input.items.map((i) => i.productId);
    const products = await Product.find({ _id: { $in: productIds } }).select('_id active');
    if (products.length !== productIds.length) throw badRequest('One or more products not found');
    if (products.some((p) => !p.active)) throw badRequest('Cannot sell inactive products');

    const computedItems = input.items.map((i) => ({
      productId: new mongoose.Types.ObjectId(i.productId),
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: Math.round(i.quantity * i.unitPrice * 100) / 100,
    }));
    const subtotal = computedItems.reduce((s, i) => s + i.total, 0);
    const discount = input.discount ?? 0;
    if (discount > subtotal) throw badRequest('Discount cannot exceed subtotal');
    const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

    // A real transaction would need a Mongo replica set. To stay
    // correct against a standalone mongod, we apply deltas one by one and
    // roll back any successful ones if a later line fails. Movements are
    // tagged with the sale id so rollback can wipe them by refId.
    const sale = await Sale.create({
      franchiseId: fid,
      userId: req.user!.sub,
      items: computedItems,
      subtotal,
      discount,
      total,
      paymentMethod: input.paymentMethod,
      note: input.note,
    });

    const applied: Array<{ productId: mongoose.Types.ObjectId; delta: number }> = [];
    try {
      for (const item of computedItems) {
        await applyStockDelta({
          franchiseId: fid,
          productId: item.productId,
          delta: -item.quantity,
          type: 'sale',
          userId: req.user!.sub,
          unitPrice: item.unitPrice,
          refId: sale._id,
        });
        applied.push({ productId: item.productId, delta: -item.quantity });
      }
    } catch (err) {
      for (const a of applied) {
        await Stock.updateOne(
          { franchiseId: fid, productId: a.productId },
          { $inc: { quantity: -a.delta } },
        );
      }
      await Movement.deleteMany({ refId: sale._id });
      await Sale.deleteOne({ _id: sale._id });
      throw err;
    }

    await audit(req, {
      action: 'sale.create',
      entity: 'Sale',
      entityId: sale._id.toString(),
      franchiseId: fid,
      details: { total, itemCount: computedItems.length },
    });

    res.status(201).json({ sale });
  }),
);

const listQuery = paginationQuery.extend({
  franchiseId: objectId.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

router.get(
  '/',
  requireAuth,
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, from, to, limit, cursor } = req.query as unknown as z.infer<typeof listQuery>;
    const scope = franchiseScopeFilter(req.user);
    let filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (from || to) {
      filter.createdAt = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      };
    }
    filter = applyCursorFilter(cursor, filter);
    const sales = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', 'username fullName')
      .populate('items.productId', 'name reference');
    res.json({ sales, nextCursor: nextCursor(sales, limit) });
  }),
);

router.get(
  '/:id',
  requireAuth,
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const sale = await Sale.findById(req.params.id)
      .populate('userId', 'username fullName')
      .populate('items.productId', 'name reference');
    if (!sale) throw notFound('Sale not found');
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && sale.franchiseId?.toString() !== scope.franchiseId) throw forbidden();
    res.json({ sale });
  }),
);

export default router;
