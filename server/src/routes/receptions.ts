import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission, requireRole, franchiseScopeFilter } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Reception } from '../models/Reception.js';
import { Supplier } from '../models/Supplier.js';
import { Product } from '../models/Product.js';
import { applyStockDelta } from '../services/stock.service.js';
import { audit } from '../services/audit.service.js';
import { extractTextFromDocument, parseReceptionOcr } from '../services/ocr.service.js';
import { receptionOcrUpload, toUploadPath } from '../middleware/upload.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

function rounded(n: number): number {
  return Math.round(n * 100) / 100;
}

function receiptNumberFromDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `BR-${y}${m}${d}-${rand}`;
}

const lineSchema = z.object({
  productId: objectId,
  quantity: z.number().int().positive(),
  unitPriceHt: z.number().min(0),
  vatRate: z.number().min(0).max(100).default(19),
});

const payload = z.object({
  number: z.string().trim().max(80).optional(),
  franchiseId: objectId,
  supplierId: objectId.nullable().optional(),
  receptionDate: z.string().datetime().optional(),
  note: z.string().trim().max(2000).optional(),
  sourceDocumentPath: z.string().trim().max(260).optional(),
  status: z.enum(['draft', 'validated']).default('draft'),
  lines: z.array(lineSchema).default([]),
});

