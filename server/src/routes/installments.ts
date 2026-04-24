import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { requireAuth, requireRole, franchiseScopeFilter } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Installment } from '../models/Installment.js';
import { Sale } from '../models/Sale.js';
import { Client } from '../models/Client.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const payload = z.object({
  saleId: objectId,
  clientId: objectId.nullable().optional(),
  amount: z.number().min(0),
  dueDate: z.string().datetime(),
  note: z.string().trim().max(1000).optional(),
});

const listQuery = z.object({
  franchiseId: objectId.optional(),
  status: z.enum(['pending', 'paid', 'late']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

router.get(
  '/',
  requireAuth,
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, status, limit } = req.query as unknown as z.infer<typeof listQuery>;
    await Installment.updateMany(
      { status: 'pending', dueDate: mongoose.trusted({ $lt: new Date() }) },
      { $set: { status: 'late' } },
    );

    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (status) filter.status = status;
    const installments = await Installment.find(filter)
      .sort({ dueDate: 1 })
      .limit(limit)
      .populate('saleId', 'total createdAt invoiceNumber saleType paymentStatus')
      .populate('clientId', 'fullName phone')
      .populate('userId', 'username fullName');
    res.json({ installments });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  validate(payload),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof payload>;
    const sale = await Sale.findById(input.saleId);
    if (!sale) throw notFound('Sale not found');
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== sale.franchiseId.toString()) throw forbidden();

    if (input.clientId && !(await Client.exists({ _id: input.clientId }))) {
      throw badRequest('clientId does not exist');
    }

    const installment = await Installment.create({
      saleId: sale._id,
      franchiseId: sale.franchiseId,
      clientId: input.clientId ?? null,
      amount: input.amount,
      dueDate: new Date(input.dueDate),
      note: input.note,
      userId: req.user!.sub,
    });

    await audit(req, {
      action: 'installment.create',
      entity: 'Installment',
      entityId: installment._id.toString(),
      franchiseId: sale.franchiseId.toString(),
      details: { saleId: sale._id.toString(), amount: installment.amount },
    });

    res.status(201).json({ installment });
  }),
);

const paySchema = z.object({
  paymentMethod: z.string().trim().max(40).optional(),
});

router.post(
  '/:id/pay',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  validate(z.object({ id: objectId }), 'params'),
  validate(paySchema),
  asyncHandler(async (req, res) => {
    const installment = await Installment.findById(req.params.id);
    if (!installment) throw notFound('Installment not found');
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== installment.franchiseId.toString()) throw forbidden();
    if (installment.status === 'paid') throw badRequest('Installment already paid');

    const input = req.body as z.infer<typeof paySchema>;
    installment.status = 'paid';
    installment.paidAt = new Date();
    installment.paymentMethod = input.paymentMethod ?? installment.paymentMethod;
    await installment.save();

    await audit(req, {
      action: 'installment.pay',
      entity: 'Installment',
      entityId: installment._id.toString(),
      franchiseId: installment.franchiseId.toString(),
      details: { amount: installment.amount },
    });

    res.json({ installment });
  }),
);

router.post(
  '/generate',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  validate(z.object({
    saleId: objectId,
    clientId: objectId.nullable().optional(),
    nbLots: z.number().int().min(1).max(60),
    startDate: z.string().datetime(),
    intervalDays: z.number().int().min(1).default(30),
    note: z.string().max(1000).optional(),
  })),
  asyncHandler(async (req, res) => {
    const input = req.body as { saleId: string; clientId?: string | null; nbLots: number; startDate: string; intervalDays: number; note?: string };
    const sale = await Sale.findById(input.saleId);
    if (!sale) throw notFound('Sale not found');
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== sale.franchiseId.toString()) throw forbidden();

    if (input.clientId && !(await Client.exists({ _id: input.clientId }))) {
      throw badRequest('clientId does not exist');
    }

    const totalAmount = sale.total;
    const baseAmount = Math.floor((totalAmount / input.nbLots) * 100) / 100;
    const remainder = Math.round((totalAmount - (baseAmount * input.nbLots)) * 100) / 100;

    const installmentsData = [];
    let currentDate = new Date(input.startDate);

    for (let i = 0; i < input.nbLots; i++) {
      let amount = baseAmount;
      if (i === input.nbLots - 1) {
        amount = Math.round((amount + remainder) * 100) / 100;
      }

      installmentsData.push({
        saleId: sale._id,
        franchiseId: sale.franchiseId,
        clientId: input.clientId ?? null,
        amount,
        dueDate: new Date(currentDate),
        note: input.note ? `${input.note} (Lot ${i + 1}/${input.nbLots})` : `Lot ${i + 1}/${input.nbLots}`,
        userId: req.user!.sub,
      });

      currentDate.setDate(currentDate.getDate() + input.intervalDays);
    }

    const installments = await Installment.insertMany(installmentsData);

    await audit(req, {
      action: 'installment.generate',
      entity: 'Installment',
      entityId: sale._id.toString(), // using saleId as ref
      franchiseId: sale.franchiseId.toString(),
      details: { saleId: sale._id.toString(), nbLots: input.nbLots, totalAmount },
    });

    res.status(201).json({ installments });
  }),
);

export default router;
