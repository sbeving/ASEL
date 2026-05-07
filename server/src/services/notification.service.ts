import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';
import { ROLES, type Role } from '../utils/roles.js';

type NotificationType = 'info' | 'warning' | 'danger' | 'success';

interface CreateNotificationInput {
  title: string;
  message?: string;
  type?: NotificationType;
  link?: string;
  userId?: string | mongoose.Types.ObjectId | null;
  franchiseId?: string | mongoose.Types.ObjectId | null;
  roleTarget?: Role | 'all' | null;
  roleTargets?: Array<Role | 'all'> | null;
  dedupeKey?: string | null;
  dedupeWindowMinutes?: number;
  metadata?: unknown;
  session?: mongoose.ClientSession;
}

export const NOTIFICATION_TARGETS = {
  leadership: ['ceo', 'admin', 'superadmin', 'manager'] as Role[],
  stock: ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer', 'franchise'] as Role[],
  finance: ['ceo', 'admin', 'superadmin', 'manager', 'cash_central_maintainer', 'franchise'] as Role[],
  transfers: ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer', 'franchise'] as Role[],
  demands: ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer'] as Role[],
  hr: ['ceo', 'admin', 'superadmin', 'manager', 'hr_admin'] as Role[],
  commercial: ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'commercial'] as Role[],
  everyone: [...ROLES] as Role[],
} as const;

function uniqueRoles(values: Array<Role | 'all' | null | undefined>): Role[] {
  const expanded = values.flatMap((value) => (value === 'all' ? NOTIFICATION_TARGETS.everyone : value ? [value] : []));
  return [...new Set(expanded.filter((value): value is Role => ROLES.includes(value as Role)))];
}

function metadataKind(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return '';
  const kind = (metadata as Record<string, unknown>).kind;
  return typeof kind === 'string' ? kind : '';
}

export function inferNotificationRoleTargets(input: {
  title?: string | null;
  roleTarget?: Role | 'all' | null;
  roleTargets?: Array<Role | 'all'> | null;
  link?: string | null;
  metadata?: unknown;
  userId?: unknown;
}) {
  if (input.roleTargets?.length) return uniqueRoles(input.roleTargets);
  if (input.roleTarget && input.roleTarget !== 'all') return uniqueRoles([input.roleTarget]);

  const link = input.link ?? '';
  const kind = metadataKind(input.metadata);
  const title = input.title ?? '';
  const titleLower = title.toLowerCase();
  if (
    kind.includes('low_stock') ||
    link.startsWith('/stock') ||
    titleLower.includes('stock') ||
    title.charCodeAt(0) === 0x26a0
  ) return NOTIFICATION_TARGETS.stock;
  if (kind.includes('installment') || link.startsWith('/installments')) return NOTIFICATION_TARGETS.finance;
  if (kind.includes('cashflow') || link.startsWith('/cashflows') || link.startsWith('/closings')) return NOTIFICATION_TARGETS.finance;
  if (kind.includes('transfer') || link.startsWith('/transfers')) return NOTIFICATION_TARGETS.transfers;
  if (kind.includes('demand') || link.startsWith('/demands')) return NOTIFICATION_TARGETS.demands;
  if (kind.includes('leave') || link.startsWith('/hr') || link.startsWith('/timelogs')) return NOTIFICATION_TARGETS.hr;
  if (kind.includes('network') || kind.includes('map') || link.startsWith('/map')) return NOTIFICATION_TARGETS.commercial;
  if (input.userId) return [];
  return NOTIFICATION_TARGETS.leadership;
}

export async function normalizeNotificationRoleTargets(limit = 500) {
  const rawRows = await Notification.collection.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  const targetIds = rawRows
    .filter((row) => {
      const targets = Array.isArray(row.roleTargets) ? row.roleTargets : [];
      const isLegacyStockWarning =
        typeof row.title === 'string' &&
        row.title.charCodeAt(0) === 0x26a0 &&
        (!targets.includes('stock_central_maintainer') || !targets.includes('franchise'));
      return targets.length === 0 || isLegacyStockWarning;
    })
    .map((row) => row._id);
  const legacyRows = targetIds.length > 0
    ? await Notification.find({ _id: mongoose.trusted({ $in: targetIds }) })
    : [];

  let updated = 0;
  for (const notification of legacyRows) {
    const targets = inferNotificationRoleTargets({
      title: notification.title,
      roleTarget: notification.roleTarget as Role | 'all' | null | undefined,
      link: notification.link,
      metadata: notification.metadata,
      userId: notification.userId,
    });
    if (targets.length === 0) continue;
    notification.roleTargets = targets as any;
    await notification.save();
    updated += 1;
  }
  return updated;
}

export async function createNotification(input: CreateNotificationInput) {
  const {
    title,
    message = '',
    type = 'info',
    link = '',
    userId = null,
    franchiseId = null,
    roleTarget = null,
    roleTargets = null,
    dedupeKey = null,
    dedupeWindowMinutes = 180,
    metadata = null,
    session,
  } = input;
  const resolvedRoleTargets = inferNotificationRoleTargets({
    title,
    roleTarget,
    roleTargets,
    link,
    metadata,
    userId,
  });

  if (dedupeKey) {
    const since = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000);
    const existing = await Notification.findOne({
      dedupeKey,
      readAt: null,
      createdAt: mongoose.trusted({ $gte: since }),
    }).session(session ?? null);
    if (existing) return existing;
  }

  const [notification] = await Notification.create(
    [
      {
        title,
        message,
        type,
        link,
        userId,
        franchiseId,
        roleTarget: roleTarget === 'all' ? null : roleTarget,
        roleTargets: resolvedRoleTargets,
        dedupeKey,
        metadata,
      },
    ],
    session ? { session } : undefined,
  );

  return notification;
}
