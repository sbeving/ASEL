import { createWriteStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import { Router } from "express";
import { z } from "zod";
import mongoose, { isValidObjectId } from "mongoose";
import {
  requireAuth,
  requirePermission,
  requireRole,
  franchiseScopeFilter,
} from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { withMongoTransaction } from "../db/transaction.js";
import { Installment } from "../models/Installment.js";
import { Sale } from "../models/Sale.js";
import { Client } from "../models/Client.js";
import { audit } from "../services/audit.service.js";
import { refreshInstallmentNotifications } from "../services/installmentNotifications.service.js";
import {
  attachClientListMetrics,
  summarizeCollectionRisk,
} from "../services/clientInsights.service.js";
import { badRequest, forbidden, notFound } from "../utils/AppError.js";
import { ensureUploadDir } from "../config/uploads.js";
import { toUploadPath } from "../middleware/upload.js";
import { nextSequenceValue } from "../services/sequence.service.js";
import {
  formatInstallmentReceiptNumber,
  installmentReceiptSequenceKey,
} from "../utils/documentNumbers.js";
import { refreshClosingSystemTotalsForDates } from "../services/closing.service.js";

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: "Invalid id" });

const payload = z.object({
  saleId: objectId,
  clientId: objectId.nullable().optional(),
  amount: z.number().min(0),
  dueDate: z.string().datetime(),
  note: z.string().trim().max(1000).optional(),
});

