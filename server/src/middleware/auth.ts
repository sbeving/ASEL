import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../utils/AppError.js';
import type { Role } from '../utils/roles.js';

export const AUTH_COOKIE = 'asel_session';

export interface JwtPayload {
  sub: string;
  role: Role;
  franchiseId: string | null;
  username: string;
  /** User.tokenVersion at issue time; see User model for revocation notes. */
  tv: number;
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

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return next(unauthorized());
  try {
    req.user = verifySession(token);
    next();
  } catch {
    next(unauthorized('Invalid or expired session'));
  }
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
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
  if (user.role === 'admin' || user.role === 'manager') return {};
  if (!user.franchiseId) return { _neverMatch: true };
  return { [field]: user.franchiseId };
}
