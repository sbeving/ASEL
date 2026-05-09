import mongoose from 'mongoose';
import { CashFlow } from '../models/CashFlow.js';
import { Closing } from '../models/Closing.js';
import { Franchise } from '../models/Franchise.js';
import { Installment } from '../models/Installment.js';
import { Return } from '../models/Return.js';
import { Sale } from '../models/Sale.js';
import { User } from '../models/User.js';
import { badRequest } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { Role } from '../utils/roles.js';

export function dayBounds(dateStr: string): { start: Date; end: Date } {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) throw badRequest('Invalid date');
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function toDateInput(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function appendComment(existing: string | null | undefined, addition: string) {
  return [existing, addition].filter(Boolean).join('\n');
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export const CLOSING_VARIANCE_REASON_THRESHOLD = 5;

export interface ClosingCashDenominationInput {
  label?: string | null;
  value: number;
  quantity: number;
}

export function normalizeClosingCashDenominations(
  lines: ClosingCashDenominationInput[] = [],
) {
  const normalized = lines
    .map((line) => {
      const value = roundMoney(Math.max(0, Number(line.value) || 0));
      const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0));
      return {
        label: (line.label || `${value}`).trim().slice(0, 20),
        value,
        quantity,
        total: roundMoney(value * quantity),
      };
    })
    .filter((line) => line.value > 0 && line.quantity > 0);

  return {
    lines: normalized,
    total: roundMoney(normalized.reduce((sum, line) => sum + line.total, 0)),
  };
}

export function closingVarianceAmount(
  declaredTotal: number,
  expectedTotal: number,
) {
  return roundMoney((declaredTotal || 0) - (expectedTotal || 0));
}

export function closingRequiresVarianceReason(
  declaredTotal: number,
  expectedTotal: number,
) {
  return (
    Math.abs(closingVarianceAmount(declaredTotal, expectedTotal)) >=
    CLOSING_VARIANCE_REASON_THRESHOLD
  );
}

const CLOSING_LOCK_OVERRIDE_ROLES: ReadonlySet<Role> = new Set([
  'superadmin',
  'ceo',
  'admin',
]);

export function canOverrideValidatedClosing(role?: Role | null) {
  return role ? CLOSING_LOCK_OVERRIDE_ROLES.has(role) : false;
}

export function closingInstallmentAdvanceAmount(sale: {
  paymentMethod?: string | null;
  amountReceived?: number | null;
  total?: number | null;
  installmentPlan?: { upfrontAmount?: number | null } | null;
}) {
  if (sale.paymentMethod !== 'installment') return 0;
  const upfrontAmount =
    sale.installmentPlan?.upfrontAmount ?? sale.amountReceived ?? 0;
  return roundMoney(
    Math.max(0, Math.min(sale.total ?? upfrontAmount, upfrontAmount)),
  );
}

export function closingExpectedDrawerAmount(input: {
  systemCashTotal?: number | null;
  treasuryCashInTotal?: number | null;
  treasuryCashOutTotal?: number | null;
  returnRefundTotal?: number | null;
}) {
  return roundMoney(
    Math.max(
      0,
      (input.systemCashTotal ?? 0) +
        (input.treasuryCashInTotal ?? 0) -
        (input.treasuryCashOutTotal ?? 0) -
        (input.returnRefundTotal ?? 0),
    ),
  );
}