const listQuery = z.object({
  franchiseId: objectId.optional(),
  status: z.enum(["pending", "paid", "late", "renegotiated"]).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const collectionQuery = z.object({
  franchiseId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const oldestLateDateSentinel = new Date("9999-12-31T00:00:00.000Z");

function statusForDueDate(dueDate: Date): "pending" | "late" {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today ? "late" : "pending";
}

function roundMoney(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function referenceIdString(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === "object" && "_id" in value) {
    return referenceIdString((value as { _id?: unknown })._id);
  }
  return String(value);
}

function installmentSnapshot(installment: any) {
  return {
    id: installment._id?.toString?.(),
    amount: installment.amount,
    originalAmount: installment.originalAmount,
    paidAmount: installment.paidAmount,
    dueDate: installment.dueDate,
    status: installment.status,
    waivedAmount: installment.waivedAmount,
    note: installment.note,
  };
}

export function validateRenegotiationParts(
  parts: Array<{ amount: number; dueDate: string }>,
  expectedTotal: number,
) {
  if (parts.length < 2) {
    throw badRequest("At least two split parts are required");
  }
  const normalized = parts.map((part) => {
    const amount = roundMoney(part.amount);
    const dueDate = new Date(part.dueDate);
    if (amount <= 0) throw badRequest("Split part amount must be positive");
    if (Number.isNaN(dueDate.getTime()))
      throw badRequest("Invalid split due date");
    return { amount, dueDate };
  });
  const total = roundMoney(
    normalized.reduce((sum, part) => sum + part.amount, 0),
  );
  if (total !== roundMoney(expectedTotal)) {
    throw badRequest("Split parts must match installment amount", {
      expectedTotal: roundMoney(expectedTotal),
      receivedTotal: total,
    });
  }
  return normalized;
}

export function applyInstallmentWaiverSnapshot(
  currentAmount: number,
  currentWaivedAmount: number,
  waivedAmount: number,
) {
  const waived = roundMoney(waivedAmount);
  if (waived <= 0) throw badRequest("Waived amount must be positive");
  if (waived > roundMoney(currentAmount)) {
    throw badRequest("Waived amount cannot exceed remaining installment");
  }
  const amount = roundMoney(currentAmount - waived);
  return {
    amount,
    waivedAmount: roundMoney((currentWaivedAmount ?? 0) + waived),
    status: amount > 0 ? undefined : ("renegotiated" as const),
  };
}

function formatMoney(value: number) {
  return `${value.toLocaleString("fr-TN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} TND`;
}

function writeReceiptField(
  doc: PDFKit.PDFDocument,
  label: string,
  value?: string | number | Date | null,
) {
  const text =
    value instanceof Date
      ? value.toLocaleString("fr-TN")
      : value == null || value === ""
        ? "-"
        : String(value);
  doc.fontSize(9).fillColor("#64748b").text(label.toUpperCase());
  doc.fontSize(12).fillColor("#0f172a").text(text, { width: 500 });
  doc.moveDown(0.45);
}

function installmentAggregateFilter(filter: Record<string, unknown>) {
  const aggregateFilter: Record<string, unknown> = { ...filter };
  const franchiseId = aggregateFilter.franchiseId;
  if (
    typeof franchiseId === "string" &&
    mongoose.Types.ObjectId.isValid(franchiseId)
  ) {
    aggregateFilter.franchiseId = new mongoose.Types.ObjectId(franchiseId);
  }
  return aggregateFilter;
}

function activeInstallmentPipeline(
  filter: Record<string, unknown>,
): mongoose.PipelineStage[] {
  return [
    { $match: installmentAggregateFilter(filter) },
    {
      $lookup: {
        from: "sales",
        localField: "saleId",
        foreignField: "_id",
        as: "sale",
      },
    },
    { $unwind: "$sale" },
    { $match: { "sale.cancelledAt": null } },
  ];
}

function installmentSummaryGroupStage(): mongoose.PipelineStage.Group {
  const paidAmountField = { $ifNull: ["$paidAmount", 0] };
  const remainingDelta = { $subtract: ["$amount", paidAmountField] };
  const remainingAmount = {
    $cond: [{ $gt: [remainingDelta, 0] }, remainingDelta, 0],
  };
  const paidValue = {
    $cond: [{ $gt: [paidAmountField, 0] }, paidAmountField, "$amount"],
  };
  const daysLate = {
    $floor: {
      $divide: [{ $subtract: [new Date(), "$dueDate"] }, 24 * 60 * 60 * 1000],
    },
  };
  const late0To7 = {
    $and: [{ $eq: ["$status", "late"] }, { $lte: [daysLate, 7] }],
  };
  const late8To30 = {
    $and: [
      { $eq: ["$status", "late"] },
      { $gt: [daysLate, 7] },
      { $lte: [daysLate, 30] },
    ],
  };
  const late31To60 = {
    $and: [
      { $eq: ["$status", "late"] },
      { $gt: [daysLate, 30] },
      { $lte: [daysLate, 60] },
    ],
  };
  const late60Plus = {
    $and: [{ $eq: ["$status", "late"] }, { $gt: [daysLate, 60] }],
  };

  return {
    $group: {
      _id: null,
      totalCount: { $sum: 1 },
      pendingCount: {
        $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
      },
      pendingAmount: {
        $sum: { $cond: [{ $eq: ["$status", "pending"] }, remainingAmount, 0] },
      },
      lateCount: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } },
      lateAmount: {
        $sum: { $cond: [{ $eq: ["$status", "late"] }, remainingAmount, 0] },
      },
      paidCount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
      paidAmount: {
        $sum: { $cond: [{ $eq: ["$status", "paid"] }, paidValue, 0] },
      },
      late0To7Count: { $sum: { $cond: [late0To7, 1, 0] } },
      late0To7Amount: { $sum: { $cond: [late0To7, remainingAmount, 0] } },
      late8To30Count: { $sum: { $cond: [late8To30, 1, 0] } },
      late8To30Amount: { $sum: { $cond: [late8To30, remainingAmount, 0] } },
      late31To60Count: { $sum: { $cond: [late31To60, 1, 0] } },
      late31To60Amount: { $sum: { $cond: [late31To60, remainingAmount, 0] } },
      late60PlusCount: { $sum: { $cond: [late60Plus, 1, 0] } },
      late60PlusAmount: { $sum: { $cond: [late60Plus, remainingAmount, 0] } },
      receiptCount: {
        $sum: {
          $cond: [
            {
              $and: [
                { $eq: ["$status", "paid"] },
                { $ne: [{ $ifNull: ["$receiptPath", null] }, null] },
              ],
            },
            1,
            0,
          ],
        },
      },
    },
  };
}

export function normalizeInstallmentSummary(summary?: Record<string, number>) {
  const pendingAmount = summary?.pendingAmount ?? 0;
  const lateAmount = summary?.lateAmount ?? 0;
  const paidAmount = summary?.paidAmount ?? 0;
  const dueAmount = pendingAmount + lateAmount;
  const collectibleAmount = paidAmount + dueAmount;
  return {
    totalCount: summary?.totalCount ?? 0,
    pendingCount: summary?.pendingCount ?? 0,
    pendingAmount,
    lateCount: summary?.lateCount ?? 0,
    lateAmount,
    dueAmount,
    paidCount: summary?.paidCount ?? 0,
    paidAmount,
    receiptCount: summary?.receiptCount ?? 0,
    collectionRate:
      collectibleAmount > 0
        ? Math.round((paidAmount / collectibleAmount) * 10000) / 100
        : 0,
    agingBuckets: {
      late0To7: {
        count: summary?.late0To7Count ?? 0,
        amount: summary?.late0To7Amount ?? 0,
      },
      late8To30: {
        count: summary?.late8To30Count ?? 0,
        amount: summary?.late8To30Amount ?? 0,
      },
      late31To60: {
        count: summary?.late31To60Count ?? 0,
        amount: summary?.late31To60Amount ?? 0,
      },
      late60Plus: {
        count: summary?.late60PlusCount ?? 0,
        amount: summary?.late60PlusAmount ?? 0,
      },
    },
  };
}

async function assignInstallmentReceiptNumber(
  installment: any,
  paidAt: Date,
  session?: mongoose.ClientSession,
) {
  if (installment.status !== "paid" || installment.receiptNumber)
    return installment;
  const sequence = await nextSequenceValue(
    installmentReceiptSequenceKey(paidAt),
    session,
  );
  installment.receiptNumber = formatInstallmentReceiptNumber(paidAt, sequence);
  await installment.save({ session });
  return installment;
}

async function ensureInstallmentReceipt(installment: any, force = false) {
  if (installment.status !== "paid") return installment;
  if (installment.receiptPath && !force) return installment;

  const paidAt =
    installment.paidAt instanceof Date
      ? installment.paidAt
      : new Date(installment.paidAt ?? Date.now());
  await assignInstallmentReceiptNumber(installment, paidAt);

  const populated = await installment.populate([
    { path: "franchiseId", select: "name address phone manager taxId" },
    { path: "clientId", select: "fullName phone phone2 email" },
    { path: "saleId", select: "invoiceNumber total createdAt saleType" },
    { path: "userId", select: "fullName username role" },
  ]);
  const receiptNumber = installment.receiptNumber;
  const filename = `${Date.now()}-${crypto.randomUUID()}-${receiptNumber.toLowerCase()}.pdf`;
  const absolutePath = path.join(
    ensureUploadDir("installment-receipts"),
    filename,
  );

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const stream = createWriteStream(absolutePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    const franchise =
      populated.franchiseId && typeof populated.franchiseId === "object"
        ? populated.franchiseId
        : null;
    const client =
      populated.clientId && typeof populated.clientId === "object"
        ? populated.clientId
        : null;
    const sale =
      populated.saleId && typeof populated.saleId === "object"
        ? populated.saleId
        : null;
    const author =
      populated.userId && typeof populated.userId === "object"
        ? populated.userId
        : null;

    doc.fontSize(20).fillColor("#0f172a").text("Recu encaissement echeance");
    doc
      .fontSize(10)
      .fillColor("#64748b")
      .text(`Genere le ${new Date().toLocaleString("fr-TN")}`);
    doc.moveDown();

    doc.roundedRect(48, doc.y, 500, 72, 8).fillAndStroke("#f8fafc", "#e2e8f0");
    doc
      .fillColor("#047857")
      .fontSize(24)
      .text(
        formatMoney(installment.paidAmount || installment.amount),
        64,
        doc.y + 16,
      );
    doc
      .fillColor("#334155")
      .fontSize(11)
      .text("ECHEANCE ENCAISSEE", 64, doc.y + 2);
    doc.moveDown(3.2);

    writeReceiptField(doc, "Numero recu", receiptNumber);
    writeReceiptField(
      doc,
      "Facture / vente",
      sale?.invoiceNumber || sale?._id?.toString?.(),
    );
    writeReceiptField(doc, "Franchise", franchise?.name);
    writeReceiptField(doc, "Client", client?.fullName);
    writeReceiptField(doc, "Telephone client", client?.phone || client?.phone2);
    writeReceiptField(doc, "Date echeance", installment.dueDate);
    writeReceiptField(doc, "Date encaissement", installment.paidAt);
    writeReceiptField(doc, "Mode paiement", installment.paymentMethod);
    writeReceiptField(doc, "Saisi par", author?.fullName || author?.username);
    writeReceiptField(doc, "Note", installment.note);

    doc.moveDown();
    doc
      .fontSize(8)
      .fillColor("#64748b")
      .text(
        "Document genere automatiquement apres encaissement de l echeance. Les reports et paiements partiels restent historises dans ASEL.",
        { align: "center" },
      );

    doc.end();
  });

  const receiptPath = toUploadPath("installment-receipts", filename);
  installment.receiptPath = receiptPath;
  installment.receiptCreatedAt = new Date();
  const historyEntry = installment.paymentHistory
    ?.slice()
    .reverse()
    .find(
      (entry: any) =>
        entry.receiptNumber === receiptNumber && !entry.receiptPath,
    );
  if (historyEntry) historyEntry.receiptPath = receiptPath;
  await installment.save();
  return installment;
}

router.get(
  "/",
  requireAuth,
  requirePermission("installments.view"),
  validate(listQuery, "query"),
  asyncHandler(async (req, res) => {
    const { franchiseId, status, from, to, page, pageSize, limit } =
      req.query as unknown as z.infer<typeof listQuery>;
    await refreshInstallmentNotifications();

    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId)
        throw forbidden();
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
    const basePipeline = activeInstallmentPipeline(filter);
    const [countRows, summaryRows, pageIds] = await Promise.all([
      Installment.aggregate<{ total: number }>([
        ...basePipeline,
        { $count: "total" },
      ]),
      Installment.aggregate<Record<string, number>>([
        ...basePipeline,
        installmentSummaryGroupStage(),
      ]),
      Installment.aggregate<{ _id: mongoose.Types.ObjectId }>([
        ...basePipeline,
        { $sort: { dueDate: 1, createdAt: 1 } },
        { $skip: skip },
        { $limit: effectivePageSize },
        { $project: { _id: 1 } },
      ]),
    ]);
    const ids = pageIds.map((row) => row._id);
    const orderById = new Map(ids.map((id, index) => [id.toString(), index]));
    const rows = ids.length
      ? await Installment.find({ _id: mongoose.trusted({ $in: ids }) })
          .populate({
            path: "saleId",
            select: "total createdAt invoiceNumber saleType paymentStatus",
          })
          .populate("clientId", "fullName phone phone2")
          .populate("userId", "username fullName")
          .populate("dueDateUpdatedBy", "username fullName")
          .populate("paidAtUpdatedBy", "username fullName")
      : [];
    rows.sort(
      (a, b) =>
        (orderById.get(a._id.toString()) ?? 0) -
        (orderById.get(b._id.toString()) ?? 0),
    );
    const total = countRows[0]?.total ?? 0;
    res.json({
      installments: rows,
      summary: normalizeInstallmentSummary(summaryRows[0]),
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
  "/collection",
  requireAuth,
  requirePermission("installments.view"),
  validate(collectionQuery, "query"),
  asyncHandler(async (req, res) => {
    const { franchiseId, limit } = req.query as unknown as z.infer<
      typeof collectionQuery
    >;
    await refreshInstallmentNotifications();

    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = {
      ...scope,
      status: mongoose.trusted({ $in: ["pending", "late"] }),
      clientId: mongoose.trusted({ $ne: null }),
    };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId)
        throw forbidden();
      filter.franchiseId = franchiseId;
    }

    const unpaidRows = await Installment.aggregate<{
      _id: mongoose.Types.ObjectId;
      franchiseId: mongoose.Types.ObjectId;
      balanceDue: number;
      pendingDue: number;
      lateDue: number;
      pendingInstallments: number;
      lateInstallments: number;
      nextDueDate: Date | null;
      oldestLateDate: Date | null;
    }>([
      ...activeInstallmentPipeline(filter),
      {
        $group: {
          _id: "$clientId",
          franchiseId: { $first: "$franchiseId" },
          balanceDue: {
            $sum: {
              $max: [
                { $subtract: ["$amount", { $ifNull: ["$paidAmount", 0] }] },
                0,
              ],
            },
          },
          pendingDue: {
            $sum: {
              $cond: [
                { $eq: ["$status", "pending"] },
                {
                  $max: [
                    { $subtract: ["$amount", { $ifNull: ["$paidAmount", 0] }] },
                    0,
                  ],
                },
                0,
              ],
            },
          },
          lateDue: {
            $sum: {
              $cond: [
                { $eq: ["$status", "late"] },
                {
                  $max: [
                    { $subtract: ["$amount", { $ifNull: ["$paidAmount", 0] }] },
                    0,
                  ],
                },
                0,
              ],
            },
          },
          pendingInstallments: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          lateInstallments: {
            $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] },
          },
          nextDueDate: { $min: "$dueDate" },
          oldestLateDate: {
            $min: {
              $cond: [
                { $eq: ["$status", "late"] },
                "$dueDate",
                oldestLateDateSentinel,
              ],
            },
          },
        },
      },
      { $sort: { lateDue: -1, balanceDue: -1, nextDueDate: 1 } },
      { $limit: limit },
    ]);

    const clientIds = unpaidRows.map((row) => row._id.toString());
    const clients = clientIds.length
      ? await Client.find({ _id: mongoose.trusted({ $in: clientIds }) })
          .populate("franchiseId", "name")
          .lean()
      : [];
    const metricScope = scope.franchiseId ?? franchiseId ?? null;
    const clientsWithMetrics = await attachClientListMetrics(
      clients,
      metricScope as string | null,
    );
    const clientById = new Map(
      clientsWithMetrics.map((client: any) => [client._id.toString(), client]),
    );

    const rows = unpaidRows.map((row) => {
      const client = clientById.get(row._id.toString()) as any;
      const franchise =
        client?.franchiseId && typeof client.franchiseId === "object"
          ? client.franchiseId
          : null;
      const oldestLateDate =
        row.oldestLateDate &&
        row.oldestLateDate.getTime() < oldestLateDateSentinel.getTime()
          ? row.oldestLateDate
          : null;
      return {
        clientId: row._id.toString(),
        clientName: client?.fullName ?? "Client",
        phone: client?.phone ?? null,
        phone2: client?.phone2 ?? null,
        franchiseId: row.franchiseId.toString(),
        franchiseName: franchise?.name ?? "Franchise",
        balanceDue: Math.round((row.balanceDue ?? 0) * 100) / 100,
        pendingDue: Math.round((row.pendingDue ?? 0) * 100) / 100,
        lateDue: Math.round((row.lateDue ?? 0) * 100) / 100,
        pendingInstallments: row.pendingInstallments ?? 0,
        lateInstallments: row.lateInstallments ?? 0,
        nextDueDate: row.nextDueDate,
        oldestLateDate,
        creditScore: client?.creditScore ?? null,
        riskTier: client?.creditScore?.tier ?? "unknown",
      };
    });

    res.json({
      summary: summarizeCollectionRisk(rows),
      clients: rows,
    });
  }),
);

