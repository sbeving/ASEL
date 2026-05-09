import { createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission, requireRole, franchiseScopeFilter } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withMongoTransaction } from '../db/transaction.js';
import { Installment } from '../models/Installment.js';
import { Sale } from '../models/Sale.js';
import { Client } from '../models/Client.js';
import { audit } from '../services/audit.service.js';
import { refreshInstallmentNotifications } from '../services/installmentNotifications.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { ensureUploadDir } from '../config/uploads.js';
import { toUploadPath } from '../middleware/upload.js';
import { nextSequenceValue } from '../services/sequence.service.js';
import { formatInstallmentReceiptNumber, installmentReceiptSequenceKey } from '../utils/documentNumbers.js';

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
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

function statusForDueDate(dueDate: Date): 'pending' | 'late' {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today ? 'late' : 'pending';
}

function formatMoney(value: number) {
  return `${value.toLocaleString('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} TND`;
}

function writeReceiptField(doc: PDFKit.PDFDocument, label: string, value?: string | number | Date | null) {
  const text = value instanceof Date ? value.toLocaleString('fr-TN') : value == null || value === '' ? '-' : String(value);
  doc.fontSize(9).fillColor('#64748b').text(label.toUpperCase());
  doc.fontSize(12).fillColor('#0f172a').text(text, { width: 500 });
  doc.moveDown(0.45);
}

async function assignInstallmentReceiptNumber(installment: any, paidAt: Date, session?: mongoose.ClientSession) {
  if (installment.status !== 'paid' || installment.receiptNumber) return installment;
  const sequence = await nextSequenceValue(installmentReceiptSequenceKey(paidAt), session);
  installment.receiptNumber = formatInstallmentReceiptNumber(paidAt, sequence);
  await installment.save({ session });
  return installment;
}

async function ensureInstallmentReceipt(installment: any, force = false) {
  if (installment.status !== 'paid') return installment;
  if (installment.receiptPath && !force) return installment;

  const paidAt = installment.paidAt instanceof Date ? installment.paidAt : new Date(installment.paidAt ?? Date.now());
  await assignInstallmentReceiptNumber(installment, paidAt);

  const populated = await installment.populate([
    { path: 'franchiseId', select: 'name address phone manager taxId' },
    { path: 'clientId', select: 'fullName phone phone2 email' },
    { path: 'saleId', select: 'invoiceNumber total createdAt saleType' },
    { path: 'userId', select: 'fullName username role' },
  ]);
  const receiptNumber = installment.receiptNumber;
  const filename = `${Date.now()}-${crypto.randomUUID()}-${receiptNumber.toLowerCase()}.pdf`;
  const absolutePath = path.join(ensureUploadDir('installment-receipts'), filename);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const stream = createWriteStream(absolutePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    const franchise = populated.franchiseId && typeof populated.franchiseId === 'object' ? populated.franchiseId : null;
    const client = populated.clientId && typeof populated.clientId === 'object' ? populated.clientId : null;
    const sale = populated.saleId && typeof populated.saleId === 'object' ? populated.saleId : null;
    const author = populated.userId && typeof populated.userId === 'object' ? populated.userId : null;

    doc.fontSize(20).fillColor('#0f172a').text('Recu encaissement echeance');
    doc.fontSize(10).fillColor('#64748b').text(`Genere le ${new Date().toLocaleString('fr-TN')}`);
    doc.moveDown();

    doc.roundedRect(48, doc.y, 500, 72, 8).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#047857').fontSize(24).text(formatMoney(installment.paidAmount || installment.amount), 64, doc.y + 16);
    doc.fillColor('#334155').fontSize(11).text('ECHEANCE ENCAISSEE', 64, doc.y + 2);
    doc.moveDown(3.2);

    writeReceiptField(doc, 'Numero recu', receiptNumber);
    writeReceiptField(doc, 'Facture / vente', sale?.invoiceNumber || sale?._id?.toString?.());
    writeReceiptField(doc, 'Franchise', franchise?.name);
    writeReceiptField(doc, 'Client', client?.fullName);
    writeReceiptField(doc, 'Telephone client', client?.phone || client?.phone2);
    writeReceiptField(doc, 'Date echeance', installment.dueDate);
    writeReceiptField(doc, 'Date encaissement', installment.paidAt);
    writeReceiptField(doc, 'Mode paiement', installment.paymentMethod);
    writeReceiptField(doc, 'Saisi par', author?.fullName || author?.username);
    writeReceiptField(doc, 'Note', installment.note);

    doc.moveDown();
    doc.fontSize(8).fillColor('#64748b').text(
      'Document genere automatiquement apres encaissement de l echeance. Les reports et paiements partiels restent historises dans ASEL.',
      { align: 'center' },
    );

    doc.end();
  });

  const receiptPath = toUploadPath('installment-receipts', filename);
  installment.receiptPath = receiptPath;
  installment.receiptCreatedAt = new Date();
  const historyEntry = installment.paymentHistory
    ?.slice()
    .reverse()
    .find((entry: any) => entry.receiptNumber === receiptNumber && !entry.receiptPath);
  if (historyEntry) historyEntry.receiptPath = receiptPath;
  await installment.save();
  return installment;
}

