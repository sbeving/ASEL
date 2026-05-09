import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { uploadRoot } from '../config/uploads.js';
import { notFound, forbidden } from '../utils/AppError.js';
import { CashFlow } from '../models/CashFlow.js';
import { Installment } from '../models/Installment.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';
import { CommercialZone } from '../models/CommercialZone.js';
import { NetworkPoint } from '../models/NetworkPoint.js';
import { Reception } from '../models/Reception.js';
import { isPermissionGranted, type Permission } from '../utils/permissions.js';
import { isGlobalRole } from '../utils/roles.js';

const router = Router();

const paramsSchema = z.object({
  bucket: z.enum(['product-images', 'user-avatars', 'treasury-docs', 'treasury-receipts', 'installment-receipts', 'reception-ocr', 'network-point-docs']),
  filename: z.string().min(1).max(220).regex(/^[a-zA-Z0-9._-]+$/),
});

function hasPermission(req: Express.Request, permission: Permission) {
  const user = req.user;
  return Boolean(user && isPermissionGranted(user.role, permission, user.customPermissions));
}

async function canAccessCommercialZone(userId: string, zoneId?: unknown) {
  if (!zoneId) return false;
  return Boolean(
    await CommercialZone.exists({
      _id: zoneId,
      active: true,
      assignedCommercialIds: userId,
    }),
  );
}

async function assertSensitiveUploadAccess(req: Express.Request, bucket: string, uploadPath: string) {
  const user = req.user;
  if (!user) throw forbidden();

  if (bucket === 'product-images') {
    if (!hasPermission(req, 'products.view')) throw forbidden();
    const product = await Product.findOne({ imagePath: uploadPath }).select('_id active').lean();
    if (!product) throw notFound('File not found');
    return;
  }

  if (bucket === 'user-avatars') {
    const owner = await User.findOne({ avatarPath: uploadPath }).select('_id franchiseId').lean();
    if (!owner) throw notFound('File not found');
    if (owner._id.toString() === user.sub) return;
    if (hasPermission(req, 'users.manage')) return;
    throw forbidden();
  }

  if (bucket === 'treasury-docs' || bucket === 'treasury-receipts') {
    if (!hasPermission(req, 'cashflows.view')) throw forbidden();
    const pathField = bucket === 'treasury-docs' ? 'attachmentPath' : 'receiptPath';
    const flow = await CashFlow.findOne({ [pathField]: uploadPath })
      .select('franchiseId isCentralCashbox')
      .lean();
    if (!flow) throw notFound('File not found');
    if (isGlobalRole(user.role)) return;
    if (!flow.isCentralCashbox && user.franchiseId && flow.franchiseId?.toString() === user.franchiseId) return;
    throw forbidden();
  }

  if (bucket === 'installment-receipts') {
    if (!hasPermission(req, 'installments.view')) throw forbidden();
    const installment = await Installment.findOne({ receiptPath: uploadPath }).select('franchiseId').lean();
    if (!installment) throw notFound('File not found');
    if (isGlobalRole(user.role)) return;
    if (user.franchiseId && installment.franchiseId?.toString() === user.franchiseId) return;
    throw forbidden();
  }

  if (bucket === 'reception-ocr') {
    if (!hasPermission(req, 'receptions.view')) throw forbidden();
    const reception = await Reception.findOne({ sourceDocumentPath: uploadPath }).select('franchiseId').lean();
    if (!reception) throw notFound('File not found');
    if (isGlobalRole(user.role)) return;
    if (user.franchiseId && reception.franchiseId?.toString() === user.franchiseId) return;
    throw forbidden();
  }

  if (bucket === 'network-point-docs') {
    if (!hasPermission(req, 'map.view')) throw forbidden();
    const point = await NetworkPoint.findOne({
      $or: [
        { 'documents.cinImagePath': uploadPath },
        { 'documents.shopImagePath': uploadPath },
        { 'documents.signaturePath': uploadPath },
        { 'documents.infoSheetPdfPath': uploadPath },
      ],
    })
      .select('franchiseId commercialId zoneId')
      .lean();
    if (!point) throw notFound('File not found');
    if (isGlobalRole(user.role)) return;
    if (user.role === 'commercial' && point.commercialId?.toString() === user.sub) return;
    if (user.role === 'commercial' && await canAccessCommercialZone(user.sub, point.zoneId)) return;
    if (user.franchiseId && point.franchiseId?.toString() === user.franchiseId) return;
    throw forbidden();
  }
}

router.get(
  '/:bucket/:filename',
  requireAuth,
  validate(paramsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { bucket, filename } = req.params as z.infer<typeof paramsSchema>;
    const absolutePath = path.resolve(uploadRoot, bucket, filename);
    const expectedPrefix = path.resolve(uploadRoot, bucket) + path.sep;
    if (!absolutePath.startsWith(expectedPrefix)) throw forbidden();
    await assertSensitiveUploadAccess(req, bucket, `${bucket}/${filename}`);

    try {
      await fs.access(absolutePath);
    } catch {
      throw notFound('File not found');
    }

    res.sendFile(absolutePath);
  }),
);

export default router;
