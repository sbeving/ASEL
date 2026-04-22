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

export async function audit(req: Request, input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      userId: req.user?.sub ?? null,
      username: req.user?.username ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      franchiseId: input.franchiseId ?? req.user?.franchiseId ?? null,
      details: input.details,
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 255),
    });
  } catch (err) {
    // Never let audit failures break user actions
    logger.warn({ err }, 'Audit log write failed');
  }
}
