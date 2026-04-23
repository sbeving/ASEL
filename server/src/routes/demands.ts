import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Demand } from '../models/Demand.js';
import { Product } from '../models/Product.js';
import { Franchise } from '../models/Franchise.js';
import { applyStockDelta } from '../services/stock.service.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const listQuery = z.object({
  franchiseId: objectId.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'delivered']).optional(),
  urgency: z.enum(['normal', 'urgent', 'critical']).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(30),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get(
  '/',
  requireAuth,
  requirePermission('demands.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, status, urgency, q, page, pageSize, limit } =
      req.query as unknown as z.infer<typeof listQuery>;
    const effectivePageSize = limit ?? pageSize;
    const skip = (page - 1) * effectivePageSize;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };

    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (status) filter.status = status;
    if (urgency) filter.urgency = urgency;
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [{ productName: rx }, { note: rx }, { response: rx }];
    }

    const [total, demands, summaryRows] = await Promise.all([
      Demand.countDocuments(filter),
      Demand.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(effectivePageSize)
        .populate('franchiseId', 'name')
        .populate('sourceFranchiseId', 'name')
        .populate('productId', 'name reference barcode')
        .populate('requestedBy', 'fullName username')
        .populate('processedBy', 'fullName username')
        .lean(),
      Demand.aggregate<{
        _id: null;
        pending: number;
        urgent: number;
        critical: number;
      }>([
        { $match: filter },
        {
          $group: {
            _id: null,
            pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
            urgent: { $sum: { $cond: [{ $eq: ['$urgency', 'urgent'] }, 1, 0] } },
            critical: { $sum: { $cond: [{ $eq: ['$urgency', 'critical'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    res.json({
      demands,
      summary: summaryRows[0] ?? { pending: 0, urgent: 0, critical: 0 },
      meta: {
        page,
        pageSize: effectivePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / effectivePageSize)),
      },
    });
  }),
);

const createSchema = z
  .object({
    franchiseId: objectId.optional(),
    productId: objectId.nullable().optional(),
    productName: z.string().trim().max(200).optional(),
    quantity: z.number().int().positive(),
    urgency: z.enum(['normal', 'urgent', 'critical']).default('normal'),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => !!v.productId || !!v.productName, {
    path: ['productName'],
    message: 'productId or productName is required',
  });

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise', 'seller', 'vendeur'),
  requirePermission('demands.create'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;
    const scope = franchiseScopeFilter(req.user);
    const scopedFranchiseId =
      typeof scope.franchiseId === 'string' ? scope.franchiseId : undefined;
    const targetFranchiseId = scopedFranchiseId ?? input.franchiseId;
    if (!targetFranchiseId) throw badRequest('franchiseId is required');
    if (!(await Franchise.exists({ _id: targetFranchiseId }))) throw badRequest('franchiseId does not exist');

    let productName = input.productName?.trim() ?? '';
    if (input.productId) {
      const product = await Product.findById(input.productId).select('name');
      if (!product) throw badRequest('Product not found');
      if (!productName) productName = product.name;
    }

    const demand = await Demand.create({
      franchiseId: targetFranchiseId,
      productId: input.productId ?? null,
      productName,
      quantity: input.quantity,
      urgency: input.urgency,
      note: input.note ?? '',
      requestedBy: req.user!.sub,
    });

    await audit(req, {
      action: 'demand.create',
      entity: 'Demand',
      entityId: demand._id.toString(),
      franchiseId: targetFranchiseId,
      details: { quantity: input.quantity, urgency: input.urgency, productId: input.productId ?? null },
    });

    res.status(201).json({ demand });
  }),
);

const processSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'delivered']),
  response: z.string().trim().max(1000).optional(),
  sourceFranchiseId: objectId.optional(),
});

router.post(
  '/:id/process',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('demands.process'),
  validate(z.object({ id: objectId }), 'params'),
  validate(processSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof processSchema>;
    const demand = await Demand.findById(id);
    if (!demand) throw notFound('Demand not found');
    if (demand.status !== 'pending') throw badRequest('Only pending demands can be processed');

    if (input.decision === 'delivered') {
      if (!demand.productId) throw badRequest('Demand has no product to deliver');
      if (!input.sourceFranchiseId) throw badRequest('sourceFranchiseId is required for delivered demand');
      if (!(await Franchise.exists({ _id: input.sourceFranchiseId }))) throw badRequest('sourceFranchiseId does not exist');

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await applyStockDelta({
            franchiseId: input.sourceFranchiseId!,
            productId: demand.productId!,
            delta: -demand.quantity,
            type: 'transfer_out',
            userId: req.user!.sub,
            note: `Demand #${demand._id}`,
            refId: demand._id,
            session,
          });
          await applyStockDelta({
            franchiseId: demand.franchiseId,
            productId: demand.productId!,
            delta: demand.quantity,
            type: 'transfer_in',
            userId: req.user!.sub,
            note: `Demand #${demand._id}`,
            refId: demand._id,
            session,
          });

          demand.status = 'delivered';
          demand.processedBy = new mongoose.Types.ObjectId(req.user!.sub);
          demand.processedAt = new Date();
          demand.response = input.response ?? '';
          demand.sourceFranchiseId = new mongoose.Types.ObjectId(input.sourceFranchiseId!);
          await demand.save({ session });
        });
      } finally {
        await session.endSession();
      }
    } else {
      demand.status = input.decision;
      demand.processedBy = new mongoose.Types.ObjectId(req.user!.sub);
      demand.processedAt = new Date();
      demand.response = input.response ?? '';
      demand.sourceFranchiseId = null;
      await demand.save();
    }

    await audit(req, {
      action: 'demand.process',
      entity: 'Demand',
      entityId: demand._id.toString(),
      franchiseId: demand.franchiseId.toString(),
      details: {
        decision: input.decision,
        sourceFranchiseId: input.sourceFranchiseId ?? null,
      },
    });

    const row = await Demand.findById(demand._id)
      .populate('franchiseId', 'name')
      .populate('sourceFranchiseId', 'name')
      .populate('productId', 'name reference barcode')
      .populate('requestedBy', 'fullName username')
      .populate('processedBy', 'fullName username')
      .lean();
    res.json({ demand: row });
  }),
);

export default router;