export async function computeClosingSummary(franchiseId: string, date: string) {
  const { start, end } = dayBounds(date);
  const [
    sales,
    paidInstallments,
    dueInstallments,
    cashFlowSummary,
    returnSummary,
  ] = await Promise.all([
    Sale.find({
      franchiseId,
      cancelledAt: null,
      createdAt: mongoose.trusted({ $gte: start, $lte: end }),
    }).select(
      'items total paymentMethod paymentStatus amountReceived installmentPlan',
    ),
    Installment.aggregate<{
      amount: number;
      paidAmount?: number;
      paymentMethod?: string | null;
    }>([
      {
        $match: {
          franchiseId: new mongoose.Types.ObjectId(franchiseId),
          status: 'paid',
          paidAt: mongoose.trusted({ $gte: start, $lte: end }),
        },
      },
      {
        $lookup: {
          from: 'sales',
          localField: 'saleId',
          foreignField: '_id',
          as: 'sale',
        },
      },
      { $unwind: '$sale' },
      { $match: { 'sale.cancelledAt': null } },
      { $project: { amount: 1, paidAmount: 1, paymentMethod: 1 } },
    ]),
    Installment.aggregate<{ amount: number; paidAmount?: number }>([
      {
        $match: {
          franchiseId: new mongoose.Types.ObjectId(franchiseId),
          status: mongoose.trusted({ $in: ['pending', 'late'] }),
          dueDate: mongoose.trusted({ $gte: start, $lte: end }),
        },
      },
      {
        $lookup: {
          from: 'sales',
          localField: 'saleId',
          foreignField: '_id',
          as: 'sale',
        },
      },
      { $unwind: '$sale' },
      { $match: { 'sale.cancelledAt': null } },
      { $project: { amount: 1, paidAmount: 1 } },
    ]),
    CashFlow.aggregate<{
      treasuryCashInTotal: number;
      treasuryCashOutTotal: number;
      expenseCashOutTotal: number;
      centralCashOutTotal: number;
    }>([
      {
        $match: {
          franchiseId: new mongoose.Types.ObjectId(franchiseId),
          status: 'approved',
          isCentralCashbox: mongoose.trusted({ $ne: true }),
          date: mongoose.trusted({ $gte: start, $lte: end }),
        },
      },
      {
        $group: {
          _id: null,
          treasuryCashInTotal: {
            $sum: { $cond: [{ $eq: ['$type', 'encaissement'] }, '$amount', 0] },
          },
          treasuryCashOutTotal: {
            $sum: { $cond: [{ $eq: ['$type', 'decaissement'] }, '$amount', 0] },
          },
          expenseCashOutTotal: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$type', 'decaissement'] },
                    { $eq: ['$subType', 'expense'] },
                  ],
                },
                '$amount',
                0,
              ],
            },
          },
          centralCashOutTotal: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$type', 'decaissement'] },
                    { $eq: ['$subType', 'central_cashbox'] },
                  ],
                },
                '$amount',
                0,
              ],
            },
          },
        },
      },
    ]),
    Return.aggregate<{ returnRefundTotal: number; returnRefundCount: number }>([
      {
        $match: {
          franchiseId: new mongoose.Types.ObjectId(franchiseId),
          returnType: 'return',
          createdAt: mongoose.trusted({ $gte: start, $lte: end }),
        },
      },
      {
        $group: {
          _id: null,
          returnRefundTotal: {
            $sum: { $multiply: ['$quantity', '$unitPrice'] },
          },
          returnRefundCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const systemSalesTotal = roundMoney(
    sales.reduce((sum, sale) => sum + (sale.total ?? 0), 0),
  );
  const systemItemsTotal = sales.reduce(
    (sum, sale) =>
      sum + sale.items.reduce((sub, item) => sub + item.quantity, 0),
    0,
  );
  const cashSalesTotal = roundMoney(
    sales.reduce((sum, sale) => {
      if (sale.paymentMethod !== 'cash') return sum;
      return sum + (sale.amountReceived ?? sale.total ?? 0);
    }, 0),
  );
  const cardSalesTotal = roundMoney(
    sales.reduce(
      (sum, sale) =>
        sum +
        (sale.paymentMethod === 'card'
          ? (sale.amountReceived ?? sale.total ?? 0)
          : 0),
      0,
    ),
  );
  const transferSalesTotal = roundMoney(
    sales.reduce(
      (sum, sale) =>
        sum +
        (sale.paymentMethod === 'transfer'
          ? (sale.amountReceived ?? sale.total ?? 0)
          : 0),
      0,
    ),
  );
  const otherSalesTotal = roundMoney(
    sales.reduce(
      (sum, sale) =>
        sum +
        (sale.paymentMethod === 'other'
          ? (sale.amountReceived ?? sale.total ?? 0)
          : 0),
      0,
    ),
  );
  const installmentAdvancesTotal = roundMoney(
    sales.reduce((sum, sale) => {
      return sum + closingInstallmentAdvanceAmount(sale);
    }, 0),
  );
  const cashInstallmentsTotal = roundMoney(
    paidInstallments.reduce((sum, installment) => {
      if ((installment.paymentMethod ?? 'cash') !== 'cash') return sum;
      return sum + (installment.paidAmount || installment.amount || 0);
    }, 0),
  );
  const installmentPaidTotal = roundMoney(
    paidInstallments.reduce(
      (sum, installment) =>
        sum + (installment.paidAmount || installment.amount || 0),
      0,
    ),
  );
  const installmentDueTotal = roundMoney(
    dueInstallments.reduce((sum, installment) => {
      const remaining = Math.max(
        0,
        (installment.amount ?? 0) - (installment.paidAmount ?? 0),
      );
      return sum + remaining;
    }, 0),
  );
  const systemCashTotal = roundMoney(
    cashSalesTotal + installmentAdvancesTotal + cashInstallmentsTotal,
  );
  const treasury = cashFlowSummary[0] ?? {
    treasuryCashInTotal: 0,
    treasuryCashOutTotal: 0,
    expenseCashOutTotal: 0,
    centralCashOutTotal: 0,
  };
  const returns = returnSummary[0] ?? {
    returnRefundTotal: 0,
    returnRefundCount: 0,
  };
  const treasuryCashInTotal = roundMoney(treasury.treasuryCashInTotal ?? 0);
  const treasuryCashOutTotal = roundMoney(treasury.treasuryCashOutTotal ?? 0);
  const returnRefundTotal = roundMoney(returns.returnRefundTotal ?? 0);
  const expectedDrawerTotal = closingExpectedDrawerAmount({
    systemCashTotal,
    treasuryCashInTotal,
    treasuryCashOutTotal,
    returnRefundTotal,
  });
  const paymentBreakdown = sales.reduce<
    Record<string, { count: number; total: number }>
  >((acc, sale) => {
    const key = sale.paymentMethod ?? 'other';
    acc[key] ??= { count: 0, total: 0 };
    acc[key].count += 1;
    acc[key].total = roundMoney(acc[key].total + (sale.total ?? 0));
    return acc;
  }, {});

  return {
    date,
    franchiseId,
    saleCount: sales.length,
    systemSalesTotal,
    systemItemsTotal,
    systemCashTotal,
    cashSalesTotal,
    cardSalesTotal,
    transferSalesTotal,
    otherSalesTotal,
    installmentAdvancesTotal,
    cashInstallmentsTotal,
    installmentCashCount: paidInstallments.filter(
      (installment) => (installment.paymentMethod ?? 'cash') === 'cash',
    ).length,
    installmentPaidTotal,
    installmentPaidCount: paidInstallments.length,
    installmentDueTotal,
    installmentDueCount: dueInstallments.length,
    treasuryCashInTotal,
    treasuryCashOutTotal,
    expenseCashOutTotal: roundMoney(treasury.expenseCashOutTotal ?? 0),
    centralCashOutTotal: roundMoney(treasury.centralCashOutTotal ?? 0),
    returnRefundTotal,
    returnRefundCount: returns.returnRefundCount ?? 0,
    expectedDrawerTotal,
    paymentBreakdown,
  };
}

export async function refreshClosingSystemTotalsForDates(
  franchiseId: string,
  dates: Array<Date | string | null | undefined>,
  reason = 'Recalcul automatique suite modification ventes.',
) {
  const uniqueDates = new Map<string, Date>();
  for (const value of dates) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    uniqueDates.set(toDateInput(date), date);
  }

  const refreshed = [];
  for (const date of uniqueDates.values()) {
    refreshed.push(await refreshClosingSystemTotals(franchiseId, date, reason));
  }
  return refreshed.filter(Boolean);
}

export async function autoCloseMissingDailyClosings(targetDate = new Date()) {
  const closingDate = toDateInput(targetDate);
  const { start } = dayBounds(closingDate);
  const submitter = await User.findOne({
    active: true,
    role: mongoose.trusted({
      $in: ['superadmin', 'admin', 'manager', 'cash_central_maintainer'],
    }),
  }).select('_id');
  if (!submitter) {
    logger.warn(
      { closingDate },
      'Skipping automatic closing: no eligible submitter found',
    );
    return { created: 0, skipped: 0 };
  }

  const franchises = await Franchise.find({ active: true })
    .select('_id name')
    .lean();
  let created = 0;
  let skipped = 0;
  for (const franchise of franchises) {
    const exists = await Closing.exists({
      franchiseId: franchise._id,
      closingDate: start,
    });
    if (exists) {
      skipped += 1;
      continue;
    }

    const summary = await computeClosingSummary(
      franchise._id.toString(),
      closingDate,
    );
    await Closing.create({
      franchiseId: franchise._id,
      closingDate: start,
      declaredSalesTotal: summary.expectedDrawerTotal,
      declaredItemsTotal: summary.systemItemsTotal,
      systemSalesTotal: summary.systemSalesTotal,
      systemItemsTotal: summary.systemItemsTotal,
      systemCashTotal: summary.systemCashTotal,
      cashSalesTotal: summary.cashSalesTotal,
      cashInstallmentsTotal: summary.cashInstallmentsTotal,
      cardSalesTotal: summary.cardSalesTotal,
      transferSalesTotal: summary.transferSalesTotal,
      otherSalesTotal: summary.otherSalesTotal,
      installmentAdvancesTotal: summary.installmentAdvancesTotal,
      installmentDueTotal: summary.installmentDueTotal,
      installmentDueCount: summary.installmentDueCount,
      installmentPaidTotal: summary.installmentPaidTotal,
      installmentPaidCount: summary.installmentPaidCount,
      treasuryCashInTotal: summary.treasuryCashInTotal,
      treasuryCashOutTotal: summary.treasuryCashOutTotal,
      returnRefundTotal: summary.returnRefundTotal,
      expectedDrawerTotal: summary.expectedDrawerTotal,
      comment: 'Cloture automatique generee a 04:00.',
      autoGenerated: true,
      validated: false,
      submittedBy: submitter._id,
      validatedBy: null,
      validatedAt: null,
    });
    created += 1;
  }

  logger.info({ closingDate, created, skipped }, 'Automatic closings checked');
  return { created, skipped };
}

export async function refreshClosingSystemTotals(
  franchiseId: string,
  saleDate: Date,
  reason = 'Recalcul automatique suite modification ventes.',
) {
  const closingDate = toDateInput(saleDate);
  const { start } = dayBounds(closingDate);
  const closing = await Closing.findOne({ franchiseId, closingDate: start });
  if (!closing) return null;

  const summary = await computeClosingSummary(franchiseId, closingDate);
  closing.systemSalesTotal = summary.systemSalesTotal;
  closing.systemItemsTotal = summary.systemItemsTotal;
  closing.systemCashTotal = summary.systemCashTotal;
  closing.cashSalesTotal = summary.cashSalesTotal;
  closing.cashInstallmentsTotal = summary.cashInstallmentsTotal;
  closing.cardSalesTotal = summary.cardSalesTotal;
  closing.transferSalesTotal = summary.transferSalesTotal;
  closing.otherSalesTotal = summary.otherSalesTotal;
  closing.installmentAdvancesTotal = summary.installmentAdvancesTotal;
  closing.installmentDueTotal = summary.installmentDueTotal;
  closing.installmentDueCount = summary.installmentDueCount;
  closing.installmentPaidTotal = summary.installmentPaidTotal;
  closing.installmentPaidCount = summary.installmentPaidCount;
  closing.treasuryCashInTotal = summary.treasuryCashInTotal;
  closing.treasuryCashOutTotal = summary.treasuryCashOutTotal;
  closing.returnRefundTotal = summary.returnRefundTotal;
  closing.expectedDrawerTotal = summary.expectedDrawerTotal;
  if (closing.autoGenerated && !closing.validated) {
    closing.declaredSalesTotal = summary.expectedDrawerTotal;
    closing.declaredItemsTotal = summary.systemItemsTotal;
  }
  if (closing.validated) {
    closing.validated = false;
    closing.validatedBy = null;
    closing.validatedAt = null;
    closing.comment = appendComment(closing.comment, reason);
  }
  await closing.save();
  return closing;
}

export function scheduleAutomaticClosings() {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(4, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    setTimeout(async () => {
      const previousDay = new Date();
      previousDay.setDate(previousDay.getDate() - 1);
      try {
        await autoCloseMissingDailyClosings(previousDay);
      } catch (err) {
        logger.error({ err }, 'Automatic closing failed');
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
}
