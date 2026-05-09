import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { env } from '../config/env.js';
import { notFound } from '../utils/AppError.js';
import type { Role } from '../utils/roles.js';

const router = Router();

export const MOBILE_APP_ROLES: Role[] = [
  'ceo',
  'admin',
  'superadmin',
  'manager',
  'commercial_director',
  'hr_admin',
  'commercial',
  'siege_employee',
];

function mobileApkPath() {
  return path.isAbsolute(env.MOBILE_APK_PATH)
    ? env.MOBILE_APK_PATH
    : path.resolve(process.cwd(), env.MOBILE_APK_PATH);
}

async function apkStat() {
  const filePath = mobileApkPath();
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return { filePath, stat };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

router.get(
  '/manifest',
  requireAuth,
  requireRole(...MOBILE_APP_ROLES),
  asyncHandler(async (_req, res) => {
    const apk = await apkStat();
    res.json({
      app: {
        name: 'ASEL Pointage',
        platform: 'android',
        filename: 'asel-pointage.apk',
        version: env.MOBILE_APK_VERSION,
        apiBaseUrl: env.MOBILE_APP_API_BASE_URL ?? null,
        targetRoles: MOBILE_APP_ROLES,
        available: Boolean(apk),
        sizeBytes: apk?.stat.size ?? 0,
        updatedAt: apk?.stat.mtime.toISOString() ?? null,
        downloadUrl: '/api/mobile-app/download',
      },
    });
  }),
);

router.get(
  '/download',
  requireAuth,
  requireRole(...MOBILE_APP_ROLES),
  asyncHandler(async (_req, res) => {
    const apk = await apkStat();
    if (!apk) throw notFound('APK mobile indisponible. Generez le build Android puis redeployez.');
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="asel-pointage.apk"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(apk.filePath);
  }),
);

export default router;
