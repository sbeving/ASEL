import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import {
  requireAuth,
  requirePermission,
  requireRole,
  franchiseScopeFilter,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Closing } from '../models/Closing.js';
import { Franchise } from '../models/Franchise.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import {
  closingRequiresVarianceReason,
  closingVarianceAmount,
  computeClosingSummary,
  dayBounds,
  normalizeClosingCashDenominations,
} from '../services/closing.service.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const submitSchema = z.object({
  franchiseId: objectId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  declaredSalesTotal: z.number().min(0),
  declaredItemsTotal: z.number().min(0),
  cashDenominations: z
    .array(
      z.object({
        label: z.string().trim().max(20).optional(),
        value: z.number().min(0),
        quantity: z.number().int().min(0),
      }),
    )
    .max(20)
    .optional(),
  varianceReason: z.string().trim().max(1000).optional(),
  comment: z.string().trim().max(2000).optional(),
});

const updateSchema = z
  .object({
    franchiseId: objectId.optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    declaredSalesTotal: z.number().min(0).optional(),
    declaredItemsTotal: z.number().min(0).optional(),
    cashDenominations: z
      .array(
        z.object({
          label: z.string().trim().max(20).optional(),
          value: z.number().min(0),
          quantity: z.number().int().min(0),
        }),
      )
      .max(20)
      .optional(),
    varianceReason: z.string().trim().max(1000).optional(),
    comment: z.string().trim().max(2000).optional(),
    validated: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const querySchema = z.object({
  franchiseId: objectId.optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const summarySchema = z.object({
  franchiseId: objectId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.get(
  '/summary',
  requireAuth,
  requirePermission('closings.view'),
  validate(summarySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, date } = req.query as unknown as z.infer<
      typeof summarySchema
    >;
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== franchiseId)
      throw forbidden();
    res.json({ summary: await computeClosingSummary(franchiseId, date) });
  }),
);

router.get(
  '/',
  requireAuth,
  requirePermission('closings.view'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, from, to, limit } = req.query as unknown as z.infer<
      typeof querySchema
    >;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId)
        throw forbidden();
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
    if (scope.franchiseId && scope.franchiseId !== input.franchiseId)
      throw forbidden();
    if (!(await Franchise.exists({ _id: input.franchiseId })))
      throw badRequest('franchiseId does not exist');

    const { start } = dayBounds(input.date);
    const summary = await computeClosingSummary(input.franchiseId, input.date);
    const denominations = normalizeClosingCashDenominations(
      input.cashDenominations ?? [],
    );
    const declaredSalesTotal =
      denominations.lines.length > 0
        ? denominations.total
        : input.declaredSalesTotal;
    const variance = closingVarianceAmount(
      declaredSalesTotal,
      summary.expectedDrawerTotal,
    );
    if (
      closingRequiresVarianceReason(
        declaredSalesTotal,
        summary.expectedDrawerTotal,
      ) &&
      !input.varianceReason?.trim()
    ) {
      throw badRequest(
        'Variance reason is required for cash drawer differences over threshold',
      );
    }

    const closing = await Closing.findOneAndUpdate(
      { franchiseId: input.franchiseId, closingDate: start },
      {
        franchiseId: input.franchiseId,
        closingDate: start,
        declaredSalesTotal,
        declaredItemsTotal: input.declaredItemsTotal,
        systemSalesTotal: summary.systemSalesTotal,
        systemItemsTotal: summary.systemItemsTotal,
        systemCashTotal: summary.systemCashTotal,
        cashSalesTotal: summary.cashSalesTotal,
        cashInstallmentsTotal: summary.cashInstallmentsTotal,
        cardSalesTotal: summary.cardSalesTotal,
        transferSalesTotal: summary.transferSalesTotal,
        otherSalesTotal: summary.otherSalesTotal,
        installmentAdvancesTotal: summary.installmentAdvancesTotal,
        installmentDueTotal: summary.installmentDueTotal,
        installmentDueCount: summary.installmentDueCount,
        installmentPaidTotal: summary.installmentPaidTotal,
        installmentPaidCount: summary.installmentPaidCount,
        treasuryCashInTotal: summary.treasuryCashInTotal,
        treasuryCashOutTotal: summary.treasuryCashOutTotal,
        returnRefundTotal: summary.returnRefundTotal,
        expectedDrawerTotal: summary.expectedDrawerTotal,
        cashDenominations: denominations.lines,
        varianceReason: input.varianceReason ?? '',
        comment: input.comment,
        autoGenerated: false,
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
        declaredSalesTotal,
        systemSalesTotal: summary.systemSalesTotal,
        systemCashTotal: summary.systemCashTotal,
        cashSalesTotal: summary.cashSalesTotal,
        installmentAdvancesTotal: summary.installmentAdvancesTotal,
        cashInstallmentsTotal: summary.cashInstallmentsTotal,
        installmentDueTotal: summary.installmentDueTotal,
        installmentDueCount: summary.installmentDueCount,
        installmentPaidTotal: summary.installmentPaidTotal,
        installmentPaidCount: summary.installmentPaidCount,
        treasuryCashInTotal: summary.treasuryCashInTotal,
        treasuryCashOutTotal: summary.treasuryCashOutTotal,
        returnRefundTotal: summary.returnRefundTotal,
        expectedDrawerTotal: summary.expectedDrawerTotal,
        variance,
        varianceReason: input.varianceReason ?? '',
      },
    });

    res.status(201).json({ closing });
  }),
);