router.post(
  "/",
  requireAuth,
  requireRole("ceo", "admin", "superadmin", "manager", "franchise"),
  requirePermission("installments.manage"),
  validate(payload),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof payload>;
    const sale = await Sale.findById(input.saleId);
    if (!sale) throw notFound("Sale not found");
    if (sale.cancelledAt)
      throw badRequest("Cannot create installments for a cancelled sale");
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== sale.franchiseId.toString())
      throw forbidden();

    if (input.clientId && !(await Client.exists({ _id: input.clientId }))) {
      throw badRequest("clientId does not exist");
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
      action: "installment.create",
      entity: "Installment",
      entityId: installment._id.toString(),
      franchiseId: sale.franchiseId.toString(),
      details: { saleId: sale._id.toString(), amount: installment.amount },
    });

    await refreshClosingSystemTotalsForDates(
      sale.franchiseId.toString(),
      [installment.dueDate],
      `Cloture reouverte suite creation echeance vente ${sale.invoiceNumber || sale._id.toString()}.`,
    );

    res.status(201).json({ installment });
  }),
);

const paySchema = z.object({
  paymentMethod: z.string().trim().max(40).optional(),
  amount: z.number().positive().optional(),
  paidAt: z.string().trim().min(1).optional(),
  remainingDueDate: z.string().trim().min(1).optional(),
  note: z.string().trim().max(1000).optional(),
});

