import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { TimeLog } from '../models/TimeLog.js';
import { audit } from '../services/audit.service.js';
import { badRequest } from '../utils/AppError.js';

const router = Router();

const logSchema = z.object({
  type: z.enum(['entree', 'sortie', 'pause_debut', 'pause_fin']),
  gps: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional()
  }).optional(),
  note: z.string().max(500).optional()
});

router.post(
  '/',
  requireAuth,
  requirePermission('timelogs.create'),
  validate(logSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof logSchema>;
    if (!req.user!.franchiseId) throw badRequest('User must belong to a franchise to punch in');

    const log = await TimeLog.create({
      userId: req.user!.sub,
      franchiseId: req.user!.franchiseId,
      type: input.type,
      gps: input.gps,
      note: input.note,
      device: req.headers['user-agent']
    });

    await audit(req, {
      action: 'timelog.create',
      entity: 'TimeLog',
      entityId: log._id.toString(),
      franchiseId: req.user!.franchiseId,
      details: { type: input.type }
    });

    res.status(201).json({ log });
  })
);

router.get(
  '/',
  requireAuth,
  requirePermission('timelogs.view.self'),
  asyncHandler(async (req, res) => {
    const logs = await TimeLog.find({ userId: req.user!.sub }).sort({ timestamp: -1 }).limit(100);
    res.json({ logs });
  })
);

export default router;
