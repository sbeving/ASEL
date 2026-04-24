import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Sale } from '../models/Sale.js';
import { Product } from '../models/Product.js';
import { Client } from '../models/Client.js';
import { Installment } from '../models/Installment.js';
import { applyStockDelta } from '../services/stock.service.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { buildInstallmentSchedule, roundCurrency } from '../utils/installments.js';
import { isGlobalRole } from '../utils/roles.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

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

const saleSchema = z.object({
  franchiseId: objectId.optional(),
  clientId: objectId.nullable().optional(),
  items: z
    .array(
      z.object({
        productId: objectId,
        quantity: z.number().int().positive(),
        unitPrice: z.number().min(0),
      }),
    )
    .min(1),
  saleType: z.enum(['ticket', 'facture', 'devis']).default('ticket'),
  discount: z.number().min(0).default(0),
  paymentMethod: z.enum(['cash', 'card', 'transfer', 'installment', 'other']).default('cash'),
  amountReceived: z.number().min(0).optional(),
  installmentPlan: z
    .object({
      nbLots: z.number().int().min(1).max(60),
      startDate: z.string().datetime(),
      intervalDays: z.number().int().min(1).max(365).default(30),
      note: z.string().trim().max(1000).optional(),
    })
    .optional(),
  note: z.string().max(500).optional(),
});

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatInvoiceNumber(date: Date, saleType: 'ticket' | 'facture' | 'devis', sequence: number) {
  const prefixMap = {
    ticket: 'TK',
    facture: 'FA',
    devis: 'DV',
  } as const;

  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');

  return `${prefixMap[saleType]}-${stamp}-${String(sequence).padStart(4, '0')}`;
}

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise', 'seller', 'vendeur'),
  validate(saleSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof saleSchema>;
    const fid = resolveFranchiseId(req.user, input.franchiseId);
    const isInstallmentSale = input.paymentMethod === 'installment';

    const productIds = input.items.map((item) => item.productId);
    const products = await Product.find({ _id: mongoose.trusted({ $in: productIds }) }).select('_id active');
    if (products.length !== productIds.length) throw badRequest('One or more products not found');
    if (products.some((product) => !product.active)) throw badRequest('Cannot sell inactive products');

    const client = input.clientId
      ? await Client.findById(input.clientId).select('_id franchiseId fullName')
      : null;
    if (input.clientId && !client) throw badRequest('clientId does not exist');
    if (client?.franchiseId && client.franchiseId.toString() !== fid) {
      throw badRequest('Client does not belong to the selected franchise');
    }
    if (isInstallmentSale && !client) {
      throw badRequest('clientId is required for installment sales');
    }
    if (isInstallmentSale && !input.installmentPlan) {
      throw badRequest('installmentPlan is required when paymentMethod is installment');
    }

    const computedItems = input.items.map((item) => ({
      productId: new mongoose.Types.ObjectId(item.productId),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: roundCurrency(item.quantity * item.unitPrice),
    }));
    const subtotal = computedItems.reduce((sum, item) => sum + item.total, 0);
    const discount = input.discount ?? 0;
    if (discount > subtotal) throw badRequest('Discount cannot exceed subtotal');
    const total = Math.max(0, roundCurrency(subtotal - discount));

    const amountReceived = roundCurrency(input.amountReceived ?? (isInstallmentSale ? 0 : total));
    if (!isInstallmentSale && amountReceived < total) {
      throw badRequest('Amount received cannot be less than total');
    }
    if (isInstallmentSale && amountReceived >= total) {
      throw badRequest('Installment upfront amount must be lower than total');
    }

    const paymentStatus = isInstallmentSale
      ? amountReceived > 0 ? 'partial' : 'pending'
      : 'paid';
    const changeDue = isInstallmentSale ? 0 : roundCurrency(amountReceived - total);
    const franchiseObjectId = new mongoose.Types.ObjectId(fid);
    const userObjectId = new mongoose.Types.ObjectId(req.user!.sub);

    const now = new Date();
    const dayStart = startOfLocalDay(now);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dailySequence =
      (await Sale.countDocuments({
        saleType: input.saleType,
        createdAt: mongoose.trusted({ $gte: dayStart, $lt: dayEnd }),
      })) + 1;
    const invoiceNumber = formatInvoiceNumber(now, input.saleType, dailySequence);

    const installmentSchedule = isInstallmentSale
      ? buildInstallmentSchedule({
          totalAmount: total,
          installmentCount: input.installmentPlan!.nbLots,
          startDate: new Date(input.installmentPlan!.startDate),
          intervalDays: input.installmentPlan!.intervalDays,
          upfrontAmount: amountReceived,
        })
      : [];

    const sale = await Sale.create({
      invoiceNumber,
      saleType: input.saleType,
      franchiseId: franchiseObjectId,
      clientId: client?._id ?? null,
      userId: userObjectId,
      items: computedItems,
      subtotal,
      discount,
      total,
      paymentMethod: input.paymentMethod,
      paymentStatus,
      amountReceived,
      changeDue,
      installmentPlan: isInstallmentSale
        ? {
            totalLots: input.installmentPlan!.nbLots,
            intervalDays: input.installmentPlan!.intervalDays,
            upfrontAmount: amountReceived,
            remainingAmount: roundCurrency(total - amountReceived),
            firstDueDate: new Date(input.installmentPlan!.startDate),
            generatedLots: installmentSchedule.length,
          }
        : undefined,
      note: input.note,
    });

    try {
      for (const item of computedItems) {
        await applyStockDelta({
          franchiseId: fid,
          productId: item.productId,
          delta: -item.quantity,
          type: 'sale',
          userId: req.user!.sub,
          unitPrice: item.unitPrice,
          refId: sale._id,
        });
      }
    } catch (err) {
      await Sale.deleteOne({ _id: sale._id });
      throw err;
    }

    const installments = installmentSchedule.length > 0
      ? await Installment.insertMany(
          installmentSchedule.map((item) => ({
            saleId: sale._id,
            franchiseId: franchiseObjectId,
            clientId: client!._id,
            amount: item.amount,
            dueDate: item.dueDate,
            note: input.installmentPlan?.note
              ? `${input.installmentPlan.note} (Lot ${item.installmentNumber}/${item.totalInstallments})`
              : `Lot ${item.installmentNumber}/${item.totalInstallments}`,
            userId: userObjectId,
          })),
        )
      : [];

    await audit(req, {
      action: 'sale.create',
      entity: 'Sale',
      entityId: sale._id.toString(),
      franchiseId: fid,
      details: {
        total,
        itemCount: computedItems.length,
        saleType: input.saleType,
        paymentMethod: input.paymentMethod,
        invoiceNumber,
        installmentCount: installments.length,
      },
    });

    res.status(201).json({ sale, installments });
  }),
);