const updateSchema = z
  .object({
    dueDate: z.string().datetime().optional(),
    paidAt: z.string().datetime().optional(),
    note: z.string().trim().max(1000).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine(
    (value) => value.dueDate || value.paidAt || value.note !== undefined,
    {
      message: "At least one field is required",
    },
  );

router.patch(
  "/:id",
  requireAuth,
  requireRole(
    "ceo",
    "admin",
    "superadmin",
    "manager",
    "cash_central_maintainer",
    "franchise",
    "seller",
    "vendeur",
  ),
  requirePermission("installments.manage"),
  validate(z.object({ id: objectId }), "params"),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateSchema>;
    const installment = await Installment.findById(req.params.id);
    if (!installment) throw notFound("Installment not found");
    const installmentFranchiseId = referenceIdString(installment.franchiseId);
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== installmentFranchiseId)
      throw forbidden();
    const linkedSale = await Sale.findById(installment.saleId).select(
      "cancelledAt",
    );
    if (!linkedSale) throw notFound("Sale not found");
    if (linkedSale.cancelledAt)
      throw badRequest(
        "Cannot modify an installment linked to a cancelled sale",
      );

    const before = {
      dueDate: installment.dueDate,
      paidAt: installment.paidAt,
      status: installment.status,
      note: installment.note,
    };

    if (input.dueDate) {
      if (
        installment.status === "paid" ||
        installment.status === "renegotiated"
      )
        throw badRequest("This installment cannot be rescheduled");
      const nextDueDate = new Date(input.dueDate);
      if (Number.isNaN(nextDueDate.getTime()))
        throw badRequest("Invalid due date");
      installment.dueDateHistory.push({
        from: installment.dueDate,
        to: nextDueDate,
        reason: input.reason ?? input.note ?? "",
        userId: req.user!.sub as any,
        createdAt: new Date(),
      } as any);
      installment.dueDate = nextDueDate;
      installment.status = statusForDueDate(nextDueDate);
      installment.remind7dSent = false;
      installment.remind3dSent = false;
      installment.dueDateUpdatedBy = req.user!.sub as any;
      installment.dueDateUpdatedAt = new Date();
      installment.renegotiationHistory.push({
        type: "postpone",
        before,
        after: installmentSnapshot(installment),
        reason: input.reason ?? input.note ?? "",
        userId: req.user!.sub as any,
        createdAt: new Date(),
      } as any);
    }

    if (input.paidAt) {
      if (installment.status !== "paid")
        throw badRequest("Only paid installments have an encaissement date");
      const nextPaidAt = new Date(input.paidAt);
      if (Number.isNaN(nextPaidAt.getTime()))
        throw badRequest("Invalid payment date");
      installment.paidAt = nextPaidAt;
      installment.paidAtUpdatedBy = req.user!.sub as any;
      installment.paidAtUpdatedAt = new Date();
    }

    if (input.note !== undefined) {
      installment.note = input.note;
    } else if (input.reason) {
      installment.note = [installment.note, input.reason]
        .filter(Boolean)
        .join(" | ");
    }

    await installment.save();
    if (installment.status === "paid") {
      await ensureInstallmentReceipt(installment, Boolean(input.paidAt));
    }
    await refreshClosingSystemTotalsForDates(
      installmentFranchiseId,
      [before.dueDate, installment.dueDate, before.paidAt, installment.paidAt],
      `Cloture reouverte suite modification echeance ${installment._id.toString()}.`,
    );
    await audit(req, {
      action: "installment.update",
      entity: "Installment",
      entityId: installment._id.toString(),
      franchiseId: installmentFranchiseId,
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

const renegotiateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("split"),
    parts: z
      .array(
        z.object({
          amount: z.number().positive(),
          dueDate: z.string().datetime(),
        }),
      )
      .min(2)
      .max(12),
    reason: z.string().trim().min(3).max(1000),
  }),
  z.object({
    type: z.literal("merge"),
    mergeInstallmentIds: z.array(objectId).min(1).max(24),
    dueDate: z.string().datetime().optional(),
    reason: z.string().trim().min(3).max(1000),
  }),
  z.object({
    type: z.literal("waive"),
    amount: z.number().positive(),
    reason: z.string().trim().min(3).max(1000),
  }),
]);

