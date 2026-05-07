import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission, requireRole, franchiseScopeFilter } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Installment } from '../models/Installment.js';
import { Sale } from '../models/Sale.js';
import { Client } from '../models/Client.js';
import { audit } from '../services/audit.service.js';
import { refreshInstallmentNotifications } from '../services/installmentNotifications.service.js';
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
  requirePermission('installments.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, status, limit } = req.query as unknown as z.infer<typeof listQuery>;
    await refreshInstallmentNotifications();

    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (status) filter.status = status;
    const installments = (await Installment.find(filter)
      .sort({ dueDate: 1 })
      .limit(limit)
      .populate({ path: 'saleId', match: { cancelledAt: null }, select: 'total createdAt invoiceNumber saleType paymentStatus' })
      .populate('clientId', 'fullName phone phone2')
      .populate('userId', 'username fullName'))
      .filter((installment) => installment.saleId);
    res.json({ installments });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('installments.manage'),
  validate(payload),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof payload>;
    const sale = await Sale.findById(input.saleId);
    if (!sale) throw notFound('Sale not found');
    if (sale.cancelledAt) throw badRequest('Cannot create installments for a cancelled sale');
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
  amount: z.number().positive().optional(),
  remainingDueDate: z.string().datetime().optional(),
  note: z.string().trim().max(1000).optional(),
});

router.post(
  '/:id/pay',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('installments.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(paySchema),
  asyncHandler(async (req, res) => {
    const installment = await Installment.findById(req.params.id);
    if (!installment) throw notFound('Installment not found');
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== installment.franchiseId.toString()) throw forbidden();
    if (installment.status === 'paid') throw badRequest('Installment already paid');
    const linkedSale = await Sale.findById(installment.saleId).select('cancelledAt');
    if (!linkedSale) throw notFound('Sale not found');
    if (linkedSale.cancelledAt) throw badRequest('Cannot pay an installment linked to a cancelled sale');

    const input = req.body as z.infer<typeof paySchema>;
    const paidAmount = Math.round((input.amount ?? installment.amount) * 100) / 100;
    if (paidAmount <= 0) throw badRequest('Payment amount must be positive');
    if (paidAmount > installment.amount) throw badRequest('Payment amount cannot exceed installment amount');

    let remainderInstallment = null;
    const originalAmount = installment.originalAmount ?? installment.amount;
    const remainingAmount = Math.round((installment.amount - paidAmount) * 100) / 100;
    let remainderDueDate: Date | null = null;
    if (remainingAmount > 0) {
      remainderDueDate = input.remainingDueDate ? new Date(input.remainingDueDate) : new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
      if (Number.isNaN(remainderDueDate.getTime())) throw badRequest('Invalid remaining due date');
    }

    installment.originalAmount = originalAmount;
    installment.amount = paidAmount;
    installment.paidAmount = paidAmount;
    installment.status = 'paid';
    installment.paidAt = new Date();
    installment.paymentMethod = input.paymentMethod ?? installment.paymentMethod;
    installment.note = input.note
      ? [installment.note, input.note].filter(Boolean).join(' | ')
      : installment.note;
    await installment.save();

    if (remainingAmount > 0) {
      remainderInstallment = await Installment.create({
        saleId: installment.saleId,
        franchiseId: installment.franchiseId,
        clientId: installment.clientId ?? null,
        amount: remainingAmount,
        originalAmount: remainingAmount,
        dueDate: remainderDueDate!,
        status: 'pending',
        paymentMethod: null,
        note: input.note
          ? `Reste apres paiement partiel: ${input.note}`
          : `Reste apres paiement partiel de ${paidAmount}`,
        splitFromInstallmentId: installment._id,
        userId: req.user!.sub,
      });
    }

    const sale = await Sale.findById(installment.saleId).select('total amountReceived paymentStatus');
    if (sale) {
      const received = Math.round(((sale.amountReceived ?? 0) + paidAmount) * 100) / 100;
      sale.amountReceived = Math.min(sale.total, received);
      sale.paymentStatus = sale.amountReceived >= sale.total
        ? 'paid'
        : sale.amountReceived > 0
          ? 'partial'
          : 'pending';
      await sale.save();
    }

    await audit(req, {
      action: 'installment.pay',
      entity: 'Installment',
      entityId: installment._id.toString(),
      franchiseId: installment.franchiseId.toString(),
      details: { amount: paidAmount, remainingAmount, salePaymentStatus: sale?.paymentStatus ?? null },
    });

    res.json({ installment, remainderInstallment });
  }),
);

router.post(
  '/generate',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('installments.manage'),
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
    if (sale.cancelledAt) throw badRequest('Cannot generate installments for a cancelled sale');
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
