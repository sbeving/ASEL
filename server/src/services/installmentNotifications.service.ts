import mongoose from 'mongoose';
import { Installment } from '../models/Installment.js';
import { createNotification } from './notification.service.js';
import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function money(value: number): string {
  return `${value.toFixed(2)} TND`;
}

function displayName(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const row = value as Record<string, unknown>;
  return typeof row.fullName === 'string'
    ? row.fullName
    : typeof row.name === 'string'
      ? row.name
      : '';
}

function saleLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const row = value as Record<string, unknown>;
  return typeof row.invoiceNumber === 'string' && row.invoiceNumber
    ? row.invoiceNumber
    : row._id?.toString?.() ?? '';
}

function isActiveLinkedSale(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return !(value as { cancelledAt?: unknown }).cancelledAt;
}

function activeSaleInstallments<T extends { saleId?: unknown }>(rows: T[]): T[] {
  return rows.filter((row) => isActiveLinkedSale(row.saleId));
}

export async function refreshInstallmentNotifications(now = new Date()) {
  const today = startOfDay(now);
  const in3Days = addDays(today, 3);
  const in7Days = addDays(today, 7);

  const lateUpdate = await Installment.updateMany(
    { status: 'pending', dueDate: mongoose.trusted({ $lt: now }) },
    { $set: { status: 'late' } },
  );

  const [overdue, dueWithin3Days, dueWithin7Days] = await Promise.all([
    Installment.find({
      status: 'late',
      dueDate: mongoose.trusted({ $lt: now }),
    })
      .sort({ dueDate: 1 })
      .limit(250)
      .populate('saleId', 'invoiceNumber total createdAt cancelledAt')
      .populate('clientId', 'fullName phone phone2')
      .populate('franchiseId', 'name')
      .lean(),
    Installment.find({
      status: 'pending',
      remind3dSent: mongoose.trusted({ $ne: true }),
      dueDate: mongoose.trusted({ $gte: today, $lte: in3Days }),
    })
      .sort({ dueDate: 1 })
      .limit(250)
      .populate('saleId', 'invoiceNumber total createdAt cancelledAt')
      .populate('clientId', 'fullName phone phone2')
      .populate('franchiseId', 'name')
      .lean(),
    Installment.find({
      status: 'pending',
      remind7dSent: mongoose.trusted({ $ne: true }),
      dueDate: mongoose.trusted({ $gt: in3Days, $lte: in7Days }),
    })
      .sort({ dueDate: 1 })
      .limit(250)
      .populate('saleId', 'invoiceNumber total createdAt cancelledAt')
      .populate('clientId', 'fullName phone phone2')
      .populate('franchiseId', 'name')
      .lean(),
  ]);

  let created = 0;
  const todayKey = dateKey(now);
  const activeOverdue = activeSaleInstallments(overdue);
  const activeDueWithin3Days = activeSaleInstallments(dueWithin3Days);
  const activeDueWithin7Days = activeSaleInstallments(dueWithin7Days);

  for (const installment of activeOverdue) {
    const dueDate = installment.dueDate instanceof Date ? installment.dueDate : new Date(installment.dueDate);
    const daysLate = Math.max(1, Math.floor((today.getTime() - startOfDay(dueDate).getTime()) / DAY_MS));
    const clientName = displayName(installment.clientId) || 'Client non renseigne';
    const invoice = saleLabel(installment.saleId);

    const notification = await createNotification({
      title: `Echeance en retard: ${clientName}`,
      message: [
        `${money(Number(installment.amount ?? 0))} en retard depuis ${dateKey(dueDate)} (${daysLate} jour(s)).`,
        invoice ? `Vente: ${invoice}.` : '',
        `Franchise: ${displayName(installment.franchiseId) || 'non renseignee'}.`,
      ].filter(Boolean).join(' '),
      type: 'danger',
      link: '/installments?status=late',
      franchiseId: installment.franchiseId?._id ?? installment.franchiseId ?? null,
      roleTarget: 'all',
      dedupeKey: `installment-overdue:${installment._id.toString()}:${todayKey}`,
      dedupeWindowMinutes: 24 * 60,
      metadata: {
        installmentId: installment._id.toString(),
        saleId: installment.saleId?._id?.toString?.() ?? installment.saleId?.toString?.() ?? null,
        clientId: installment.clientId?._id?.toString?.() ?? installment.clientId?.toString?.() ?? null,
        amount: installment.amount,
        dueDate,
        daysLate,
        status: 'late',
      },
    });
    if (notification) created += 1;
  }

  for (const installment of activeDueWithin3Days) {
    const dueDate = installment.dueDate instanceof Date ? installment.dueDate : new Date(installment.dueDate);
    const clientName = displayName(installment.clientId) || 'Client non renseigne';
    await createNotification({
      title: `Echeance proche: ${clientName}`,
      message: `${money(Number(installment.amount ?? 0))} a encaisser avant le ${dateKey(dueDate)}.`,
      type: 'warning',
      link: '/installments?status=pending',
      franchiseId: installment.franchiseId?._id ?? installment.franchiseId ?? null,
      roleTarget: 'all',
      dedupeKey: `installment-due-3d:${installment._id.toString()}`,
      dedupeWindowMinutes: 7 * 24 * 60,
      metadata: { installmentId: installment._id.toString(), amount: installment.amount, dueDate, reminder: '3d' },
    });
    await Installment.updateOne({ _id: installment._id }, { $set: { remind3dSent: true } });
    created += 1;
  }

  for (const installment of activeDueWithin7Days) {
    const dueDate = installment.dueDate instanceof Date ? installment.dueDate : new Date(installment.dueDate);
    const clientName = displayName(installment.clientId) || 'Client non renseigne';
    await createNotification({
      title: `Echeance a venir: ${clientName}`,
      message: `${money(Number(installment.amount ?? 0))} prevu le ${dateKey(dueDate)}.`,
      type: 'info',
      link: '/installments?status=pending',
      franchiseId: installment.franchiseId?._id ?? installment.franchiseId ?? null,
      roleTarget: 'all',
      dedupeKey: `installment-due-7d:${installment._id.toString()}`,
      dedupeWindowMinutes: 7 * 24 * 60,
      metadata: { installmentId: installment._id.toString(), amount: installment.amount, dueDate, reminder: '7d' },
    });
    await Installment.updateOne({ _id: installment._id }, { $set: { remind7dSent: true } });
    created += 1;
  }

  return {
    lateStatusUpdated: lateUpdate.modifiedCount,
    overdueChecked: activeOverdue.length,
    dueSoon3dChecked: activeDueWithin3Days.length,
    dueSoon7dChecked: activeDueWithin7Days.length,
    notificationsTouched: created,
  };
}

export function scheduleInstallmentNotificationRefresh() {
  void refreshInstallmentNotifications().catch((err) => logger.warn({ err }, 'Initial installment notification refresh failed'));
  const timer = setInterval(() => {
    void refreshInstallmentNotifications().catch((err) => logger.warn({ err }, 'Scheduled installment notification refresh failed'));
  }, 60 * 60 * 1000);
  timer.unref?.();
}