router.post(
  "/:id/renegotiate",
  requireAuth,
  requireRole("ceo", "admin", "superadmin", "manager", "franchise"),
  requirePermission("sales.credit.override"),
  validate(z.object({ id: objectId }), "params"),
  validate(renegotiateSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof renegotiateSchema>;
    const installment = await Installment.findById(req.params.id);
    if (!installment) throw notFound("Installment not found");
    const installmentFranchiseId = referenceIdString(installment.franchiseId);
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== installmentFranchiseId)
      throw forbidden();
    if (installment.status === "paid" || installment.status === "renegotiated")
      throw badRequest("Only unpaid active installments can be renegotiated");

    const linkedSale = await Sale.findById(installment.saleId).select(
      "cancelledAt",
    );
    if (!linkedSale) throw notFound("Sale not found");
    if (linkedSale.cancelledAt)
      throw badRequest(
        "Cannot renegotiate an installment linked to a cancelled sale",
      );

    const before = installmentSnapshot(installment);
    const refreshDates: Array<Date | null | undefined> = [installment.dueDate];
    let createdInstallments: unknown[] = [];
    let mergedInstallments: unknown[] = [];

    await withMongoTransaction(async (session) => {
      if (input.type === "split") {
        const parts = validateRenegotiationParts(
          input.parts,
          installment.amount,
        );
        const firstPart = parts[0];
        if (!firstPart) throw badRequest("First split part is required");
        const otherParts = parts.slice(1);
        installment.originalAmount =
          installment.originalAmount ?? installment.amount;
        installment.amount = firstPart.amount;
        installment.dueDate = firstPart.dueDate;
        installment.status = statusForDueDate(firstPart.dueDate);
        installment.remind7dSent = false;
        installment.remind3dSent = false;
        installment.renegotiatedAt = new Date();
        installment.renegotiatedBy = req.user!.sub as any;
        installment.note = [installment.note, `Renegociation: ${input.reason}`]
          .filter(Boolean)
          .join(" | ");
        await installment.save({ session });

        const rows = otherParts.map((part, index) => ({
          saleId: installment.saleId,
          franchiseId: installment.franchiseId,
          clientId: installment.clientId ?? null,
          amount: part.amount,
          originalAmount: part.amount,
          dueDate: part.dueDate,
          status: statusForDueDate(part.dueDate),
          note: `Renegociation ${index + 2}/${parts.length}: ${input.reason}`,
          splitFromInstallmentId: installment._id,
          userId: req.user!.sub,
        }));
        createdInstallments = await Installment.create(rows, { session });
        const createdIds = (createdInstallments as any[]).map((row) => row._id);
        installment.renegotiationHistory.push({
          type: "split",
          before,
          after: {
            current: installmentSnapshot(installment),
            parts: parts.map((part) => ({
              amount: part.amount,
              dueDate: part.dueDate,
            })),
          },
          relatedInstallmentIds: createdIds,
          reason: input.reason,
          userId: req.user!.sub as any,
          createdAt: new Date(),
        } as any);
        await installment.save({ session });
        refreshDates.push(...parts.map((part) => part.dueDate));
      }

      if (input.type === "merge") {
        const uniqueIds = [...new Set(input.mergeInstallmentIds)].filter(
          (id) => id !== installment._id.toString(),
        );
        if (uniqueIds.length === 0)
          throw badRequest("At least one other installment is required");
        const mergeRows = await Installment.find({
          _id: mongoose.trusted({ $in: uniqueIds }),
          franchiseId: installment.franchiseId,
          saleId: installment.saleId,
          status: mongoose.trusted({ $in: ["pending", "late"] }),
        }).session(session ?? null);
        if (mergeRows.length !== uniqueIds.length) {
          throw badRequest("All merged installments must be active and unpaid");
        }

        const clientKey = installment.clientId?.toString?.() ?? "";
        for (const row of mergeRows) {
          if ((row.clientId?.toString?.() ?? "") !== clientKey) {
            throw badRequest(
              "Merged installments must belong to the same client",
            );
          }
        }

        const nextDueDate = input.dueDate
          ? new Date(input.dueDate)
          : installment.dueDate;
        if (Number.isNaN(nextDueDate.getTime()))
          throw badRequest("Invalid merge due date");
        const mergeTotal = roundMoney(
          mergeRows.reduce((sum, row) => sum + row.amount, installment.amount),
        );
        const relatedIds = mergeRows.map((row) => row._id);

        installment.originalAmount = mergeTotal;
        installment.amount = mergeTotal;
        installment.dueDate = nextDueDate;
        installment.status = statusForDueDate(nextDueDate);
        installment.remind7dSent = false;
        installment.remind3dSent = false;
        installment.renegotiatedAt = new Date();
        installment.renegotiatedBy = req.user!.sub as any;
        installment.note = [
          installment.note,
          `Fusion echeances: ${input.reason}`,
        ]
          .filter(Boolean)
          .join(" | ");
        installment.renegotiationHistory.push({
          type: "merge",
          before,
          after: installmentSnapshot(installment),
          relatedInstallmentIds: relatedIds,
          reason: input.reason,
          userId: req.user!.sub as any,
          createdAt: new Date(),
        } as any);
        await installment.save({ session });

        for (const row of mergeRows) {
          const rowBefore = installmentSnapshot(row);
          refreshDates.push(row.dueDate);
          row.originalAmount = row.originalAmount ?? row.amount;
          row.amount = 0;
          row.paidAmount = 0;
          row.status = "renegotiated";
          row.renegotiatedAt = new Date();
          row.renegotiatedBy = req.user!.sub as any;
          row.note = [
            row.note,
            `Fusionnee dans ${installment._id.toString()}: ${input.reason}`,
          ]
            .filter(Boolean)
            .join(" | ");
          row.renegotiationHistory.push({
            type: "merge",
            before: rowBefore,
            after: { mergedInto: installment._id.toString() },
            relatedInstallmentIds: [installment._id],
            reason: input.reason,
            userId: req.user!.sub as any,
            createdAt: new Date(),
          } as any);
          await row.save({ session });
        }
        mergedInstallments = mergeRows;
        refreshDates.push(nextDueDate);
      }

      if (input.type === "waive") {
        const waiver = applyInstallmentWaiverSnapshot(
          installment.amount,
          installment.waivedAmount ?? 0,
          input.amount,
        );
        installment.originalAmount =
          installment.originalAmount ?? installment.amount;
        installment.amount = waiver.amount;
        installment.waivedAmount = waiver.waivedAmount;
        if (waiver.status) installment.status = waiver.status;
        else installment.status = statusForDueDate(installment.dueDate);
        installment.renegotiatedAt = new Date();
        installment.renegotiatedBy = req.user!.sub as any;
        installment.note = [
          installment.note,
          `Remise ${formatMoney(roundMoney(input.amount))}: ${input.reason}`,
        ]
          .filter(Boolean)
          .join(" | ");
        installment.renegotiationHistory.push({
          type: "waive",
          before,
          after: installmentSnapshot(installment),
          waivedAmount: roundMoney(input.amount),
          reason: input.reason,
          userId: req.user!.sub as any,
          createdAt: new Date(),
        } as any);
        await installment.save({ session });
      }
    });

    await refreshClosingSystemTotalsForDates(
      installmentFranchiseId,
      refreshDates,
      `Cloture reouverte suite renegociation echeance ${installment._id.toString()}.`,
    );
    await audit(req, {
      action: `installment.renegotiate.${input.type}`,
      entity: "Installment",
      entityId: installment._id.toString(),
      franchiseId: installmentFranchiseId,
      details: {
        type: input.type,
        reason: input.reason,
        before,
        after: installmentSnapshot(installment),
        createdInstallmentIds: (createdInstallments as any[]).map((row) =>
          row._id?.toString?.(),
        ),
        mergedInstallmentIds: (mergedInstallments as any[]).map((row) =>
          row._id?.toString?.(),
        ),
      },
    });

    const refreshed = await Installment.findById(installment._id)
      .populate({
        path: "saleId",
        select: "total createdAt invoiceNumber saleType paymentStatus",
      })
      .populate("clientId", "fullName phone phone2")
      .populate("userId", "username fullName")
      .populate("dueDateUpdatedBy", "username fullName")
      .populate("paidAtUpdatedBy", "username fullName");
    res.json({
      installment: refreshed ?? installment,
      createdInstallments,
      mergedInstallments,
    });
  }),
);

