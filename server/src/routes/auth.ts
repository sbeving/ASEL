import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AUTH_COOKIE, requireAuth, signSession } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { User } from '../models/User.js';
import { unauthorized, badRequest, AppError } from '../utils/AppError.js';
import { audit } from '../services/audit.service.js';
import { passwordSchema } from '../utils/passwordPolicy.js';
import {
  isLocked,
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  recordFailedLogin,
  resetLoginState,
} from '../services/auth.service.js';
import type { Role } from '../utils/roles.js';

const router = Router();

const cookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict' as const,
  path: '/',
  domain: env.COOKIE_DOMAIN || undefined,
  maxAge: 12 * 60 * 60 * 1000,
};

const loginSchema = z.object({
  username: z.string().min(3).max(50).trim().toLowerCase(),
  password: z.string().min(1).max(200),
});

function publicUser(user: {
  _id: { toString(): string };
  username: string;
  fullName: string;
  role: string;
  franchiseId?: { toString(): string } | null;
}) {
  return {
    id: user._id.toString(),
    username: user.username,
    fullName: user.fullName,
    role: user.role as Role,
    franchiseId: user.franchiseId ? user.franchiseId.toString() : null,
  };
}

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as z.infer<typeof loginSchema>;

    const user = await User.findOne({ username }).select(
      '+passwordHash +failedLoginAttempts +lockedUntil',
    );
    if (!user || !user.active) {
      // Timing-attack mitigation: still do a bcrypt compare on a dummy hash
      // so response time is independent of whether the username exists.
      await bcrypt.compare(password, '$2a$12$CwTycUXWue0Thq9StjUM0uJ8.HVaA1lR5y/9eTBcvC.dS8xc3w1cm');
      throw unauthorized('Invalid credentials');
    }

    if (isLocked(user)) {
      const minutes = Math.ceil((user.lockedUntil!.getTime() - Date.now()) / 60_000);
      throw new AppError(
        423,
        'ACCOUNT_LOCKED',
        `Compte verrouillé, réessayez dans ${minutes} minute(s).`,
      );
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const updated = await recordFailedLogin(user._id);
      // Audit the failed attempt (with minimal PII) for security review.
      await audit(req, {
        action: 'auth.login_failed',
        entity: 'User',
        entityId: user._id.toString(),
        details: { attempts: updated?.failedLoginAttempts },
      });
      if (updated && isLocked(updated)) {
        throw new AppError(
          423,
          'ACCOUNT_LOCKED',
          `Trop de tentatives. Compte verrouillé pour ${LOCKOUT_MINUTES} minutes.`,
        );
      }
      throw unauthorized('Invalid credentials');
    }

    await resetLoginState(user._id);

    const token = signSession({
      sub: user._id.toString(),
      role: user.role as Role,
      franchiseId: user.franchiseId ? user.franchiseId.toString() : null,
      username: user.username,
    });
    res.cookie(AUTH_COOKIE, token, cookieOptions);

    await audit(req, { action: 'auth.login', entity: 'User', entityId: user._id.toString() });

    res.json({ user: publicUser(user) });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    res.clearCookie(AUTH_COOKIE, { ...cookieOptions, maxAge: undefined });
    if (req.cookies?.[AUTH_COOKIE]) {
      await audit(req, { action: 'auth.logout' });
    }
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.sub);
    if (!user || !user.active) throw unauthorized('Session invalid');
    res.json({ user: publicUser(user) });
  }),
);

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must differ from current password',
    path: ['newPassword'],
  });

router.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await User.findById(req.user!.sub).select('+passwordHash');
    if (!user) throw unauthorized();
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw badRequest('Current password is incorrect');
    user.passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
    await user.save();
    // Any lockout state becomes moot once the password is changed.
    await resetLoginState(user._id);
    await audit(req, { action: 'auth.change_password' });
    res.json({ ok: true });
  }),
);

export { MAX_FAILED_ATTEMPTS };
export default router;
