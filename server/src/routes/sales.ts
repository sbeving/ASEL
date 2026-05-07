import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withMongoTransaction } from '../db/transaction.js';
import { Sale } from '../models/Sale.js';
import { Product } from '../models/Product.js';
import { Client } from '../models/Client.js';
import { Installment } from '../models/Installment.js';
import { applyStockDelta } from '../services/stock.service.js';
import { audit } from '../services/audit.service.js';
import { refreshClosingSystemTotals } from '../services/closing.service.js';
import { nextSequenceValue } from '../services/sequence.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { buildInstallmentSchedule, roundCurrency } from '../utils/installments.js';
import { isGlobalRole } from '../utils/roles.js';
import { isPermissionGranted } from '../utils/permissions.js';

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

function invoiceSequenceKey(date: Date, saleType: 'ticket' | 'facture' | 'devis') {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');
  return `sale:${saleType}:${stamp}`;
}

function canCancelSale(req: Express.Request, sale: any) {
  const user = req.user!;
  const saleFranchiseId = sale.franchiseId?.toString();
  if (['ceo', 'admin', 'superadmin', 'manager'].includes(user.role)) return true;
  if (user.role === 'franchise') return Boolean(user.franchiseId && user.franchiseId === saleFranchiseId);
  if (user.role === 'seller' || user.role === 'vendeur') {
    return Boolean(user.franchiseId && user.franchiseId === saleFranchiseId && sale.userId?.toString() === user.sub);
  }
  return false;
}

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise', 'seller', 'vendeur'),
  requirePermission('sales.create'),
  validate(saleSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof saleSchema>;
    const fid = resolveFranchiseId(req.user, input.franchiseId);
    const isInstallmentSale = input.paymentMethod === 'installment';

    const productIds = input.items.map((item) => item.productId);
    const products = await Product.find({ _id: mongoose.trusted({ $in: productIds }) }).select('_id active sellPrice');
    if (products.length !== productIds.length) throw badRequest('One or more products not found');
    if (products.some((product) => !product.active)) throw badRequest('Cannot sell inactive products');
    const productById = new Map(products.map((product) => [product._id.toString(), product]));
    const canOverridePrices = isPermissionGranted(
      req.user!.role,
      'sales.price.override',
      req.user!.customPermissions,
    );
    if (!canOverridePrices) {
      const hasPriceOverride = input.items.some((item) => {
        const product = productById.get(item.productId);
        return product ? Math.abs(roundCurrency(item.unitPrice) - roundCurrency(product.sellPrice ?? 0)) > 0.001 : false;
      });
      if (hasPriceOverride) throw forbidden('You are not allowed to modify item prices');
    }

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

    const installmentSchedule = isInstallmentSale
      ? buildInstallmentSchedule({
          totalAmount: total,
          installmentCount: input.installmentPlan!.nbLots,
          startDate: new Date(input.installmentPlan!.startDate),
          intervalDays: input.installmentPlan!.intervalDays,
          upfrontAmount: amountReceived,
        })
      : [];

    let invoiceNumber = '';
    let createdSaleId: mongoose.Types.ObjectId | null = null;
    const transactionResult = await withMongoTransaction(async (session) => {
      const now = new Date();
      const dailySequence = await nextSequenceValue(invoiceSequenceKey(now, input.saleType), session);
      invoiceNumber = formatInvoiceNumber(now, input.saleType, dailySequence);

      const [createdSale] = await Sale.create(
        [
          {
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
          },
        ],
        { session },
      );
      if (!createdSale) throw badRequest('Sale could not be created');
      createdSaleId = createdSale._id;

      for (const item of computedItems) {
        await applyStockDelta({
          franchiseId: fid,
          productId: item.productId,
          delta: -item.quantity,
          type: 'sale',
          userId: req.user!.sub,
          unitPrice: item.unitPrice,
          refId: createdSale._id,
          session,
        });
      }

      const createdInstallments = installmentSchedule.length > 0
        ? await Installment.insertMany(
            installmentSchedule.map((item) => ({
              saleId: createdSale._id,
              franchiseId: franchiseObjectId,
              clientId: client!._id,
              amount: item.amount,
              dueDate: item.dueDate,
              note: input.installmentPlan?.note
                ? `${input.installmentPlan.note} (Lot ${item.installmentNumber}/${item.totalInstallments})`
                : `Lot ${item.installmentNumber}/${item.totalInstallments}`,
              userId: userObjectId,
            })),
            { session },
          )
        : [];

      return { sale: createdSale, installments: createdInstallments };
    });

    if (!createdSaleId || !transactionResult?.sale) throw badRequest('Sale could not be created');
    const { sale, installments } = transactionResult;

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
  userId: objectId.optional(),
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
  requirePermission('sales.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const {
      franchiseId,
      clientId,
      userId,
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
    if (userId) {
      if (!isGlobalRole(req.user!.role) && userId !== req.user!.sub) throw forbidden();
      filter.userId = userId;
    }
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
        .populate('franchiseId', 'name taxId')
        .populate('clientId', 'fullName phone clientType')
        .populate('userId', 'username fullName')
        .populate('cancelledBy', 'username fullName')
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
  requirePermission('sales.view'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const sale = await Sale.findById(req.params.id)
      .populate('franchiseId', 'name taxId address phone manager')
      .populate('clientId', 'fullName phone clientType')
      .populate('userId', 'username fullName')
      .populate('cancelledBy', 'username fullName')
      .populate('items.productId', 'name reference');
    if (!sale) throw notFound('Sale not found');
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && sale.franchiseId?.toString() !== scope.franchiseId) throw forbidden();
    res.json({ sale });
  }),
);