router.post(
  "/:id/pay",
  requireAuth,
  requireRole(
    "ceo",
    "admin",
    "superadmin",
    "manager",
    "cash_central_maintainer",
    "franchise",
    "seller",
    "vendeur",
  ),
  requirePermission("installments.manage"),
  validate(z.object({ id: objectId }), "params"),
  validate(paySchema),
  asyncHandler(async (req, res) => {
    const installment = await Installment.findById(req.params.id);
    if (!installment) throw notFound("Installment not found");
    const installmentFranchiseId = referenceIdString(installment.franchiseId);
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== installmentFranchiseId)
      throw forbidden();
    if (installment.status === "paid")
      throw badRequest("Installment already paid");
    if (installment.status === "renegotiated")
      throw badRequest("Renegotiated installments cannot be paid directly");
    const linkedSale = await Sale.findById(installment.saleId).select(
      "cancelledAt",
    );
    if (!linkedSale) throw notFound("Sale not found");
    if (linkedSale.cancelledAt)
      throw badRequest("Cannot pay an installment linked to a cancelled sale");

    const input = req.body as z.infer<typeof paySchema>;
    const paidAmount = roundMoney(input.amount ?? installment.amount);
    if (paidAmount <= 0) throw badRequest("Payment amount must be positive");
    if (paidAmount > installment.amount)
      throw badRequest("Payment amount cannot exceed installment amount");
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime()))
      throw badRequest("Invalid payment date");

    let remainderInstallment = null;
    const previousDueDate = installment.dueDate;
    const originalAmount = installment.originalAmount ?? installment.amount;
    const remainingAmount = roundMoney(installment.amount - paidAmount);
    let remainderDueDate: Date | null = null;
    if (remainingAmount > 0) {
      remainderDueDate = input.remainingDueDate
        ? new Date(input.remainingDueDate)
        : new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
      if (Number.isNaN(remainderDueDate.getTime()))
        throw badRequest("Invalid remaining due date");
    }

    let salePaymentStatus: string | null = null;
    await withMongoTransaction(async (session) => {
      installment.originalAmount = originalAmount;
      installment.amount = paidAmount;
      installment.paidAmount = paidAmount;
      installment.status = "paid";
      installment.paidAt = paidAt;
      installment.paymentMethod =
        input.paymentMethod ?? installment.paymentMethod;
      installment.note = input.note
        ? [installment.note, input.note].filter(Boolean).join(" | ")
        : installment.note;
      await assignInstallmentReceiptNumber(installment, paidAt, session);
      installment.paymentHistory.push({
        amount: paidAmount,
        paidAt,
        paymentMethod: installment.paymentMethod,
        receiptNumber: installment.receiptNumber,
        receiptPath: null,
        note: input.note ?? "",
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
        .select("total amountReceived paymentStatus")
        .session(session ?? null);
      if (sale) {
        const received = roundMoney((sale.amountReceived ?? 0) + paidAmount);
        sale.amountReceived = Math.min(sale.total, received);
        sale.paymentStatus =
          sale.amountReceived >= sale.total
            ? "paid"
            : sale.amountReceived > 0
              ? "partial"
              : "pending";
        salePaymentStatus = sale.paymentStatus;
        await sale.save({ session });
      }
    });
    await ensureInstallmentReceipt(installment);
    await refreshClosingSystemTotalsForDates(
      installmentFranchiseId,
      [previousDueDate, paidAt, remainderDueDate],
      `Cloture reouverte suite encaissement echeance ${installment._id.toString()}.`,
    );

    await audit(req, {
      action: "installment.pay",
      entity: "Installment",
      entityId: installment._id.toString(),
      franchiseId: installmentFranchiseId,
      details: {
        amount: paidAmount,
        paidAt,
        remainingAmount,
        salePaymentStatus,
        receiptNumber: installment.receiptNumber,
        receiptPath: installment.receiptPath,
      },
    });

    res.json({ installment, remainderInstallment });
  }),
);

