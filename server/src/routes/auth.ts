import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AUTH_COOKIE, requireAuth, signSession } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authLimiter, sensitiveWriteLimiter } from '../middleware/rateLimit.js';
import { User } from '../models/User.js';
import { unauthorized, badRequest } from '../utils/AppError.js';
import { audit } from '../services/audit.service.js';
import type { Role } from '../utils/roles.js';
import { normalizeCustomPermissionOverrides } from '../utils/permissions.js';

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

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as z.infer<typeof loginSchema>;

    const user = await User.findOne({ username }).select('+passwordHash');
    if (!user || !user.active) {
      // Timing-attack mitigation: still perform a bcrypt comparison on a dummy hash
      await bcrypt.compare(password, '$2a$12$CwTycUXWue0Thq9StjUM0uJ8.HVaA1lR5y/9eTBcvC.dS8xc3w1cm');
      throw unauthorized('Invalid credentials');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw unauthorized('Invalid credentials');

    user.lastLoginAt = new Date();
    await user.save();

    const token = signSession({
      sub: user._id.toString(),
      role: user.role as Role,
      franchiseId: user.franchiseId ? user.franchiseId.toString() : null,
      username: user.username,
      sessionVersion: user.sessionVersion ?? 0,
      customPermissions: normalizeCustomPermissionOverrides(user.customPermissions),
    });

    res.cookie(AUTH_COOKIE, token, cookieOptions);

    await audit(req, { action: 'auth.login', entity: 'User', entityId: user._id.toString() });

    res.json({
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        franchiseId: user.franchiseId,
        avatarPath: user.avatarPath,
        customPermissions: normalizeCustomPermissionOverrides(user.customPermissions),
      },
    });
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
    res.json({
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        franchiseId: user.franchiseId,
        avatarPath: user.avatarPath,
        customPermissions: normalizeCustomPermissionOverrides(user.customPermissions),
      },
    });
  }),
);

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(200),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must differ from current password',
    path: ['newPassword'],
  });

router.post(
  '/change-password',
  requireAuth,
  sensitiveWriteLimiter,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await User.findById(req.user!.sub).select('+passwordHash');
    if (!user) throw unauthorized();
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw badRequest('Current password is incorrect');
    user.passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    await user.save();
    await audit(req, { action: 'auth.change_password' });
    res.json({ ok: true });
  }),
);

export default router;