router.get(
  '/',
  requireAuth,
  requirePermission('installments.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, status, from, to, page, pageSize, limit } = req.query as unknown as z.infer<typeof listQuery>;
    await refreshInstallmentNotifications();

    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (status) filter.status = status;
    if (from || to) {
      filter.dueDate = {
        ...(from ? { $gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { $lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }
    const effectivePageSize = limit ?? pageSize;
    const skip = (page - 1) * effectivePageSize;
    const [total, rows] = await Promise.all([
      Installment.countDocuments(filter),
      Installment.find(filter)
        .sort({ dueDate: 1, createdAt: 1 })
        .skip(skip)
        .limit(effectivePageSize)
        .populate({ path: 'saleId', match: { cancelledAt: null }, select: 'total createdAt invoiceNumber saleType paymentStatus' })
        .populate('clientId', 'fullName phone phone2')
        .populate('userId', 'username fullName')
        .populate('dueDateUpdatedBy', 'username fullName')
        .populate('paidAtUpdatedBy', 'username fullName'),
    ]);
    const installments = rows.filter((installment) => installment.saleId);
    res.json({
      installments,
      meta: {
        page,
        pageSize: effectivePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / effectivePageSize)),
      },
    });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('ceo', 'admin', 'superadmin', 'manager', 'franchise'),
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
  paidAt: z.string().datetime().optional(),
  remainingDueDate: z.string().datetime().optional(),
  note: z.string().trim().max(1000).optional(),
});

const updateSchema = z.object({
  dueDate: z.string().datetime().optional(),
  paidAt: z.string().datetime().optional(),
  note: z.string().trim().max(1000).optional(),
  reason: z.string().trim().max(1000).optional(),
}).refine((value) => value.dueDate || value.paidAt || value.note !== undefined, {
  message: 'At least one field is required',
});

router.patch(
  '/:id',
  requireAuth,
  requireRole('ceo', 'admin', 'superadmin', 'manager', 'cash_central_maintainer', 'franchise', 'seller', 'vendeur'),
  requirePermission('installments.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateSchema>;
    const installment = await Installment.findById(req.params.id);
    if (!installment) throw notFound('Installment not found');
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== installment.franchiseId.toString()) throw forbidden();
    const linkedSale = await Sale.findById(installment.saleId).select('cancelledAt');
    if (!linkedSale) throw notFound('Sale not found');
    if (linkedSale.cancelledAt) throw badRequest('Cannot modify an installment linked to a cancelled sale');

    const before = {
      dueDate: installment.dueDate,
      paidAt: installment.paidAt,
      status: installment.status,
      note: installment.note,
    };

    if (input.dueDate) {
      if (installment.status === 'paid') throw badRequest('Paid installments cannot be rescheduled');
      const nextDueDate = new Date(input.dueDate);
      if (Number.isNaN(nextDueDate.getTime())) throw badRequest('Invalid due date');
      installment.dueDateHistory.push({
        from: installment.dueDate,
        to: nextDueDate,
        reason: input.reason ?? input.note ?? '',
        userId: req.user!.sub as any,
        createdAt: new Date(),
      } as any);
      installment.dueDate = nextDueDate;
      installment.status = statusForDueDate(nextDueDate);
      installment.remind7dSent = false;
      installment.remind3dSent = false;
      installment.dueDateUpdatedBy = req.user!.sub as any;
      installment.dueDateUpdatedAt = new Date();
    }

    if (input.paidAt) {
      if (installment.status !== 'paid') throw badRequest('Only paid installments have an encaissement date');
      const nextPaidAt = new Date(input.paidAt);
      if (Number.isNaN(nextPaidAt.getTime())) throw badRequest('Invalid payment date');
      installment.paidAt = nextPaidAt;
      installment.paidAtUpdatedBy = req.user!.sub as any;
      installment.paidAtUpdatedAt = new Date();
    }

    if (input.note !== undefined) {
      installment.note = input.note;
    } else if (input.reason) {
      installment.note = [installment.note, input.reason].filter(Boolean).join(' | ');
    }

    await installment.save();
    if (installment.status === 'paid') {
      await ensureInstallmentReceipt(installment, Boolean(input.paidAt));
    }
    await audit(req, {
      action: 'installment.update',
      entity: 'Installment',
      entityId: installment._id.toString(),
      franchiseId: installment.franchiseId.toString(),
      details: {
        before,
        after: {
          dueDate: installment.dueDate,
          paidAt: installment.paidAt,
          status: installment.status,
          note: installment.note,
        },
        reason: input.reason ?? null,
      },
    });

    res.json({ installment });
  }),
);

