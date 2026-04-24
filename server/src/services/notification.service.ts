import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';
import type { Role } from '../utils/roles.js';

type NotificationType = 'info' | 'warning' | 'danger' | 'success';

interface CreateNotificationInput {
  title: string;
  message?: string;
  type?: NotificationType;
  link?: string;
  userId?: string | mongoose.Types.ObjectId | null;
  franchiseId?: string | mongoose.Types.ObjectId | null;
  roleTarget?: Role | 'all' | null;
  dedupeKey?: string | null;
  dedupeWindowMinutes?: number;
  metadata?: unknown;
  session?: mongoose.ClientSession;
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
    dedupeKey = null,
    dedupeWindowMinutes = 180,
    metadata = null,
    session,
  } = input;

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
        roleTarget,
        dedupeKey,
        metadata,
      },
    ],
    session ? { session } : undefined,
  );

  return notification;
}