const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

router.post(
  '/:id/cancel',
  requireAuth,
  requireRole('admin', 'manager', 'franchise', 'seller', 'vendeur'),
  requirePermission('sales.view'),
  validate(z.object({ id: objectId }), 'params'),
  validate(cancelSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof cancelSchema>;
    const sale = await Sale.findById(req.params.id);
    if (!sale) throw notFound('Sale not found');
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && sale.franchiseId?.toString() !== scope.franchiseId) throw forbidden();
    if (sale.cancelledAt) throw badRequest('Sale already cancelled');
    if (!canCancelSale(req, sale)) throw forbidden('Only the seller who created the sale or a franchise superior can cancel it');

    let paidInstallments = 0;
    let deletedPendingInstallments = 0;
    const restoredQuantity = sale.items.reduce((sum, item) => sum + item.quantity, 0);

    await withMongoTransaction(async (session) => {
      paidInstallments = await Installment.countDocuments({ saleId: sale._id, status: 'paid' }).session(session ?? null);
      sale.cancelledAt = new Date();
      sale.cancelledBy = req.user!.sub as any;
      sale.cancelReason = input.reason || 'Annulation vente';
      await sale.save({ session });

      for (const item of sale.items) {
        await applyStockDelta({
          franchiseId: sale.franchiseId,
          productId: item.productId,
          delta: item.quantity,
          type: 'sale_cancel',
          userId: req.user!.sub,
          unitPrice: item.unitPrice,
          note: `Annulation vente ${sale.invoiceNumber || sale._id.toString()}`,
          refId: sale._id,
          session,
        });
      }

      const result = await Installment.deleteMany({
        saleId: sale._id,
        status: mongoose.trusted({ $in: ['pending', 'late'] }),
      }).session(session ?? null);
      deletedPendingInstallments = result.deletedCount ?? 0;
    });

    const refreshedClosing = await refreshClosingSystemTotals(
      sale.franchiseId.toString(),
      sale.createdAt,
      `Cloture reouverte suite annulation vente ${sale.invoiceNumber || sale._id.toString()}.`,
    );

    await audit(req, {
      action: 'sale.cancel',
      entity: 'Sale',
      entityId: sale._id.toString(),
      franchiseId: sale.franchiseId.toString(),
      details: {
        invoiceNumber: sale.invoiceNumber,
        total: sale.total,
        reason: sale.cancelReason,
        restoredItems: sale.items.length,
        restoredQuantity,
        paidInstallments,
        deletedPendingInstallments,
        refreshedClosingId: refreshedClosing?._id?.toString?.() ?? null,
        revenueRemovedFromCA: sale.total,
      },
    });

    const populated = await Sale.findById(sale._id)
      .populate('franchiseId', 'name taxId address phone manager')
      .populate('clientId', 'fullName phone clientType')
      .populate('userId', 'username fullName')
      .populate('cancelledBy', 'username fullName')
      .populate('items.productId', 'name reference');

    res.json({ sale: populated });
  }),
);

export default router;