router.post(
  '/:id/pay',
  requireAuth,
  requireRole('ceo', 'admin', 'superadmin', 'manager', 'cash_central_maintainer', 'franchise', 'seller', 'vendeur'),
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
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw badRequest('Invalid payment date');

    let remainderInstallment = null;
    const originalAmount = installment.originalAmount ?? installment.amount;
    const remainingAmount = Math.round((installment.amount - paidAmount) * 100) / 100;
    let remainderDueDate: Date | null = null;
    if (remainingAmount > 0) {
      remainderDueDate = input.remainingDueDate ? new Date(input.remainingDueDate) : new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
      if (Number.isNaN(remainderDueDate.getTime())) throw badRequest('Invalid remaining due date');
    }

    let salePaymentStatus: string | null = null;
    await withMongoTransaction(async (session) => {
      installment.originalAmount = originalAmount;
      installment.amount = paidAmount;
      installment.paidAmount = paidAmount;
      installment.status = 'paid';
      installment.paidAt = paidAt;
      installment.paymentMethod = input.paymentMethod ?? installment.paymentMethod;
      installment.note = input.note
        ? [installment.note, input.note].filter(Boolean).join(' | ')
        : installment.note;
      await assignInstallmentReceiptNumber(installment, paidAt, session);
      installment.paymentHistory.push({
        amount: paidAmount,
        paidAt,
        paymentMethod: installment.paymentMethod,
        receiptNumber: installment.receiptNumber,
        receiptPath: null,
        note: input.note ?? '',
        userId: req.user!.sub as any,
        createdAt: new Date(),
      } as any);
      await installment.save({ session });

      if (remainingAmount > 0) {
        const [createdRemainder] = await Installment.create(
          [
            {
              saleId: installment.saleId,
              franchiseId: installment.franchiseId,
              clientId: installment.clientId ?? null,
              amount: remainingAmount,
              originalAmount: remainingAmount,
              dueDate: remainderDueDate!,
              status: statusForDueDate(remainderDueDate!),
              paymentMethod: null,
              note: input.note
                ? `Reste apres paiement partiel: ${input.note}`
                : `Reste apres paiement partiel de ${paidAmount}`,
              splitFromInstallmentId: installment._id,
              userId: req.user!.sub,
            },
          ],
          { session },
        );
        remainderInstallment = createdRemainder ?? null;
      }

      const sale = await Sale.findById(installment.saleId)
        .select('total amountReceived paymentStatus')
        .session(session ?? null);
      if (sale) {
        const received = Math.round(((sale.amountReceived ?? 0) + paidAmount) * 100) / 100;
        sale.amountReceived = Math.min(sale.total, received);
        sale.paymentStatus = sale.amountReceived >= sale.total
          ? 'paid'
          : sale.amountReceived > 0
            ? 'partial'
            : 'pending';
        salePaymentStatus = sale.paymentStatus;
        await sale.save({ session });
      }
    });
    await ensureInstallmentReceipt(installment);

    await audit(req, {
      action: 'installment.pay',
      entity: 'Installment',
      entityId: installment._id.toString(),
      franchiseId: installment.franchiseId.toString(),
      details: { amount: paidAmount, paidAt, remainingAmount, salePaymentStatus, receiptNumber: installment.receiptNumber, receiptPath: installment.receiptPath },
    });

    res.json({ installment, remainderInstallment });
  }),
);

router.post(
  '/generate',
  requireAuth,
  requireRole('ceo', 'admin', 'superadmin', 'manager', 'franchise'),
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