const querySchema = z.object({
  franchiseId: objectId.optional(),
  status: z.enum(['draft', 'validated', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

router.get(
  '/',
  requireAuth,
  requirePermission('receptions.view'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { franchiseId, status, limit } = req.query as unknown as z.infer<typeof querySchema>;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (status) filter.status = status;

    const receptions = await Reception.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('franchiseId', 'name')
      .populate('supplierId', 'name')
      .populate('userId', 'username fullName')
      .populate('validatedBy', 'username fullName')
      .populate('lines.productId', 'name reference');
    res.json({ receptions });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('receptions.manage'),
  validate(payload),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof payload>;
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== input.franchiseId) throw forbidden();

    if (input.supplierId && !(await Supplier.exists({ _id: input.supplierId }))) {
      throw badRequest('supplierId does not exist');
    }

    const productIds = input.lines.map((l) => l.productId);
    if (productIds.length > 0) {
      const existing = await Product.countDocuments({ _id: { $in: productIds } });
      if (existing !== productIds.length) throw badRequest('One or more products do not exist');
    }

    const lines = input.lines.map((line) => {
      const unitPriceTtc = rounded(line.unitPriceHt * (1 + line.vatRate / 100));
      const totalHt = rounded(line.unitPriceHt * line.quantity);
      const totalTtc = rounded(unitPriceTtc * line.quantity);
      return { ...line, unitPriceTtc, totalHt, totalTtc };
    });

    const totalHt = rounded(lines.reduce((sum, l) => sum + l.totalHt, 0));
    const totalTtc = rounded(lines.reduce((sum, l) => sum + l.totalTtc, 0));
    const vat = rounded(totalTtc - totalHt);

    const reception = await Reception.create({
      number: input.number || receiptNumberFromDate(),
      franchiseId: input.franchiseId,
      supplierId: input.supplierId ?? null,
      receptionDate: input.receptionDate ? new Date(input.receptionDate) : new Date(),
      totalHt,
      vat,
      totalTtc,
      status: input.status,
      note: input.note,
      sourceDocumentPath: input.sourceDocumentPath,
      userId: req.user!.sub,
      lines,
    });

    if (reception.status === 'validated') {
      for (const line of lines) {
        await applyStockDelta({
          franchiseId: reception.franchiseId,
          productId: line.productId,
          delta: line.quantity,
          type: 'stock_in',
          userId: req.user!.sub,
          unitPrice: line.unitPriceTtc,
          note: `Reception ${reception.number}`,
          refId: reception._id,
        });
      }
      reception.validatedAt = new Date();
      reception.validatedBy = req.user!.sub as any;
      await reception.save();
    }

    await audit(req, {
      action: reception.status === 'validated' ? 'reception.create_validate' : 'reception.create_draft',
      entity: 'Reception',
      entityId: reception._id.toString(),
      franchiseId: input.franchiseId,
      details: { number: reception.number, lines: lines.length, totalTtc: reception.totalTtc },
    });

    res.status(201).json({ reception });
  }),
);

router.post(
  '/ocr',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('receptions.manage'),
  receptionOcrUpload.single('document'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('document file is required');

    const extraction = await extractTextFromDocument(req.file.path, req.file.mimetype);
    const products = await Product.find({ active: true })
      .select('name reference barcode')
      .sort({ name: 1 })
      .lean();
    const parsed = parseReceptionOcr(
      extraction.text,
      products.map((p) => ({
        id: p._id.toString(),
        name: p.name,
        reference: p.reference,
        barcode: p.barcode,
      })),
    );

    let suggestedSupplierId: string | null = null;
    if (parsed.header.supplierName) {
      const escaped = parsed.header.supplierName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const supplier = await Supplier.findOne({
        name: { $regex: escaped, $options: 'i' },
        active: true,
      })
        .select('_id name')
        .lean();
      if (supplier?._id) suggestedSupplierId = supplier._id.toString();
    }

    res.json({
      documentPath: toUploadPath('reception-ocr', req.file.filename),
      extraction: {
        engine: extraction.engine,
        warnings: extraction.warnings,
        textPreview: extraction.text.slice(0, 6000),
      },
      suggestion: {
        ...parsed,
        header: {
          ...parsed.header,
          supplierId: suggestedSupplierId,
        },
      },
    });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('receptions.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(payload.omit({ franchiseId: true, status: true }).partial()),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const input = req.body as Partial<z.infer<typeof payload>>;
    const reception = await Reception.findById(id);
    if (!reception) throw notFound('Reception not found');
    if (reception.status !== 'draft') throw badRequest('Only draft receptions can be edited');

    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== reception.franchiseId.toString()) throw forbidden();

    if (input.supplierId !== undefined) {
      if (input.supplierId && !(await Supplier.exists({ _id: input.supplierId }))) throw badRequest('supplierId does not exist');
      reception.supplierId = input.supplierId as any;
    }
    if (input.receptionDate) reception.receptionDate = new Date(input.receptionDate);
    if (input.note !== undefined) reception.note = input.note;
    if (input.number) reception.number = input.number;
    if (input.sourceDocumentPath !== undefined) reception.sourceDocumentPath = input.sourceDocumentPath;

    if (input.lines) {
      const productIds = input.lines.map((l) => l.productId);
      if (productIds.length > 0) {
        const existing = await Product.countDocuments({ _id: { $in: productIds } });
        if (existing !== productIds.length) throw badRequest('One or more products do not exist');
      }
      const lines = input.lines.map((line) => {
        const unitPriceTtc = rounded(line.unitPriceHt * (1 + line.vatRate / 100));
        const totalHt = rounded(line.unitPriceHt * line.quantity);
        const totalTtc = rounded(unitPriceTtc * line.quantity);
        return { ...line, unitPriceTtc, totalHt, totalTtc };
      });
      reception.lines = lines as any;
      reception.totalHt = rounded(lines.reduce((sum, l) => sum + l.totalHt, 0));
      reception.totalTtc = rounded(lines.reduce((sum, l) => sum + l.totalTtc, 0));
      reception.vat = rounded(reception.totalTtc - reception.totalHt);
    }

    await reception.save();
    await audit(req, { action: 'reception.update', entity: 'Reception', entityId: id, franchiseId: reception.franchiseId.toString() });
    res.json({ reception });
  }),
);

router.post(
  '/:id/validate',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('receptions.manage'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const reception = await Reception.findById(id);
    if (!reception) throw notFound('Reception not found');
    if (reception.status !== 'draft') throw badRequest('Reception is already processed');

    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== reception.franchiseId.toString()) throw forbidden();

    for (const line of reception.lines) {
      await applyStockDelta({
        franchiseId: reception.franchiseId,
        productId: line.productId,
        delta: line.quantity,
        type: 'stock_in',
        userId: req.user!.sub,
        unitPrice: line.unitPriceTtc,
        note: `Reception ${reception.number}`,
        refId: reception._id,
      });
    }

    reception.status = 'validated';
    reception.validatedAt = new Date();
    reception.validatedBy = req.user!.sub as any;
    await reception.save();

    await audit(req, {
      action: 'reception.validate',
      entity: 'Reception',
      entityId: id,
      franchiseId: reception.franchiseId.toString(),
      details: { number: reception.number, lines: reception.lines.length, totalTtc: reception.totalTtc },
    });

    res.json({ reception });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  requirePermission('receptions.manage'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const reception = await Reception.findById(id);
    if (!reception) throw notFound('Reception not found');
    if (reception.status !== 'draft') throw badRequest('Only draft receptions can be cancelled');

    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== reception.franchiseId.toString()) throw forbidden();

    reception.status = 'cancelled';
    await reception.save();
    await audit(req, { action: 'reception.cancel', entity: 'Reception', entityId: id, franchiseId: reception.franchiseId.toString() });
    res.json({ reception });
  }),
);

export default router;
