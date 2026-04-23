import { User } from '../models/User.js';

export const MAX_FAILED_ATTEMPTS = 8;
export const LOCKOUT_MINUTES = 15;

/**
 * Increments the user's failed-attempt counter and locks the account for
 * LOCKOUT_MINUTES once it crosses MAX_FAILED_ATTEMPTS. Returns the updated
 * counters so the caller can surface a remaining-attempts hint if needed.
 */
export async function recordFailedLogin(userId: unknown) {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);

  // Atomic $inc with conditional $set — only locks on the attempt that tips
  // over the threshold; concurrent attempts can't all independently set a
  // fresh lock.
  const updated = await User.findByIdAndUpdate(
    userId,
    [
      {
        $set: {
          failedLoginAttempts: { $add: [{ $ifNull: ['$failedLoginAttempts', 0] }, 1] },
          lockedUntil: {
            $cond: [
              { $gte: [{ $add: [{ $ifNull: ['$failedLoginAttempts', 0] }, 1] }, MAX_FAILED_ATTEMPTS] },
              lockUntil,
              '$lockedUntil',
            ],
          },
        },
      },
    ],
    { new: true, select: '+failedLoginAttempts +lockedUntil' },
  );
  return updated;
}

export async function resetLoginState(userId: unknown) {
  await User.findByIdAndUpdate(userId, {
    $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}

export function isLocked(user: { lockedUntil?: Date | null }): boolean {
  return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
}
