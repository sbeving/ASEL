import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Transfer } from '../models/Transfer.js';
import { Franchise } from '../models/Franchise.js';
import { Product } from '../models/Product.js';
import { applyStockDelta } from '../services/stock.service.js';
import { audit } from '../services/audit.service.js';
import { createNotification } from '../services/notification.service.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const createSchema = z.object({
  sourceFranchiseId: objectId,
  destFranchiseId: objectId,
  productId: objectId,
  quantity: z.number().int().positive(),
  note: z.string().max(500).optional(),
});

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    if (body.sourceFranchiseId === body.destFranchiseId) {
      throw badRequest('Source and destination must differ');
    }

    // Franchise users can only request transfers where they are source OR dest
    const user = req.user!;
    if (user.role === 'franchise') {
      if (user.franchiseId !== body.sourceFranchiseId && user.franchiseId !== body.destFranchiseId) {
        throw forbidden('You can only request transfers involving your franchise');
      }
    }

    const [src, dst] = await Promise.all([
      Franchise.exists({ _id: body.sourceFranchiseId }),
      Franchise.exists({ _id: body.destFranchiseId }),
    ]);
    if (!src || !dst) throw badRequest('Franchise not found');

    const transfer = await Transfer.create({
      ...body,
      requestedBy: user.sub,
      status: 'pending',
    });

    const [sourceFranchise, destFranchise, product] = await Promise.all([
      Franchise.findById(body.sourceFranchiseId).select('name'),
      Franchise.findById(body.destFranchiseId).select('name'),
      Product.findById(body.productId).select('name'),
    ]);
    await createNotification({
      franchiseId: body.destFranchiseId,
      title: 'Transfert en attente',
      message: `${sourceFranchise?.name ?? 'Source'} -> ${destFranchise?.name ?? 'Destination'}: ${body.quantity} x ${product?.name ?? 'Produit'}`,
      type: 'info',
      link: '/transfers',
      dedupeKey: `transfer-pending:${transfer._id.toString()}`,
      metadata: {
        kind: 'transfer_pending',
        transferId: transfer._id.toString(),
      },
    });

    await audit(req, {
      action: 'transfer.create',
      entity: 'Transfer',
      entityId: transfer._id.toString(),
      details: { ...body },
    });
    res.status(201).json({ transfer });
  }),
);

const listQuery = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'cancelled']).optional(),
  franchiseId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get(
  '/',
  requireAuth,
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { status, franchiseId, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const user = req.user!;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    // Franchise-scoped users only see transfers involving their franchise
    if (user.role === 'franchise' || user.role === 'seller') {
      if (!user.franchiseId) throw forbidden();
      filter.$or = [
        { sourceFranchiseId: user.franchiseId },
        { destFranchiseId: user.franchiseId },
      ];
    } else if (franchiseId) {
      filter.$or = [{ sourceFranchiseId: franchiseId }, { destFranchiseId: franchiseId }];
    }

    const transfers = await Transfer.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('productId', 'name reference')
      .populate('sourceFranchiseId', 'name')
      .populate('destFranchiseId', 'name')
      .populate('requestedBy', 'username fullName')
      .populate('resolvedBy', 'username fullName');
    res.json({ transfers });
  }),
);

async function transitionTransfer(
  req: Express.Request,
  id: string,
  action: 'accept' | 'reject',
) {
  const transfer = await Transfer.findById(id);
  if (!transfer) throw notFound('Transfer not found');
  if (transfer.status !== 'pending') throw conflict(`Transfer already ${transfer.status}`);

  const user = req.user!;
  // Only the destination franchise (or global roles) can accept/reject
  if (user.role === 'franchise' || user.role === 'seller') {
    if (!user.franchiseId || user.franchiseId !== transfer.destFranchiseId?.toString()) {
      throw forbidden('Only the destination franchise can resolve this transfer');
    }
  }

  if (action === 'reject') {
    transfer.status = 'rejected';
    transfer.resolvedBy = new mongoose.Types.ObjectId(user.sub);
    transfer.resolvedAt = new Date();
    await transfer.save();
    return transfer;
  }

  // Accept: decrement source, increment dest, log two movements
  await applyStockDelta({
    franchiseId: transfer.sourceFranchiseId!,
    productId: transfer.productId!,
    delta: -transfer.quantity,
    type: 'transfer_out',
    userId: user.sub,
    refId: transfer._id,
  });
  await applyStockDelta({
    franchiseId: transfer.destFranchiseId!,
    productId: transfer.productId!,
    delta: transfer.quantity,
    type: 'transfer_in',
    userId: user.sub,
    refId: transfer._id,
  });

  transfer.status = 'accepted';
  transfer.resolvedBy = new mongoose.Types.ObjectId(user.sub);
  transfer.resolvedAt = new Date();
  await transfer.save();
  return transfer;
}

router.post(
  '/:id/accept',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const transfer = await transitionTransfer(req as any, req.params.id as string, 'accept');
    await createNotification({
      userId: transfer.requestedBy,
      title: 'Transfert accepte',
      message: 'Votre demande de transfert a ete acceptee.',
      type: 'success',
      link: '/transfers',
      dedupeKey: `transfer-accepted:${transfer._id.toString()}`,
      metadata: { kind: 'transfer_accepted', transferId: transfer._id.toString() },
    });
    await audit(req, { action: 'transfer.accept', entity: 'Transfer', entityId: transfer._id.toString() });
    res.json({ transfer });
  }),
);

router.post(
  '/:id/reject',
  requireAuth,
  requireRole('admin', 'manager', 'franchise'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const transfer = await transitionTransfer(req as any, req.params.id as string, 'reject');
    await createNotification({
      userId: transfer.requestedBy,
      title: 'Transfert refuse',
      message: 'Votre demande de transfert a ete refusee.',
      type: 'warning',
      link: '/transfers',
      dedupeKey: `transfer-rejected:${transfer._id.toString()}`,
      metadata: { kind: 'transfer_rejected', transferId: transfer._id.toString() },
    });
    await audit(req, { action: 'transfer.reject', entity: 'Transfer', entityId: transfer._id.toString() });
    res.json({ transfer });
  }),
);

export default router;