router.post(
  '/:id/validate',
  requireAuth,
  requireRole('admin', 'manager', 'cash_central_maintainer'),
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

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'cash_central_maintainer'),
  requirePermission('closings.submit', 'closings.validate'),
  validate(z.object({ id: objectId }), 'params'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateSchema>;
    const closing = await Closing.findById(req.params.id);
    if (!closing) throw notFound('Closing not found');

    const nextFranchiseId = input.franchiseId ?? closing.franchiseId.toString();
    const nextDate =
      input.date ?? closing.closingDate.toISOString().slice(0, 10);
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== nextFranchiseId)
      throw forbidden();
    if (!(await Franchise.exists({ _id: nextFranchiseId })))
      throw badRequest('franchiseId does not exist');

    const { start } = dayBounds(nextDate);
    const summary = await computeClosingSummary(nextFranchiseId, nextDate);
    const denominations = input.cashDenominations
      ? normalizeClosingCashDenominations(input.cashDenominations)
      : {
          lines: closing.cashDenominations ?? [],
          total: closing.declaredSalesTotal,
        };
    const nextDeclaredSalesTotal = input.cashDenominations
      ? denominations.total
      : input.declaredSalesTotal !== undefined
        ? input.declaredSalesTotal
        : closing.declaredSalesTotal;
    const nextVarianceReason =
      input.varianceReason ?? closing.varianceReason ?? '';
    if (
      closingRequiresVarianceReason(
        nextDeclaredSalesTotal,
        summary.expectedDrawerTotal,
      ) &&
      !nextVarianceReason.trim()
    ) {
      throw badRequest(
        'Variance reason is required for cash drawer differences over threshold',
      );
    }
    const before = {
      franchiseId: closing.franchiseId.toString(),
      closingDate: closing.closingDate,
      declaredSalesTotal: closing.declaredSalesTotal,
      declaredItemsTotal: closing.declaredItemsTotal,
      systemCashTotal: closing.systemCashTotal,
      validated: closing.validated,
    };

    closing.franchiseId = nextFranchiseId as any;
    closing.closingDate = start;
    closing.declaredSalesTotal = nextDeclaredSalesTotal;
    if (input.declaredItemsTotal !== undefined)
      closing.declaredItemsTotal = input.declaredItemsTotal;
    if (input.cashDenominations)
      closing.cashDenominations = denominations.lines as any;
    if (input.varianceReason !== undefined)
      closing.varianceReason = input.varianceReason;
    if (input.comment !== undefined) closing.comment = input.comment;
    closing.systemSalesTotal = summary.systemSalesTotal;
    closing.systemItemsTotal = summary.systemItemsTotal;
    closing.systemCashTotal = summary.systemCashTotal;
    closing.cashSalesTotal = summary.cashSalesTotal;
    closing.cashInstallmentsTotal = summary.cashInstallmentsTotal;
    closing.cardSalesTotal = summary.cardSalesTotal;
    closing.transferSalesTotal = summary.transferSalesTotal;
    closing.otherSalesTotal = summary.otherSalesTotal;
    closing.installmentAdvancesTotal = summary.installmentAdvancesTotal;
    closing.installmentDueTotal = summary.installmentDueTotal;
    closing.installmentDueCount = summary.installmentDueCount;
    closing.installmentPaidTotal = summary.installmentPaidTotal;
    closing.installmentPaidCount = summary.installmentPaidCount;
    closing.treasuryCashInTotal = summary.treasuryCashInTotal;
    closing.treasuryCashOutTotal = summary.treasuryCashOutTotal;
    closing.returnRefundTotal = summary.returnRefundTotal;
    closing.expectedDrawerTotal = summary.expectedDrawerTotal;
    closing.autoGenerated = false;
    if (input.validated !== undefined) {
      closing.validated = input.validated;
      closing.validatedBy = input.validated ? (req.user!.sub as any) : null;
      closing.validatedAt = input.validated ? new Date() : null;
    }
    await closing.save();

    await audit(req, {
      action: 'closing.update',
      entity: 'Closing',
      entityId: closing._id.toString(),
      franchiseId: closing.franchiseId.toString(),
      details: { before, after: input },
    });

    res.json({ closing });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'cash_central_maintainer'),
  requirePermission('closings.validate'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const closing = await Closing.findById(req.params.id);
    if (!closing) throw notFound('Closing not found');
    const scope = franchiseScopeFilter(req.user);
    if (
      scope.franchiseId &&
      scope.franchiseId !== closing.franchiseId.toString()
    )
      throw forbidden();
    await closing.deleteOne();

    await audit(req, {
      action: 'closing.delete',
      entity: 'Closing',
      entityId: closing._id.toString(),
      franchiseId: closing.franchiseId.toString(),
      details: {
        date: closing.closingDate,
        declaredSalesTotal: closing.declaredSalesTotal,
      },
    });

    res.json({ ok: true });
  }),
);

export default router;
