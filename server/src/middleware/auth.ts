import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../utils/AppError.js';
import { isGlobalRole, type Role } from '../utils/roles.js';
import { User } from '../models/User.js';
import {
  isPermissionGranted,
  normalizeCustomPermissionOverrides,
  type CustomPermissionOverrides,
  type Permission,
} from '../utils/permissions.js';

export const AUTH_COOKIE = 'asel_session';

export interface JwtPayload {
  sub: string;
  role: Role;
  franchiseId: string | null;
  username: string;
  sessionVersion?: number;
  customPermissions?: CustomPermissionOverrides;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function signSession(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES as jwt.SignOptions['expiresIn'],
  });
}

export function verifySession(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return next(unauthorized());
  try {
    const payload = verifySession(token);
    const user = await User.findById(payload.sub)
      .select('username role franchiseId active sessionVersion customPermissions')
      .lean();
    if (!user || !user.active) return next(unauthorized('Session invalid'));

    const tokenVersion = payload.sessionVersion ?? 0;
    const currentSessionVersion = user.sessionVersion ?? 0;
    if (tokenVersion !== currentSessionVersion) {
      return next(unauthorized('Session expired. Please login again.'));
    }

    req.user = {
      sub: user._id.toString(),
      role: user.role,
      franchiseId: user.franchiseId ? user.franchiseId.toString() : null,
      username: user.username,
      sessionVersion: currentSessionVersion,
      customPermissions: normalizeCustomPermissionOverrides(user.customPermissions),
    };
    next();
  } catch {
    next(unauthorized('Invalid or expired session'));
  }
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role === 'superadmin') return next();
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    const allowed = permissions.some((permission) =>
      isPermissionGranted(req.user!.role, permission, req.user!.customPermissions),
    );
    if (!allowed) return next(forbidden());
    next();
  };
}

/**
 * Returns a Mongo filter that, for franchise-scoped users, restricts a
 * query to their own franchise. Admins and managers get an empty filter
 * (global view). The filter uses the provided field name (default
 * `franchiseId`).
 */
export function franchiseScopeFilter(
  user: JwtPayload | undefined,
  field = 'franchiseId',
): Record<string, unknown> {
  if (!user) return { _neverMatch: true };
  if (isGlobalRole(user.role)) return {};
  if (!user.franchiseId) return { _neverMatch: true };
  return { [field]: user.franchiseId };
}
