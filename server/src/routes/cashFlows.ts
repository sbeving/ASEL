import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { CashFlow } from '../models/CashFlow.js';
import { audit } from '../services/audit.service.js';
import { treasuryAttachmentUpload, toUploadPath } from '../middleware/upload.js';
import { badRequest, forbidden } from '../utils/AppError.js';

const router = Router();

const flowBodySchema = z.object({
  franchiseId: z.string().refine(isValidObjectId).optional(),
  type: z.enum(['encaissement', 'decaissement']),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(1).max(255),
  reference: z.string().trim().max(120).optional(),
  date: z.string().trim().optional(),
});

const listQuerySchema = z.object({
  franchiseId: z.string().refine(isValidObjectId).optional(),
  type: z.enum(['encaissement', 'decaissement']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.post(
  '/',
  requireAuth,
  requirePermission('cashflows.manage'),
  treasuryAttachmentUpload.single('attachment'),
  asyncHandler(async (req, res) => {
    const parsed = flowBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid cashflow payload', parsed.error.flatten());
    }
    const input = parsed.data;

    const fid = req.user!.franchiseId || input.franchiseId;
    if (!fid) throw forbidden('franchiseId required');
    if (req.user!.franchiseId && req.user!.franchiseId !== fid) throw forbidden();
    const movementDate = input.date ? new Date(input.date) : new Date();
    if (Number.isNaN(movementDate.getTime())) throw badRequest('Invalid date');

    const flow = await CashFlow.create({
      franchiseId: fid,
      userId: req.user!.sub,
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      reference: input.reference ?? '',
      date: movementDate,
      ...(req.file
        ? {
            attachmentPath: toUploadPath('treasury-docs', req.file.filename),
            attachmentMimeType: req.file.mimetype,
            attachmentOriginalName: req.file.originalname,
          }
        : {}),
    });

    await audit(req, {
      action: 'cashflow.create',
      entity: 'CashFlow',
      entityId: flow._id.toString(),
      franchiseId: fid,
      details: { type: input.type, amount: input.amount },
    });

    res.status(201).json({ flow });
  }),
);

router.get(
  '/',
  requireAuth,
  requirePermission('cashflows.view'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };
    if (query.franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== query.franchiseId) throw forbidden();
      filter.franchiseId = query.franchiseId;
    }
    if (query.type) filter.type = query.type;
    if (query.from || query.to) {
      filter.date = mongoose.trusted({
        ...(query.from ? { $gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
        ...(query.to ? { $lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      });
    }

    const flows = await CashFlow.find(filter)
      .sort({ date: -1 })
      .limit(query.limit)
      .populate('userId', 'fullName username')
      .populate('franchiseId', 'name');
    res.json({ flows });
  }),
);

export default router;
