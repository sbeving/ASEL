import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ROLES } from '../utils/roles.js';

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true, minlength: 3, maxlength: 50 },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    role: { type: String, enum: ROLES, required: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    /**
     * Count of consecutive failed login attempts. Reset to 0 on a successful
     * login and on `lockedUntil` expiry.
     */
    failedLoginAttempts: { type: Number, default: 0, select: false },
    /**
     * When non-null and in the future, login is refused for this account
     * regardless of password validity. Cleared on successful login or by an
     * admin setting a new password.
     */
    lockedUntil: { type: Date, default: null, select: false },
    /**
     * Bumped on password change, admin deactivation, or admin force-logout.
     * JWTs embed the issuing `tokenVersion`; the `/auth/me` probe compares
     * it and invalidates sessions whose `tv` is stale. Revocation SLA =
     * however often the client calls `/auth/me` (typically on page load
     * and focus). Per-route lookups would be stricter but require a cache
     * to avoid per-request DB hits; pragmatic trade-off for this app.
     */
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ franchiseId: 1 });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User = model('User', userSchema);
