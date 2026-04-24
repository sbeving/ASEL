import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission, requireRole, franchiseScopeFilter } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Client } from '../models/Client.js';
import { Franchise } from '../models/Franchise.js';
import { audit } from '../services/audit.service.js';
import { attachClientListMetrics, getClientOverview } from '../services/clientInsights.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { isGlobalRole } from '../utils/roles.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  franchiseId: objectId.optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get(
  '/',
  requireAuth,
  requirePermission('clients.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { q, franchiseId, active, page, pageSize, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const effectivePageSize = limit ?? pageSize;
    const skip = (page - 1) * effectivePageSize;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };
    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (active !== undefined) filter.active = active;
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
      ];
    }

    const [total, clients] = await Promise.all([
      Client.countDocuments(filter),
      Client.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(effectivePageSize)
        .populate('franchiseId', 'name')
        .lean(),
    ]);
    const items = await attachClientListMetrics(clients, req.user?.franchiseId ?? null);
    res.json({
      clients: items,
      meta: {
        page,
        pageSize: effectivePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / effectivePageSize)),
      },
    });
  }),
);

router.get(
  '/:id/overview',
  requireAuth,
  requirePermission('clients.view'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const overview = await getClientOverview(id, req.user?.franchiseId ?? null);
    if (!overview) throw notFound('Client not found');
    if (overview === 'forbidden') throw forbidden();
    res.json(overview);
  }),
);

const payload = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).optional(),
  phone2: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  address: z.string().trim().max(300).optional(),
  clientType: z.enum(['walkin', 'boutique', 'wholesale', 'passager', 'other']).default('walkin'),
  company: z.string().trim().max(160).optional(),
  taxId: z.string().trim().max(80).optional(),
  cin: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
  franchiseId: objectId.nullable().optional(),
  active: z.boolean().optional(),
});

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'franchise', 'seller', 'vendeur'),
  requirePermission('clients.manage'),
  validate(payload),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof payload>;
    let franchiseId = input.franchiseId ?? null;
    if (!isGlobalRole(req.user!.role)) {
      if (!req.user!.franchiseId) throw forbidden('No franchise assigned');
      if (franchiseId && franchiseId !== req.user!.franchiseId) throw forbidden();
      franchiseId = req.user!.franchiseId;
    }
    if (franchiseId && !(await Franchise.exists({ _id: franchiseId }))) {
      throw badRequest('franchiseId does not exist');
    }

    const client = await Client.create({
      ...input,
      email: input.email || undefined,
      franchiseId,
      active: input.active ?? true,
    });

    await audit(req, {
      action: 'client.create',
      entity: 'Client',
      entityId: client._id.toString(),
      franchiseId,
      details: { fullName: client.fullName, clientType: client.clientType },
    });

    res.status(201).json({ client });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'franchise', 'seller', 'vendeur'),
  requirePermission('clients.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(payload.partial()),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const input = req.body as z.infer<typeof payload>;

    const client = await Client.findById(id);
    if (!client) throw notFound('Client not found');

    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && client.franchiseId?.toString() !== scope.franchiseId) throw forbidden();

    if (input.franchiseId !== undefined) {
      if (scope.franchiseId && input.franchiseId !== scope.franchiseId) throw forbidden();
      client.franchiseId = input.franchiseId as any;
    }

    Object.assign(client, {
      ...input,
      email: input.email === '' ? undefined : input.email,
    });

    await client.save();
    await audit(req, { action: 'client.update', entity: 'Client', entityId: id, franchiseId: client.franchiseId?.toString() ?? null });
    res.json({ client });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'franchise', 'seller', 'vendeur'),
  requirePermission('clients.manage'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const client = await Client.findById(id);
    if (!client) throw notFound('Client not found');

    const scope = franchiseScopeFilter(req.user);
    if (scope.franchiseId && client.franchiseId?.toString() !== scope.franchiseId) throw forbidden();

    client.active = false;
    await client.save();

    await audit(req, {
      action: 'client.archive',
      entity: 'Client',
      entityId: id,
      franchiseId: client.franchiseId?.toString() ?? null,
      details: { fullName: client.fullName },
    });

    res.json({ client });
  }),
);

export default router;