router.post(
  "/generate",
  requireAuth,
  requireRole("ceo", "admin", "superadmin", "manager", "franchise"),
  requirePermission("installments.manage"),
  validate(
    z.object({
      saleId: objectId,
      clientId: objectId.nullable().optional(),
      nbLots: z.number().int().min(1).max(60),
      startDate: z.string().datetime(),
      intervalDays: z.number().int().min(1).default(30),
      note: z.string().max(1000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const input = req.body as {
      saleId: string;
      clientId?: string | null;
      nbLots: number;
      startDate: string;
      intervalDays: number;
      note?: string;
    };
    const sale = await Sale.findById(input.saleId);
    if (!sale) throw notFound("Sale not found");
    if (sale.cancelledAt)
      throw badRequest("Cannot generate installments for a cancelled sale");
    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && scope.franchiseId !== sale.franchiseId.toString())
      throw forbidden();

    if (input.clientId && !(await Client.exists({ _id: input.clientId }))) {
      throw badRequest("clientId does not exist");
    }

    const totalAmount = sale.total;
    const baseAmount = Math.floor((totalAmount / input.nbLots) * 100) / 100;
    const remainder =
      Math.round((totalAmount - baseAmount * input.nbLots) * 100) / 100;

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
        note: input.note
          ? `${input.note} (Lot ${i + 1}/${input.nbLots})`
          : `Lot ${i + 1}/${input.nbLots}`,
        userId: req.user!.sub,
      });

      currentDate.setDate(currentDate.getDate() + input.intervalDays);
    }

    const installments = await Installment.insertMany(installmentsData);
    await refreshClosingSystemTotalsForDates(
      sale.franchiseId.toString(),
      installments.map((installment) => installment.dueDate),
      `Cloture reouverte suite generation echeances vente ${sale.invoiceNumber || sale._id.toString()}.`,
    );

    await audit(req, {
      action: "installment.generate",
      entity: "Installment",
      entityId: sale._id.toString(), // using saleId as ref
      franchiseId: sale.franchiseId.toString(),
      details: {
        saleId: sale._id.toString(),
        nbLots: input.nbLots,
        totalAmount,
      },
    });

    res.status(201).json({ installments });
  }),
);

export default router;
