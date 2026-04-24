import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission, requireRole, franchiseScopeFilter } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Closing } from '../models/Closing.js';
import { Sale } from '../models/Sale.js';
import { Franchise } from '../models/Franchise.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

function dayBounds(dateStr: string): { start: Date; end: Date } {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) throw badRequest('Invalid date');
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const submitSchema = z.object({
  franchiseId: objectId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  declaredSalesTotal: z.number().min(0),
  declaredItemsTotal: z.number().min(0),
  comment: z.string().trim().max(2000).optional(),
});

const querySchema = z.object({
  franchiseId: objectId.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

router.get(
  '/',
  requireAuth,
  requirePermission('closings.view'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, from, to, limit } = req.query as unknown as z.infer<typeof querySchema>;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (from || to) {
      filter.closingDate = mongoose.trusted({
        ...(from ? { $gte: dayBounds(from).start } : {}),
        ...(to ? { $lte: dayBounds(to).end } : {}),
      });
    }

    const closings = await Closing.find(filter)
      .sort({ closingDate: -1 })
      .limit(limit)
      .populate('franchiseId', 'name')
      .populate('submittedBy', 'username fullName')
      .populate('validatedBy', 'username fullName');
    res.json({ closings });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('closings.submit'),
  validate(submitSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof submitSchema>;
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== input.franchiseId) throw forbidden();
    if (!(await Franchise.exists({ _id: input.franchiseId }))) throw badRequest('franchiseId does not exist');

    const { start, end } = dayBounds(input.date);
    const sales = await Sale.find({
      franchiseId: input.franchiseId,
      createdAt: mongoose.trusted({ $gte: start, $lte: end }),
    }).select('items total');
    const systemSalesTotal = Math.round(sales.reduce((sum, s) => sum + (s.total ?? 0), 0) * 100) / 100;
    const systemItemsTotal = sales.reduce((sum, s) => sum + s.items.reduce((sub, i) => sub + i.quantity, 0), 0);

    const closing = await Closing.findOneAndUpdate(
      { franchiseId: input.franchiseId, closingDate: start },
      {
        franchiseId: input.franchiseId,
        closingDate: start,
        declaredSalesTotal: input.declaredSalesTotal,
        declaredItemsTotal: input.declaredItemsTotal,
        systemSalesTotal,
        systemItemsTotal,
        comment: input.comment,
        validated: false,
        submittedBy: req.user!.sub,
        validatedBy: null,
        validatedAt: null,
      },
      { upsert: true, new: true },
    );

    await audit(req, {
      action: 'closing.submit',
      entity: 'Closing',
      entityId: closing._id.toString(),
      franchiseId: input.franchiseId,
      details: {
        date: input.date,
        declaredSalesTotal: input.declaredSalesTotal,
        systemSalesTotal,
        variance: Math.round((input.declaredSalesTotal - systemSalesTotal) * 100) / 100,
      },
    });

    res.status(201).json({ closing });
  }),
);

router.post(
  '/:id/validate',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('closings.validate'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const closing = await Closing.findById(req.params.id);
    if (!closing) throw notFound('Closing not found');
    if (closing.validated) throw badRequest('Closing already validated');

    closing.validated = true;
    closing.validatedBy = req.user!.sub as any;
    closing.validatedAt = new Date();
    await closing.save();

    await audit(req, {
      action: 'closing.validate',
      entity: 'Closing',
      entityId: closing._id.toString(),
      franchiseId: closing.franchiseId.toString(),
    });

    res.json({ closing });
  }),
);

export default router;
