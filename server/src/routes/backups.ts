import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { audit } from '../services/audit.service.js';
import { createOperationalBackup, listBackups } from '../services/backup.service.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const backups = await listBackups();
    res.json({
      backups: backups.map((backup) => ({
        name: backup.name,
        size: backup.size,
        createdAt: backup.mtime,
      })),
    });
  }),
);

router.post(
  '/run',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const result = await createOperationalBackup();
    await audit(req, {
      action: 'backup.manual_run',
      entity: 'Backup',
      entityId: result.skipped ? undefined : result.filename,
      details: result,
    });
    res.status(result.skipped ? 202 : 201).json({ backup: result });
  }),
);

export default router;
