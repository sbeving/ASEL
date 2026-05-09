import { createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { CashFlow } from '../models/CashFlow.js';
import { Franchise } from '../models/Franchise.js';
import { audit } from '../services/audit.service.js';
import { treasuryAttachmentUpload, toUploadPath } from '../middleware/upload.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { ensureUploadDir } from '../config/uploads.js';
import { nextSequenceValue } from '../services/sequence.service.js';
import { cashFlowReceiptSequenceKey, formatCashFlowReceiptNumber } from '../utils/documentNumbers.js';
import { withMongoTransaction } from '../db/transaction.js';
import { CashLedgerEntry } from '../models/CashLedgerEntry.js';
import { postCashFlowLedger, voidCashFlowLedger } from '../services/treasuryLedger.service.js';

const router = Router();

const flowBodySchema = z.object({
  franchiseId: z.string().refine(isValidObjectId).optional(),
  type: z.enum(['encaissement', 'decaissement']),
  subType: z.enum(['cash_sale', 'central_cashbox', 'bank_transfer', 'expense', 'other']).optional(),
  isCentralCashbox: z.preprocess((value) => value === true || value === 'true' || value === '1', z.boolean()).optional(),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(1).max(255),
  reference: z.string().trim().max(120).optional(),
  date: z.string().trim().optional(),
});

const flowUpdateSchema = flowBodySchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

const listQuerySchema = z.object({
  franchiseId: z.string().refine(isValidObjectId).optional(),
  type: z.enum(['encaissement', 'decaissement']).optional(),
  subType: z.enum(['cash_sale', 'central_cashbox', 'bank_transfer', 'expense', 'other']).optional(),
  ledger: z.enum(['all', 'franchise', 'central']).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const ledgerQuerySchema = z.object({
  franchiseId: z.string().refine(isValidObjectId).optional(),
  accountType: z.enum(['franchise_cashbox', 'central_cashbox']).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

const superiorTreasuryRoles = new Set(['ceo', 'admin', 'superadmin', 'manager', 'cash_central_maintainer']);

const cashFlowSubTypeLabel: Record<string, string> = {
  cash_sale: 'Vente caisse',
  central_cashbox: 'Vers caisse centrale',
  bank_transfer: 'Virement bancaire',
  expense: 'Depense',
  other: 'Autre',
};

function isSuperiorTreasuryRole(role: string) {
  return superiorTreasuryRoles.has(role);
}

function oppositeFlowType(type: 'encaissement' | 'decaissement') {
  return type === 'encaissement' ? 'decaissement' : 'encaissement';
}

function flowNeedsCentralReview(flow: { subType?: string; isCentralCashbox?: boolean }) {
  return flow.subType === 'central_cashbox' && !flow.isCentralCashbox;
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

async function assignCashFlowReceiptNumber(flow: any, session?: mongoose.ClientSession) {
  if (flow.status !== 'approved' || flow.receiptNumber) return flow;
  const receiptDate = flow.date instanceof Date ? flow.date : new Date(flow.date);
  const sequence = await nextSequenceValue(cashFlowReceiptSequenceKey(receiptDate), session);
  flow.receiptNumber = formatCashFlowReceiptNumber(receiptDate, sequence);
  await flow.save({ session });
  return flow;
}

async function ensureCashFlowReceipt(flow: any, force = false) {
  if (flow.status !== 'approved') return flow;
  if (flow.receiptPath && !force) return flow;

  await assignCashFlowReceiptNumber(flow);

  const populated = await flow.populate([
    { path: 'franchiseId', select: 'name address phone manager taxId' },
    { path: 'counterpartyFranchiseId', select: 'name address phone manager taxId' },
    { path: 'userId', select: 'fullName username role' },
    { path: 'reviewedBy', select: 'fullName username role' },
  ]);
  const receiptNumber = flow.receiptNumber;
  const filename = `${Date.now()}-${crypto.randomUUID()}-${receiptNumber.toLowerCase()}.pdf`;
  const absolutePath = path.join(ensureUploadDir('treasury-receipts'), filename);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const stream = createWriteStream(absolutePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    const franchise = populated.franchiseId && typeof populated.franchiseId === 'object' ? populated.franchiseId : null;
    const author = populated.userId && typeof populated.userId === 'object' ? populated.userId : null;
    const reviewer = populated.reviewedBy && typeof populated.reviewedBy === 'object' ? populated.reviewedBy : null;

    doc.fontSize(20).fillColor('#0f172a').text('Recu mouvement tresorerie');
    doc.fontSize(10).fillColor('#64748b').text(`Genere le ${new Date().toLocaleString('fr-TN')}`);
    doc.moveDown();

    doc.roundedRect(48, doc.y, 500, 72, 8).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor(flow.type === 'encaissement' ? '#047857' : '#be123c').fontSize(24).text(formatMoney(flow.amount), 64, doc.y + 16);
    doc.fillColor('#334155').fontSize(11).text(flow.type === 'encaissement' ? 'ENCAISSEMENT ACCEPTE' : 'DECAISSEMENT ACCEPTE', 64, doc.y + 2);
    doc.moveDown(3.2);

    writeReceiptField(doc, 'Numero recu', receiptNumber);
    writeReceiptField(doc, 'Date mouvement', flow.date);
    writeReceiptField(doc, 'Franchise / entite', flow.isCentralCashbox ? `Caisse centrale - ${franchise?.name ?? '-'}` : franchise?.name);
    writeReceiptField(doc, 'Type', flow.type);
    writeReceiptField(doc, 'Detail', cashFlowSubTypeLabel[flow.subType] ?? flow.subType);
    writeReceiptField(doc, 'Motif', flow.reason);
    writeReceiptField(doc, 'Reference', flow.reference);
    writeReceiptField(doc, 'Saisi par', author?.fullName || author?.username);
    writeReceiptField(doc, 'Valide par', reviewer?.fullName || reviewer?.username || 'Validation automatique');
    writeReceiptField(doc, 'Note validation', flow.reviewNote);

    doc.moveDown();
    doc.fontSize(8).fillColor('#64748b').text(
      'Document genere automatiquement apres acceptation du mouvement. Les justificatifs originaux restent lies au mouvement dans ASEL.',
      { align: 'center' },
    );

    doc.end();
  });

  flow.receiptPath = toUploadPath('treasury-receipts', filename);
  flow.receiptCreatedAt = new Date();
  await flow.save();
  return flow;
}

async function deleteCentralCashboxMirror(flow: any, session?: mongoose.ClientSession, actorId?: string) {
  const querySession = session ?? null;
  const linkedFlowId = flow.linkedFlowId;
  if (linkedFlowId) {
    await voidCashFlowLedger({ _id: linkedFlowId }, actorId, 'linked central cashbox movement removed', session);
    await CashFlow.deleteOne({ _id: linkedFlowId }).session(querySession);
  }
  const linkedMirrors = await CashFlow.find({ linkedFlowId: flow._id }).select('_id').session(querySession);
  for (const mirror of linkedMirrors) {
    await voidCashFlowLedger(mirror, actorId, 'linked central cashbox movement removed', session);
  }
  await CashFlow.deleteMany({ linkedFlowId: flow._id }).session(querySession);
  if (flow.linkedFlowId) {
    flow.linkedFlowId = null;
    await flow.save({ session });
  }
}

async function syncCentralCashboxMirror(flow: any, actorId?: string, session?: mongoose.ClientSession) {
  if (flow.subType !== 'central_cashbox' || flow.status !== 'approved') return null;

  const querySession = session ?? null;
  const mirrorIsCentralCashbox = !flow.isCentralCashbox;
  let mirror: any = flow.linkedFlowId
    ? await CashFlow.findOne({ _id: flow.linkedFlowId, isCentralCashbox: mirrorIsCentralCashbox }).session(querySession)
    : null;
  if (!mirror) {
    mirror = await CashFlow.findOne({ linkedFlowId: flow._id, isCentralCashbox: mirrorIsCentralCashbox }).session(querySession);
  }

  const mirrorPayload = {
    franchiseId: flow.franchiseId,
    userId: actorId ?? flow.reviewedBy ?? flow.userId,
    type: oppositeFlowType(flow.type),
    subType: 'central_cashbox',
    amount: flow.amount,
    reason: flow.reason,
    reference: flow.reference ?? '',
    status: 'approved',
    reviewedBy: actorId ?? flow.reviewedBy ?? flow.userId,
    reviewedAt: flow.reviewedAt ?? new Date(),
    reviewNote: flow.reviewNote ?? '',
    date: flow.date,
    isCentralCashbox: mirrorIsCentralCashbox,
    counterpartyFranchiseId: flow.franchiseId,
    linkedFlowId: flow._id,
    attachmentPath: flow.attachmentPath,
    attachmentMimeType: flow.attachmentMimeType,
    attachmentOriginalName: flow.attachmentOriginalName,
  };

  if (mirror) {
    mirror.set(mirrorPayload);
    mirror.receiptPath = null;
    mirror.receiptCreatedAt = null;
    await mirror.save({ session });
  } else {
    const [createdMirror] = await CashFlow.create([mirrorPayload], { session });
    if (!createdMirror) throw badRequest('Central cashbox mirror could not be created');
    mirror = createdMirror;
  }

  if (!flow.linkedFlowId || flow.linkedFlowId.toString() !== mirror._id.toString()) {
    flow.linkedFlowId = mirror._id;
    await flow.save({ session });
  }

  return mirror;
}

function canEditCashFlow(req: Express.Request, flow: any) {
  if (!flow) return false;
  if (superiorTreasuryRoles.has(req.user!.role)) return true;
  const createdAt = flow.createdAt instanceof Date ? flow.createdAt : new Date(flow.createdAt);
  const within24Hours = Date.now() - createdAt.getTime() <= 24 * 60 * 60 * 1000;
  return within24Hours && flow.userId?.toString() === req.user!.sub;
}

function cashFlowAggregateFilter(filter: Record<string, unknown>) {
  const aggregateFilter: Record<string, unknown> = { ...filter };
  if (typeof aggregateFilter.franchiseId === 'string' && isValidObjectId(aggregateFilter.franchiseId)) {
    aggregateFilter.franchiseId = new mongoose.Types.ObjectId(aggregateFilter.franchiseId);
  }
  return aggregateFilter;
}

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

    const isCentralCashbox = input.isCentralCashbox ?? false;
    if (isCentralCashbox && !isSuperiorTreasuryRole(req.user!.role)) {
      throw forbidden('Only treasury maintainers can enter movements directly in caisse centrale');
    }

    const fid = req.user!.franchiseId || input.franchiseId;
    if (!fid) throw forbidden('franchiseId required');
    if (req.user!.franchiseId && req.user!.franchiseId !== fid) throw forbidden();
    if (!(await Franchise.exists({ _id: fid }))) throw badRequest('franchiseId does not exist');
    const movementDate = input.date ? new Date(input.date) : new Date();
    if (Number.isNaN(movementDate.getTime())) throw badRequest('Invalid date');
    const subType = isCentralCashbox ? 'central_cashbox' : (input.subType ?? (input.type === 'encaissement' ? 'cash_sale' : 'expense'));
    if (isCentralCashbox && subType !== 'central_cashbox') throw badRequest('Caisse centrale movements must use central_cashbox detail');

    let flow: any = null;
    let mirrorFlow: any = null;
    await withMongoTransaction(async (session) => {
      const [createdFlow] = await CashFlow.create(
        [
          {
            franchiseId: fid,
            userId: req.user!.sub,
            type: input.type,
            subType,
            amount: input.amount,
            reason: input.reason,
            reference: input.reference ?? '',
            status: flowNeedsCentralReview({ subType, isCentralCashbox }) ? 'pending' : 'approved',
            isCentralCashbox,
            counterpartyFranchiseId: subType === 'central_cashbox' ? fid : null,
            date: movementDate,
            ...(req.file
              ? {
                  attachmentPath: toUploadPath('treasury-docs', req.file.filename),
                  attachmentMimeType: req.file.mimetype,
                  attachmentOriginalName: req.file.originalname,
                }
              : {}),
          },
        ],
        { session },
      );
      flow = createdFlow;
      mirrorFlow = await syncCentralCashboxMirror(flow, req.user!.sub, session);
      await assignCashFlowReceiptNumber(flow, session);
      await postCashFlowLedger(flow, req.user!.sub, session);
      if (mirrorFlow) {
        await assignCashFlowReceiptNumber(mirrorFlow, session);
        await postCashFlowLedger(mirrorFlow, req.user!.sub, session);
      }
    });

    await ensureCashFlowReceipt(flow);
    if (mirrorFlow) await ensureCashFlowReceipt(mirrorFlow, true);

    await audit(req, {
      action: 'cashflow.create',
      entity: 'CashFlow',
      entityId: flow._id.toString(),
      franchiseId: fid,
      details: { type: input.type, subType: input.subType, amount: input.amount, receiptPath: flow.receiptPath },
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
    if (query.subType) filter.subType = query.subType;
    if (scope.franchiseId) {
      filter.isCentralCashbox = mongoose.trusted({ $ne: true });
    } else if (query.ledger === 'central') {
      filter.isCentralCashbox = true;
    } else if (query.ledger === 'franchise') {
      filter.isCentralCashbox = mongoose.trusted({ $ne: true });
    }
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      filter.date = mongoose.trusted({
        ...(query.from ? { $gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
        ...(query.to ? { $lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      });
    }

    const effectivePageSize = query.limit ?? query.pageSize;
    const skip = (query.page - 1) * effectivePageSize;
    const [total, summaryAgg, flows] = await Promise.all([
      CashFlow.countDocuments(filter),
      CashFlow.aggregate([
        { $match: cashFlowAggregateFilter(filter) },
        {
          $group: {
            _id: null,
            encaissements: {
              $sum: { $cond: [{ $eq: ['$type', 'encaissement'] }, '$amount', 0] },
            },
            decaissements: {
              $sum: { $cond: [{ $eq: ['$type', 'decaissement'] }, '$amount', 0] },
            },
            centralNet: {
              $sum: {
                $cond: [
                  { $eq: ['$isCentralCashbox', true] },
                  { $cond: [{ $eq: ['$type', 'encaissement'] }, '$amount', { $multiply: ['$amount', -1] }] },
                  0,
                ],
              },
            },
          },
        },
      ]),
      CashFlow.find(filter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(effectivePageSize)
        .populate('userId', 'fullName username')
        .populate('franchiseId', 'name taxId')
        .populate('counterpartyFranchiseId', 'name taxId')
        .populate('reviewedBy', 'fullName username'),
    ]);
    const summary = summaryAgg[0] ?? { encaissements: 0, decaissements: 0, centralNet: 0 };
    res.json({
      flows,
      summary: {
        encaissements: summary.encaissements,
        decaissements: summary.decaissements,
        net: summary.encaissements - summary.decaissements,
        centralNet: summary.centralNet,
      },
      meta: {
        page: query.page,
        pageSize: effectivePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / effectivePageSize)),
      },
    });
  }),
);

router.get(
  '/ledger',
  requireAuth,
  requirePermission('cashflows.view'),
  validate(ledgerQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof ledgerQuerySchema>;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = {};

    if (scope.franchiseId) {
      if (query.accountType === 'central_cashbox') throw forbidden();
      filter.franchiseId = new mongoose.Types.ObjectId(String(scope.franchiseId));
      filter.accountType = 'franchise_cashbox';
    } else {
      if (query.franchiseId) filter.franchiseId = new mongoose.Types.ObjectId(query.franchiseId);
      if (query.accountType) filter.accountType = query.accountType;
    }
    if (query.active !== 'all') filter.active = query.active === 'true';
    if (query.from || query.to) {
      filter.date = mongoose.trusted({
        ...(query.from ? { $gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
        ...(query.to ? { $lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      });
    }

    const skip = (query.page - 1) * query.pageSize;
    const [total, balanceAgg, entries] = await Promise.all([
      CashLedgerEntry.countDocuments(filter),
      CashLedgerEntry.aggregate([
        { $match: filter },
        { $group: { _id: null, balance: { $sum: '$signedAmount' }, credits: { $sum: { $cond: [{ $gt: ['$signedAmount', 0] }, '$signedAmount', 0] } }, debits: { $sum: { $cond: [{ $lt: ['$signedAmount', 0] }, { $abs: '$signedAmount' }, 0] } } } },
      ]),
      CashLedgerEntry.find(filter)
        .sort({ date: -1, postedAt: -1 })
        .skip(skip)
        .limit(query.pageSize)
        .populate('franchiseId', 'name taxId')
        .populate('cashFlowId', 'receiptNumber reference status')
        .populate('postedBy', 'fullName username role'),
    ]);

    res.json({
      entries,
      summary: balanceAgg[0] ?? { balance: 0, credits: 0, debits: 0 },
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requirePermission('cashflows.manage'),
  validate(z.object({ id: z.string().refine(isValidObjectId) }), 'params'),
  validate(flowUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof flowUpdateSchema>;
    const flow = await CashFlow.findById(id);
    if (!flow) throw notFound('Cashflow not found');
    if (req.user!.franchiseId && flow.franchiseId.toString() !== req.user!.franchiseId) throw forbidden();
    if (req.user!.franchiseId && flow.isCentralCashbox) throw forbidden('Caisse centrale movements are managed by treasury maintainers');
    if (!canEditCashFlow(req, flow)) {
      throw forbidden('This movement can only be edited by its author within 24h. A superior role must modify it after that.');
    }
    if (input.isCentralCashbox && !isSuperiorTreasuryRole(req.user!.role)) {
      throw forbidden('Only treasury maintainers can enter movements directly in caisse centrale');
    }

    const before = {
      franchiseId: flow.franchiseId.toString(),
      type: flow.type,
      subType: flow.subType,
      amount: flow.amount,
      reason: flow.reason,
      reference: flow.reference,
      date: flow.date,
      status: flow.status,
      isCentralCashbox: flow.isCentralCashbox,
    };

    if (input.franchiseId !== undefined) {
      if (req.user!.franchiseId && req.user!.franchiseId !== input.franchiseId) throw forbidden();
      if (!(await Franchise.exists({ _id: input.franchiseId }))) throw badRequest('franchiseId does not exist');
      flow.franchiseId = input.franchiseId as any;
    }
    if (input.type !== undefined) flow.type = input.type;
    if (input.subType !== undefined) flow.subType = input.subType;
    if (input.isCentralCashbox !== undefined) flow.isCentralCashbox = input.isCentralCashbox;
    if (flow.isCentralCashbox) flow.subType = 'central_cashbox';
    flow.counterpartyFranchiseId = (flow.subType === 'central_cashbox' ? flow.franchiseId : null) as any;
    if (input.amount !== undefined) flow.amount = input.amount;
    if (input.reason !== undefined) flow.reason = input.reason;
    if (input.reference !== undefined) flow.reference = input.reference ?? '';
    if (input.date !== undefined) {
      const movementDate = new Date(input.date);
      if (Number.isNaN(movementDate.getTime())) throw badRequest('Invalid date');
      flow.date = movementDate;
    }

    if (flowNeedsCentralReview(flow)) {
      if (flow.status !== 'approved') flow.status = 'pending';
    } else {
      flow.status = 'approved';
      flow.reviewNote = '';
      flow.reviewedAt = null;
      flow.reviewedBy = null as any;
    }

    let mirrorFlow: any = null;
    await withMongoTransaction(async (session) => {
      await flow.save({ session });
      if (flow.subType === 'central_cashbox' && flow.status === 'approved') {
        mirrorFlow = await syncCentralCashboxMirror(flow, req.user!.sub, session);
        await assignCashFlowReceiptNumber(flow, session);
        await postCashFlowLedger(flow, req.user!.sub, session);
        if (mirrorFlow) {
          await assignCashFlowReceiptNumber(mirrorFlow, session);
          await postCashFlowLedger(mirrorFlow, req.user!.sub, session);
        }
      } else {
        await voidCashFlowLedger(flow, req.user!.sub, flow.status === 'approved' ? 'cashflow moved outside central mirror' : 'cashflow not approved', session);
        if (flow.status === 'approved') {
          await assignCashFlowReceiptNumber(flow, session);
          await postCashFlowLedger(flow, req.user!.sub, session);
        }
        await deleteCentralCashboxMirror(flow, session, req.user!.sub);
      }
    });
    await ensureCashFlowReceipt(flow, flow.status === 'approved');
    if (mirrorFlow) await ensureCashFlowReceipt(mirrorFlow, true);
    await audit(req, {
      action: 'cashflow.update',
      entity: 'CashFlow',
      entityId: flow._id.toString(),
      franchiseId: flow.franchiseId?.toString(),
      details: { before, after: { type: flow.type, subType: flow.subType, amount: flow.amount, reason: flow.reason, receiptPath: flow.receiptPath } },
    });

    res.json({ flow });
  }),
);

const statusSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNote: z.string().trim().max(1000).optional(),
});

router.patch(
  '/:id/status',
  requireAuth,
  requirePermission('cashflows.manage'),
  validate(z.object({ id: z.string().refine(isValidObjectId) }), 'params'),
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    if (!['ceo', 'admin', 'superadmin', 'manager', 'cash_central_maintainer'].includes(req.user!.role)) {
      throw forbidden('Central cashbox review requires treasury maintainer access');
    }
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof statusSchema>;
    const flow = await CashFlow.findById(id);
    if (!flow) throw notFound('Cashflow not found');
    if (flow.subType !== 'central_cashbox') throw badRequest('Only central cashbox movements require review');

    let mirrorFlow: any = null;
    await withMongoTransaction(async (session) => {
      flow.status = input.status;
      flow.reviewNote = input.reviewNote ?? '';
      flow.reviewedAt = new Date();
      flow.reviewedBy = req.user!.sub as any;
      await flow.save({ session });
      if (input.status === 'approved') {
        mirrorFlow = await syncCentralCashboxMirror(flow, req.user!.sub, session);
        await assignCashFlowReceiptNumber(flow, session);
        await postCashFlowLedger(flow, req.user!.sub, session);
        if (mirrorFlow) {
          await assignCashFlowReceiptNumber(mirrorFlow, session);
          await postCashFlowLedger(mirrorFlow, req.user!.sub, session);
        }
      } else {
        await voidCashFlowLedger(flow, req.user!.sub, 'cashflow rejected', session);
        await deleteCentralCashboxMirror(flow, session, req.user!.sub);
      }
    });
    await ensureCashFlowReceipt(flow, input.status === 'approved');
    if (mirrorFlow) await ensureCashFlowReceipt(mirrorFlow, true);

    await audit(req, {
      action: 'cashflow.central_review',
      entity: 'CashFlow',
      entityId: flow._id.toString(),
      franchiseId: flow.franchiseId?.toString(),
      details: { status: flow.status, amount: flow.amount, receiptPath: flow.receiptPath },
    });

    res.json({ flow });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requirePermission('cashflows.manage'),
  validate(z.object({ id: z.string().refine(isValidObjectId) }), 'params'),
  asyncHandler(async (req, res) => {
    if (!['ceo', 'admin', 'superadmin', 'manager', 'cash_central_maintainer'].includes(req.user!.role)) {
      throw forbidden('Deleting treasury movements requires superior treasury access');
    }
    const { id } = req.params as { id: string };
    const flow = await CashFlow.findById(id);
    if (!flow) throw notFound('Cashflow not found');
    if (req.user!.franchiseId && flow.franchiseId.toString() !== req.user!.franchiseId) throw forbidden();

    await withMongoTransaction(async (session) => {
      await voidCashFlowLedger(flow, req.user!.sub, 'cashflow deleted', session);
      await deleteCentralCashboxMirror(flow, session, req.user!.sub);
      await flow.deleteOne({ session });
    });
    await audit(req, {
      action: 'cashflow.delete',
      entity: 'CashFlow',
      entityId: flow._id.toString(),
      franchiseId: flow.franchiseId?.toString(),
      details: {
        type: flow.type,
        subType: flow.subType,
        amount: flow.amount,
        status: flow.status,
        receiptPath: flow.receiptPath,
      },
    });

    res.json({ ok: true });
  }),
);

export default router;
