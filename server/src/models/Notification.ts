import { Schema, model, type InferSchemaType } from 'mongoose';
import type { Role } from '../utils/roles.js';

const roleTargets = [
  'admin',
  'superadmin',
  'manager',
  'franchise',
  'seller',
  'vendeur',
  'viewer',
  'all',
] as const satisfies readonly (Role | 'all')[];

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null, index: true },
    roleTarget: { type: String, enum: roleTargets, default: null, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, trim: true, maxlength: 3000, default: '' },
    type: { type: String, enum: ['info', 'warning', 'danger', 'success'], default: 'info' },
    link: { type: String, trim: true, maxlength: 300, default: '' },
    readAt: { type: Date, default: null, index: true },
    dedupeKey: { type: String, trim: true, maxlength: 180, default: null, index: true },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'notifications' },
);

notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ roleTarget: 1, createdAt: -1 });
notificationSchema.index({ franchiseId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

export type NotificationDoc = InferSchemaType<typeof notificationSchema>;
export const Notification = model('Notification', notificationSchema);
