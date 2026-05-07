import type { Request } from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../utils/logger.js';

interface AuditInput {
  action: string;
  entity?: string;
  entityId?: string;
  details?: unknown;
  franchiseId?: string | null;
}

const IGNORED_ACTIONS = new Set(['installment.notifications.refresh']);

function sanitizeDetails(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeDetails);

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (/password|token|secret|cookie|authorization/i.test(key)) {
      output[key] = '[redacted]';
    } else {
      output[key] = sanitizeDetails(nestedValue);
    }
  }
  return output;
}

export async function audit(req: Request, input: AuditInput): Promise<void> {
  if (IGNORED_ACTIONS.has(input.action)) return;

  try {
    await AuditLog.create({
      userId: req.user?.sub ?? null,
      username: req.user?.username ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      franchiseId: input.franchiseId ?? req.user?.franchiseId ?? null,
      details: sanitizeDetails({
        ...(input.details && typeof input.details === 'object' && !Array.isArray(input.details)
          ? (input.details as Record<string, unknown>)
          : { value: input.details }),
        actor: req.user
          ? {
              id: req.user.sub,
              username: req.user.username,
              role: req.user.role,
              franchiseId: req.user.franchiseId,
            }
          : null,
        request: {
          method: req.method,
          path: req.originalUrl || req.url,
        },
      }),
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 255),
    });
  } catch (err) {
    // Never let audit failures break user actions
    logger.warn({ err }, 'Audit log write failed');
  }
}

export async function auditSystem(input: AuditInput & { username?: string | null }): Promise<void> {
  if (IGNORED_ACTIONS.has(input.action)) return;

  try {
    await AuditLog.create({
      userId: null,
      username: input.username ?? 'system',
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      franchiseId: input.franchiseId ?? null,
      details: sanitizeDetails(input.details),
      ip: 'system',
      userAgent: 'system',
    });
  } catch (err) {
    logger.warn({ err }, 'System audit log write failed');
  }
}
