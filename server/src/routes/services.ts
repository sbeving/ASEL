import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import {
  franchiseScopeFilter,
  requireAuth,
  requirePermission,
  requireRole,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Service } from '../models/Service.js';
import { Prestation } from '../models/Prestation.js';
import { Franchise } from '../models/Franchise.js';
import { Client } from '../models/Client.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';

const router = Router();

const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const servicePayload = z.object({
  name: z.string().trim().min(1).max(150),
  category: z.enum(['technique', 'compte', 'autre']).default('technique'),
  price: z.number().min(0).default(0),
  description: z.string().trim().max(1200).optional(),
  durationMinutes: z.number().int().min(1).max(1440).default(15),
  active: z.boolean().optional(),
});

const listServicesQuery = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.enum(['technique', 'compte', 'autre']).optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(300).default(50),
});

router.get(
  '/',
  requireAuth,
  requirePermission('services.view'),
  validate(listServicesQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { q, category, active, page, pageSize } =
      req.query as unknown as z.infer<typeof listServicesQuery>;
    const skip = (page - 1) * pageSize;
    const filter: Record<string, unknown> = {};
    if (category) filter.category = category;
    if (active !== undefined) filter.active = active;
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [{ name: rx }, { description: rx }];
    }

    const [total, services, groupedCounts] = await Promise.all([
      Service.countDocuments(filter),
      Service.find(filter).sort({ active: -1, category: 1, name: 1 }).skip(skip).limit(pageSize),
      Service.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]),
    ]);

    const byCategory = groupedCounts.reduce<Record<string, number>>((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});
    const activeCount = services.filter((service) => service.active).length;

    res.json({
      services,
      summary: {
        total,
        activeOnPage: activeCount,
        byCategory,
      },
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('services.manage'),
  validate(servicePayload),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof servicePayload>;
    const service = await Service.create({
      ...input,
      description: input.description ?? '',
      active: input.active ?? true,
    });

    await audit(req, {
      action: 'service.create',
      entity: 'Service',
      entityId: service._id.toString(),
      details: { category: service.category, price: service.price },
    });

    res.status(201).json({ service });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('services.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(servicePayload.partial()),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof servicePayload>;

    const service = await Service.findByIdAndUpdate(
      id,
      {
        ...input,
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
      { new: true, runValidators: true },
    );
    if (!service) throw notFound('Service not found');

    await audit(req, {
      action: 'service.update',
      entity: 'Service',
      entityId: id,
      details: { category: service.category, active: service.active },
    });

    res.json({ service });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('services.manage'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const service = await Service.findById(id);
    if (!service) throw notFound('Service not found');
    service.active = false;
    await service.save();

    await audit(req, {
      action: 'service.archive',
      entity: 'Service',
      entityId: id,
      details: { name: service.name },
    });

    res.json({ service });
  }),
);

const listRecordsQuery = z.object({
  q: z.string().trim().max(120).optional(),
  serviceId: objectId.optional(),
  franchiseId: objectId.optional(),
  userId: objectId.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(300).default(40),
});

router.get(
  '/records',
  requireAuth,
  requirePermission('services.view'),
  validate(listRecordsQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { q, serviceId, franchiseId, userId, from, to, page, pageSize } =
      req.query as unknown as z.infer<typeof listRecordsQuery>;
    const skip = (page - 1) * pageSize;
    const scope = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scope };

    if (franchiseId) {
      if (scope.franchiseId && scope.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (serviceId) filter.serviceId = serviceId;
    if (userId) filter.userId = userId;
    if (from || to) {
      const start = from ? new Date(`${from}T00:00:00.000Z`) : undefined;
      const end = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
      filter.performedAt = {
        ...(start ? { $gte: start } : {}),
        ...(end ? { $lte: end } : {}),
      };
    }
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.note = { $regex: escaped, $options: 'i' };
    }

    const [total, records, totals] = await Promise.all([
      Prestation.countDocuments(filter),
      Prestation.find(filter)
        .sort({ performedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('serviceId', 'name category')
        .populate('franchiseId', 'name')
        .populate('clientId', 'fullName phone')
        .populate('userId', 'fullName username'),
      Prestation.aggregate<{ _id: null; totalRevenue: number; averagePrice: number }>([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$billedPrice' },
            averagePrice: { $avg: '$billedPrice' },
          },
        },
      ]),
    ]);

    const summary = totals[0] ?? { totalRevenue: 0, averagePrice: 0 };
    res.json({
      records,
      summary: {
        totalRecords: total,
        totalRevenue: Number(summary.totalRevenue.toFixed(2)),
        averagePrice: Number(summary.averagePrice.toFixed(2)),
      },
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  }),
);

const createRecordSchema = z.object({
  serviceId: objectId,
  franchiseId: objectId.optional(),
  clientId: objectId.nullable().optional(),
  billedPrice: z.number().min(0).optional(),
  performedAt: z.string().datetime().optional(),
  note: z.string().trim().max(1000).optional(),
});

router.post(
  '/records',
  requireAuth,
  requireRole('admin', 'manager', 'franchise', 'seller', 'vendeur'),
  requirePermission('services.record'),
  validate(createRecordSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createRecordSchema>;
    const scope = franchiseScopeFilter(req.user);
    const scopedFranchiseId = typeof scope.franchiseId === 'string' ? scope.franchiseId : undefined;
    const targetFranchiseId = scopedFranchiseId ?? input.franchiseId;
    if (!targetFranchiseId) throw badRequest('franchiseId is required');
    if (!(await Franchise.exists({ _id: targetFranchiseId }))) throw badRequest('franchiseId does not exist');

    const service = await Service.findById(input.serviceId).select('price active name');
    if (!service) throw badRequest('serviceId does not exist');
    if (!service.active) throw badRequest('Cannot register prestation on inactive service');

    let clientId: string | null = input.clientId ?? null;
    if (clientId) {
      const client = await Client.findById(clientId).select('_id franchiseId');
      if (!client) throw badRequest('clientId does not exist');
      if (client.franchiseId && client.franchiseId.toString() !== targetFranchiseId) {
        throw badRequest('Client does not belong to selected franchise');
      }
      clientId = client._id.toString();
    }

    const record = await Prestation.create({
      serviceId: input.serviceId,
      franchiseId: targetFranchiseId,
      clientId,
      billedPrice: input.billedPrice ?? service.price,
      performedAt: input.performedAt ? new Date(input.performedAt) : new Date(),
      note: input.note ?? '',
      userId: req.user!.sub,
    });

    await audit(req, {
      action: 'prestation.create',
      entity: 'Prestation',
      entityId: record._id.toString(),
      franchiseId: targetFranchiseId,
      details: {
        serviceId: input.serviceId,
        billedPrice: record.billedPrice,
      },
    });

    const populated = await Prestation.findById(record._id)
      .populate('serviceId', 'name category')
      .populate('franchiseId', 'name')
      .populate('clientId', 'fullName phone')
      .populate('userId', 'fullName username');

    res.status(201).json({ record: populated });
  }),
);

export default router;
