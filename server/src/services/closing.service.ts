import mongoose from 'mongoose';
import { Closing } from '../models/Closing.js';
import { Franchise } from '../models/Franchise.js';
import { Installment } from '../models/Installment.js';
import { Sale } from '../models/Sale.js';
import { User } from '../models/User.js';
import { badRequest } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

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

export async function computeClosingSummary(franchiseId: string, date: string) {
  const { start, end } = dayBounds(date);
  const [sales, paidInstallments, dueInstallments] = await Promise.all([
    Sale.find({
      franchiseId,
      cancelledAt: null,
      createdAt: mongoose.trusted({ $gte: start, $lte: end }),
    }).select('items total paymentMethod paymentStatus amountReceived'),
    Installment.aggregate<{ amount: number; paidAmount?: number; paymentMethod?: string | null }>([
      {
        $match: {
          franchiseId: new mongoose.Types.ObjectId(franchiseId),
          status: 'paid',
          paidAt: mongoose.trusted({ $gte: start, $lte: end }),
        },
      },
      { $lookup: { from: 'sales', localField: 'saleId', foreignField: '_id', as: 'sale' } },
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
      { $lookup: { from: 'sales', localField: 'saleId', foreignField: '_id', as: 'sale' } },
      { $unwind: '$sale' },
      { $match: { 'sale.cancelledAt': null } },
      { $project: { amount: 1, paidAmount: 1 } },
    ]),
  ]);

  const systemSalesTotal = roundMoney(sales.reduce((sum, sale) => sum + (sale.total ?? 0), 0));
  const systemItemsTotal = sales.reduce((sum, sale) => sum + sale.items.reduce((sub, item) => sub + item.quantity, 0), 0);
  const cashSalesTotal = roundMoney(
    sales.reduce((sum, sale) => {
      if (sale.paymentMethod !== 'cash') return sum;
      return sum + (sale.amountReceived ?? sale.total ?? 0);
    }, 0),
  );
  const installmentAdvancesTotal = roundMoney(
    sales.reduce((sum, sale) => {
      if (sale.paymentMethod !== 'installment') return sum;
      return sum + (sale.amountReceived ?? 0);
    }, 0),
  );
  const cashInstallmentsTotal = roundMoney(
    paidInstallments.reduce((sum, installment) => {
      if ((installment.paymentMethod ?? 'cash') !== 'cash') return sum;
      return sum + (installment.paidAmount || installment.amount || 0);
    }, 0),
  );
  const installmentPaidTotal = roundMoney(
    paidInstallments.reduce((sum, installment) => sum + (installment.paidAmount || installment.amount || 0), 0),
  );
  const installmentDueTotal = roundMoney(
    dueInstallments.reduce((sum, installment) => {
      const remaining = Math.max(0, (installment.amount ?? 0) - (installment.paidAmount ?? 0));
      return sum + remaining;
    }, 0),
  );
  const systemCashTotal = roundMoney(cashSalesTotal + installmentAdvancesTotal + cashInstallmentsTotal);
  const paymentBreakdown = sales.reduce<Record<string, { count: number; total: number }>>((acc, sale) => {
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
    installmentAdvancesTotal,
    cashInstallmentsTotal,
    installmentCashCount: paidInstallments.filter((installment) => (installment.paymentMethod ?? 'cash') === 'cash').length,
    installmentPaidTotal,
    installmentPaidCount: paidInstallments.length,
    installmentDueTotal,
    installmentDueCount: dueInstallments.length,
    paymentBreakdown,
  };
}

export async function autoCloseMissingDailyClosings(targetDate = new Date()) {
  const closingDate = toDateInput(targetDate);
  const { start } = dayBounds(closingDate);
  const submitter = await User.findOne({
    active: true,
    role: mongoose.trusted({ $in: ['superadmin', 'admin', 'manager', 'cash_central_maintainer'] }),
  }).select('_id');
  if (!submitter) {
    logger.warn({ closingDate }, 'Skipping automatic closing: no eligible submitter found');
    return { created: 0, skipped: 0 };
  }

  const franchises = await Franchise.find({ active: true }).select('_id name').lean();
  let created = 0;
  let skipped = 0;
  for (const franchise of franchises) {
    const exists = await Closing.exists({ franchiseId: franchise._id, closingDate: start });
    if (exists) {
      skipped += 1;
      continue;
    }

    const summary = await computeClosingSummary(franchise._id.toString(), closingDate);
    await Closing.create({
      franchiseId: franchise._id,
      closingDate: start,
      declaredSalesTotal: summary.systemCashTotal,
      declaredItemsTotal: summary.systemItemsTotal,
      systemSalesTotal: summary.systemSalesTotal,
      systemItemsTotal: summary.systemItemsTotal,
      systemCashTotal: summary.systemCashTotal,
      cashSalesTotal: summary.cashSalesTotal,
      cashInstallmentsTotal: summary.cashInstallmentsTotal,
      installmentAdvancesTotal: summary.installmentAdvancesTotal,
      installmentDueTotal: summary.installmentDueTotal,
      installmentDueCount: summary.installmentDueCount,
      installmentPaidTotal: summary.installmentPaidTotal,
      installmentPaidCount: summary.installmentPaidCount,
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
  closing.installmentAdvancesTotal = summary.installmentAdvancesTotal;
  closing.installmentDueTotal = summary.installmentDueTotal;
  closing.installmentDueCount = summary.installmentDueCount;
  closing.installmentPaidTotal = summary.installmentPaidTotal;
  closing.installmentPaidCount = summary.installmentPaidCount;
  if (closing.autoGenerated && !closing.validated) {
    closing.declaredSalesTotal = summary.systemCashTotal;
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