const listQuery = z.object({
  franchiseId: objectId.optional(),
  clientId: objectId.optional(),
  saleType: z.enum(['ticket', 'facture', 'devis']).optional(),
  paymentMethod: z.enum(['cash', 'card', 'transfer', 'installment', 'other']).optional(),
  paymentStatus: z.enum(['paid', 'partial', 'pending']).optional(),
  q: z.string().trim().max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(40),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get(
  '/',
  requireAuth,
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const {
      franchiseId,
      clientId,
      saleType,
      paymentMethod,
      paymentStatus,
      q,
      from,
      to,
      page,
      pageSize,
      limit,
    } = req.query as unknown as z.infer<typeof listQuery>;
    const scope = franchiseScopeFilter(req.user);
    const effectivePageSize = limit ?? pageSize;
    const skip = (page - 1) * effectivePageSize;
    const filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (clientId) filter.clientId = clientId;
    if (saleType) filter.saleType = saleType;
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (from || to) {
      filter.createdAt = mongoose.trusted({
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      });
    }

    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      const [clientMatches, productMatches] = await Promise.all([
        Client.find({ $or: [{ fullName: rx }, { phone: rx }] }).select('_id').limit(80).lean(),
        Product.find({
          $or: [{ name: rx }, { reference: rx }, { barcode: rx }, { brand: rx }],
        }).select('_id').limit(80).lean(),
      ]);

      const clientIds = clientMatches.map((entry) => entry._id);
      const productIds = productMatches.map((entry) => entry._id);
      filter.$or = [
        { invoiceNumber: rx },
        { note: rx },
        ...(clientIds.length > 0 ? [{ clientId: mongoose.trusted({ $in: clientIds }) }] : []),
        ...(productIds.length > 0 ? [{ 'items.productId': mongoose.trusted({ $in: productIds }) }] : []),
      ];
    }

    const [total, sales] = await Promise.all([
      Sale.countDocuments(filter),
      Sale.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(effectivePageSize)
        .populate('franchiseId', 'name')
        .populate('clientId', 'fullName phone clientType')
        .populate('userId', 'username fullName')
        .populate('items.productId', 'name reference'),
    ]);

    res.json({
      sales,
      meta: {
        page,
        pageSize: effectivePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / effectivePageSize)),
      },
    });
  }),
);

router.get(
  '/:id',
  requireAuth,
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const sale = await Sale.findById(req.params.id)
      .populate('franchiseId', 'name')
      .populate('clientId', 'fullName phone clientType')
      .populate('userId', 'username fullName')
      .populate('items.productId', 'name reference');
    if (!sale) throw notFound('Sale not found');
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && sale.franchiseId?.toString() !== scope.franchiseId) throw forbidden();
    res.json({ sale });
  }),
);

export default router;
