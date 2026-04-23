import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, franchiseScopeFilter } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { CashFlow } from '../models/CashFlow.js';
import { audit } from '../services/audit.service.js';
import { forbidden } from '../utils/AppError.js';

const router = Router();

const flowSchema = z.object({
  franchiseId: z.string().refine(isValidObjectId).optional(),
  type: z.enum(['encaissement', 'decaissement']),
  amount: z.number().positive(),
  reason: z.string().min(1).max(255),
  reference: z.string().max(100).optional(),
});

router.post(
  '/',
  requireAuth,
  validate(flowSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof flowSchema>;
    const fid = req.user!.franchiseId || input.franchiseId;
    if (!fid) throw forbidden('franchiseId required');
    if (req.user!.franchiseId && req.user!.franchiseId !== fid) throw forbidden();

    const flow = await CashFlow.create({
      franchiseId: fid,
      userId: req.user!.sub,
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      reference: input.reference,
    });

    await audit(req, {
      action: 'cashflow.create',
      entity: 'CashFlow',
      entityId: flow._id.toString(),
      franchiseId: fid,
      details: { type: input.type, amount: input.amount }
    });

    res.status(201).json({ flow });
  })
);

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const scope = franchiseScopeFilter(req.user);
    const flows = await CashFlow.find(scope).sort({ date: -1 }).limit(100).populate('userId', 'fullName username');
    res.json({ flows });
  })
);

export default router;
