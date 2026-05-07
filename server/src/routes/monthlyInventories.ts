import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { MonthlyInventory } from '../models/MonthlyInventory.js';
import { Stock } from '../models/Stock.js';
import { Product } from '../models/Product.js';
import { applyStockDelta } from '../services/stock.service.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { isGlobalRole } from '../utils/roles.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const listQuery = z.object({
  franchiseId: objectId.optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  status: z.enum(['draft', 'finalized']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

router.get(
  '/',
  requireAuth,
  requirePermission('monthly_inventory.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, month, status, page, pageSize } = req.query as unknown as z.infer<typeof listQuery>;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };

    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (month) filter.month = month;
    if (status) filter.status = status;

    const skip = (page - 1) * pageSize;
    const [total, inventories] = await Promise.all([
      MonthlyInventory.countDocuments(filter),
      MonthlyInventory.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('franchiseId', 'name')
        .populate('createdBy', 'username fullName')
        .populate('finalizedBy', 'username fullName'),
    ]);

    res.json({
      inventories,
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
  '/:id',
  requireAuth,
  requirePermission('monthly_inventory.view'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const inv = await MonthlyInventory.findById(req.params.id)
      .populate('franchiseId', 'name')
      .populate('createdBy', 'username fullName')
      .populate('finalizedBy', 'username fullName')
      .populate('lines.productId', 'name reference barcode');
    if (!inv) throw notFound('Monthly inventory not found');

    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && inv.franchiseId.toString() !== scope.franchiseId) throw forbidden();

    res.json({ inventory: inv });
  }),
);

const createSchema = z.object({
  franchiseId: objectId.optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  note: z.string().trim().max(1000).optional(),
  applyAdjustments: z.boolean().default(false),
  lines: z
    .array(
      z.object({
        productId: objectId,
        countedQuantity: z.number().int().min(0),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['draft', 'finalized']).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

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

async function computeInventoryLines(
  franchiseId: string,
  inputLines: Array<{ productId: string; countedQuantity: number; note?: string }>,
) {
  const productIds = [...new Set(inputLines.map((l) => l.productId))];
  const products = await Product.find({ _id: mongoose.trusted({ $in: productIds }), active: true }).select('_id');
  if (products.length !== productIds.length) throw badRequest('One or more products do not exist or are inactive');

  const stocks = await Stock.find({ franchiseId, productId: mongoose.trusted({ $in: productIds }) }).select('productId quantity');
  const stockByProduct = new Map(stocks.map((s) => [s.productId.toString(), s.quantity]));

  return inputLines.map((line) => {
    const systemQuantity = stockByProduct.get(line.productId) ?? 0;
    const variance = line.countedQuantity - systemQuantity;
    return {
      productId: line.productId,
      systemQuantity,
      countedQuantity: line.countedQuantity,
      variance,
      note: line.note,
    };
  });
}

type InventoryVarianceLine = {
  productId: unknown;
  variance: number;
  note?: string | null;
};

function toObjectIdString(value: unknown) {
  return value instanceof mongoose.Types.ObjectId ? value.toString() : String(value);
}

async function applyInventoryVariance(
  inventory: { _id: unknown; month: string; lines: Iterable<InventoryVarianceLine> },
  franchiseId: string,
  userId: string,
  direction: 1 | -1,
) {
  const refId =
    inventory._id instanceof mongoose.Types.ObjectId
      ? inventory._id
      : new mongoose.Types.ObjectId(String(inventory._id));
  for (const line of inventory.lines) {
    if (line.variance === 0) continue;
    await applyStockDelta({
      franchiseId,
      productId: toObjectIdString(line.productId),
      delta: direction * line.variance,
      type: 'adjustment',
      userId,
      note:
        direction === 1
          ? `Inventaire ${inventory.month}${line.note ? ` - ${line.note}` : ''}`
          : `Annulation correction inventaire ${inventory.month}${line.note ? ` - ${line.note}` : ''}`,
      refId,
    });
  }
}

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'superadmin', 'manager', 'stock_central_maintainer', 'franchise'),
  requirePermission('monthly_inventory.manage'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const franchiseId = resolveFranchiseId(req.user, body.franchiseId);

    const lines = await computeInventoryLines(franchiseId, body.lines);

    const totalSystemQuantity = lines.reduce((sum, l) => sum + l.systemQuantity, 0);
    const totalCountedQuantity = lines.reduce((sum, l) => sum + l.countedQuantity, 0);
    const totalVariance = lines.reduce((sum, l) => sum + l.variance, 0);
    const status = body.applyAdjustments ? 'finalized' : 'draft';

    const inv = await MonthlyInventory.create({
      franchiseId,
      month: body.month,
      status,
      totalSystemQuantity,
      totalCountedQuantity,
      totalVariance,
      appliedAdjustments: body.applyAdjustments,
      note: body.note,
      createdBy: req.user!.sub,
      finalizedBy: body.applyAdjustments ? req.user!.sub : null,
      finalizedAt: body.applyAdjustments ? new Date() : null,
      lines,
    });

    if (body.applyAdjustments) {
      await applyInventoryVariance(inv, franchiseId, req.user!.sub, 1);
    }

    await audit(req, {
      action: body.applyAdjustments ? 'inventory.finalize' : 'inventory.create',
      entity: 'MonthlyInventory',
      entityId: inv._id.toString(),
      franchiseId,
      details: {
        month: body.month,
        lineCount: lines.length,
        totalVariance,
        appliedAdjustments: body.applyAdjustments,
      },
    });

    res.status(201).json({ inventory: inv });
  }),
);

router.post(
  '/:id/finalize',
  requireAuth,
  requireRole('admin', 'superadmin', 'manager', 'stock_central_maintainer', 'franchise'),
  requirePermission('monthly_inventory.manage'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const inv = await MonthlyInventory.findById(req.params.id);
    if (!inv) throw notFound('Monthly inventory not found');

    const resolvedFranchiseId = resolveFranchiseId(req.user, inv.franchiseId.toString());
    if (inv.status === 'finalized') {
      return res.json({ inventory: inv });
    }

    await applyInventoryVariance(inv, resolvedFranchiseId, req.user!.sub, 1);

    inv.status = 'finalized';
    inv.appliedAdjustments = true;
    inv.finalizedBy = req.user!.sub as any;
    inv.finalizedAt = new Date();
    await inv.save();

    await audit(req, {
      action: 'inventory.finalize',
      entity: 'MonthlyInventory',
      entityId: inv._id.toString(),
      franchiseId: resolvedFranchiseId,
      details: { month: inv.month, totalVariance: inv.totalVariance },
    });

    res.json({ inventory: inv });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'superadmin', 'manager', 'stock_central_maintainer', 'franchise'),
  requirePermission('monthly_inventory.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateSchema>;
    const inv = await MonthlyInventory.findById(req.params.id);
    if (!inv) throw notFound('Monthly inventory not found');

    const oldFranchiseId = inv.franchiseId.toString();
    const nextFranchiseId = resolveFranchiseId(req.user, input.franchiseId ?? oldFranchiseId);
    const wasAdjusted = inv.appliedAdjustments || inv.status === 'finalized';
    if (wasAdjusted) {
      await applyInventoryVariance(inv, oldFranchiseId, req.user!.sub, -1);
    }

    const sourceLines: Array<{ productId: string; countedQuantity: number; note?: string }> =
      input.lines ?? inv.lines.map((line) => ({
        productId: line.productId.toString(),
        countedQuantity: line.countedQuantity,
        note: line.note ?? undefined,
      }));
    const lines = await computeInventoryLines(nextFranchiseId, sourceLines);
    const totalSystemQuantity = lines.reduce((sum, line) => sum + line.systemQuantity, 0);
    const totalCountedQuantity = lines.reduce((sum, line) => sum + line.countedQuantity, 0);
    const totalVariance = lines.reduce((sum, line) => sum + line.variance, 0);
    const shouldFinalize =
      input.applyAdjustments !== undefined
        ? input.applyAdjustments
        : input.status !== undefined
          ? input.status === 'finalized'
          : wasAdjusted;

    inv.franchiseId = nextFranchiseId as any;
    if (input.month) inv.month = input.month;
    if (input.note !== undefined) inv.note = input.note;
    inv.lines = lines as any;
    inv.totalSystemQuantity = totalSystemQuantity;
    inv.totalCountedQuantity = totalCountedQuantity;
    inv.totalVariance = totalVariance;
    inv.status = shouldFinalize ? 'finalized' : 'draft';
    inv.appliedAdjustments = shouldFinalize;
    inv.finalizedBy = shouldFinalize ? (req.user!.sub as any) : null;
    inv.finalizedAt = shouldFinalize ? new Date() : null;
    await inv.save();

    if (shouldFinalize) {
      await applyInventoryVariance(inv, nextFranchiseId, req.user!.sub, 1);
    }

    await audit(req, {
      action: 'inventory.update',
      entity: 'MonthlyInventory',
      entityId: inv._id.toString(),
      franchiseId: nextFranchiseId,
      details: {
        oldFranchiseId,
        month: inv.month,
        lineCount: lines.length,
        totalVariance,
        appliedAdjustments: shouldFinalize,
      },
    });

    res.json({ inventory: inv });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'superadmin', 'manager', 'stock_central_maintainer'),
  requirePermission('monthly_inventory.manage'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const inv = await MonthlyInventory.findById(req.params.id);
    if (!inv) throw notFound('Monthly inventory not found');
    const franchiseId = resolveFranchiseId(req.user, inv.franchiseId.toString());

    if (inv.appliedAdjustments || inv.status === 'finalized') {
      await applyInventoryVariance(inv, franchiseId, req.user!.sub, -1);
    }
    await inv.deleteOne();

    await audit(req, {
      action: 'inventory.delete',
      entity: 'MonthlyInventory',
      entityId: inv._id.toString(),
      franchiseId,
      details: {
        month: inv.month,
        totalVariance: inv.totalVariance,
        reversedAdjustments: inv.appliedAdjustments || inv.status === 'finalized',
      },
    });

    res.json({ ok: true });
  }),
);

export default router;
