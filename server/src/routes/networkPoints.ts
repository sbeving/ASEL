import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NetworkPoint } from '../models/NetworkPoint.js';
import { Franchise } from '../models/Franchise.js';
import { audit } from '../services/audit.service.js';
import { badRequest, notFound } from '../utils/AppError.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });
const pointType = z.enum(['franchise', 'activation', 'recharge', 'activation_recharge']);
const pointStatus = z.enum([
  'prospect',
  'contact',
  'contrat_non_signe',
  'contrat_signe',
  'actif',
  'suspendu',
  'resilie',
]);

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  type: pointType.optional(),
  status: pointStatus.optional(),
  city: z.string().trim().max(100).optional(),
  onlyMapped: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(300).default(40),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

function buildPointFilter(input: z.infer<typeof listQuery>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (input.type) filter.type = input.type;
  if (input.status) filter.status = input.status;
  if (input.city) filter.city = { $regex: input.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (input.active !== undefined) filter.active = input.active;
  else filter.active = true;
  if (input.onlyMapped) {
    filter['gps.lat'] = { $ne: null };
    filter['gps.lng'] = { $ne: null };
  }
  if (input.q) {
    const escaped = input.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    filter.$or = [{ name: rx }, { address: rx }, { city: rx }, { responsible: rx }, { internalNotes: rx }];
  }
  return filter;
}

router.get(
  '/',
  requireAuth,
  requirePermission('map.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const input = req.query as unknown as z.infer<typeof listQuery>;
    const pageSize = input.pageSize;
    const page = input.page;
    const skip = (page - 1) * pageSize;
    const filter = buildPointFilter(input);

    const [total, points, countsByType, countsByStatus, mappedCount] = await Promise.all([
      NetworkPoint.countDocuments(filter),
      NetworkPoint.find(filter)
        .sort({ type: 1, name: 1 })
        .skip(skip)
        .limit(pageSize)
        .populate('franchiseId', 'name')
        .populate('createdBy', 'fullName username'),
      NetworkPoint.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      NetworkPoint.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      NetworkPoint.countDocuments({
        ...filter,
        'gps.lat': { $ne: null },
        'gps.lng': { $ne: null },
      }),
    ]);

    const byType = countsByType.reduce<Record<string, number>>((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});
    const byStatus = countsByStatus.reduce<Record<string, number>>((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});

    res.json({
      points,
      summary: {
        total,
        mapped: mappedCount,
        byType,
        byStatus,
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

const mapQuery = z.object({
  type: pointType.optional(),
  status: pointStatus.optional(),
  fallbackFranchises: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

router.get(
  '/map',
  requireAuth,
  requirePermission('map.view'),
  validate(mapQuery, 'query'),
  asyncHandler(async (req, res) => {
    const input = req.query as unknown as z.infer<typeof mapQuery>;
    const pointFilter: Record<string, unknown> = {
      active: true,
      'gps.lat': { $ne: null },
      'gps.lng': { $ne: null },
    };
    if (input.type) pointFilter.type = input.type;
    if (input.status) pointFilter.status = input.status;

    const points = await NetworkPoint.find(pointFilter)
      .sort({ type: 1, name: 1 })
      .populate('franchiseId', 'name');

    if (points.length > 0 || !input.fallbackFranchises) {
      return res.json({ points, source: 'network_points' });
    }

    const franchises = await Franchise.find({
      active: true,
      'gps.lat': { $ne: null },
      'gps.lng': { $ne: null },
    })
      .sort({ name: 1 })
      .select('name address phone manager gps');

    const fallbackPoints = franchises.map((franchise) => ({
      _id: `franchise-${franchise._id.toString()}`,
      name: franchise.name,
      type: 'franchise',
      status: 'actif',
      address: franchise.address ?? '',
      city: '',
      governorate: '',
      phone: franchise.phone ?? '',
      phone2: '',
      email: '',
      responsible: franchise.manager ?? '',
      schedule: '',
      gps: franchise.gps ?? { lat: null, lng: null },
      internalNotes: '',
      franchiseId: franchise,
      commissionPct: 0,
      active: true,
      createdAt: franchise.createdAt,
      updatedAt: franchise.updatedAt,
    }));

    res.json({ points: fallbackPoints, source: 'franchises' });
  }),
);

const payloadBase = z.object({
    name: z.string().trim().min(1).max(200),
    type: pointType.default('activation_recharge'),
    status: pointStatus.default('prospect'),
    address: z.string().trim().max(255).optional(),
    city: z.string().trim().max(100).optional(),
    governorate: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(50).optional(),
    phone2: z.string().trim().max(50).optional(),
    email: z.string().trim().email().max(150).optional().or(z.literal('')),
    responsible: z.string().trim().max(150).optional(),
    schedule: z.string().trim().max(255).optional(),
    gps: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .nullable()
      .optional(),
    internalNotes: z.string().trim().max(3000).optional(),
    franchiseId: objectId.nullable().optional(),
    contactDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    contractDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    activationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    commissionPct: z.number().min(0).max(100).optional(),
    active: z.boolean().optional(),
  });

const createPayload = payloadBase.refine((value) => {
    if (value.type !== 'franchise') return true;
    return !!value.franchiseId;
  }, {
    path: ['franchiseId'],
    message: 'franchiseId is required when type=franchise',
  });

const updatePayload = payloadBase.partial();

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('map.manage'),
  validate(createPayload),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createPayload>;
    if (input.franchiseId && !(await Franchise.exists({ _id: input.franchiseId }))) {
      throw badRequest('franchiseId does not exist');
    }

    const point = await NetworkPoint.create({
      ...input,
      email: input.email || '',
      address: input.address ?? '',
      city: input.city ?? '',
      governorate: input.governorate ?? '',
      phone: input.phone ?? '',
      phone2: input.phone2 ?? '',
      responsible: input.responsible ?? '',
      schedule: input.schedule ?? 'Lun-Sam: 09:00-19:00',
      internalNotes: input.internalNotes ?? '',
      contactDate: input.contactDate ? new Date(`${input.contactDate}T00:00:00.000Z`) : null,
      contractDate: input.contractDate ? new Date(`${input.contractDate}T00:00:00.000Z`) : null,
      activationDate: input.activationDate ? new Date(`${input.activationDate}T00:00:00.000Z`) : null,
      commissionPct: input.commissionPct ?? 0,
      active: input.active ?? true,
      createdBy: req.user!.sub,
      gps: input.gps ?? { lat: null, lng: null },
    });

    await audit(req, {
      action: 'network_point.create',
      entity: 'NetworkPoint',
      entityId: point._id.toString(),
      details: { type: point.type, status: point.status },
    });

    const row = await NetworkPoint.findById(point._id)
      .populate('franchiseId', 'name')
      .populate('createdBy', 'fullName username');
    res.status(201).json({ point: row });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('map.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(updatePayload),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof updatePayload>;
    const point = await NetworkPoint.findById(id);
    if (!point) throw notFound('Network point not found');

    const nextType = input.type ?? point.type;
    const nextFranchiseId = input.franchiseId !== undefined ? input.franchiseId : point.franchiseId;
    if (nextType === 'franchise' && !nextFranchiseId) {
      throw badRequest('franchiseId is required when type=franchise');
    }
    if (input.franchiseId && !(await Franchise.exists({ _id: input.franchiseId }))) {
      throw badRequest('franchiseId does not exist');
    }

    Object.assign(point, {
      ...input,
      ...(input.email !== undefined ? { email: input.email || '' } : {}),
      ...(input.contactDate !== undefined
        ? { contactDate: input.contactDate ? new Date(`${input.contactDate}T00:00:00.000Z`) : null }
        : {}),
      ...(input.contractDate !== undefined
        ? { contractDate: input.contractDate ? new Date(`${input.contractDate}T00:00:00.000Z`) : null }
        : {}),
      ...(input.activationDate !== undefined
        ? { activationDate: input.activationDate ? new Date(`${input.activationDate}T00:00:00.000Z`) : null }
        : {}),
      ...(input.gps !== undefined ? { gps: input.gps ?? { lat: null, lng: null } } : {}),
    });
    await point.save();

    await audit(req, {
      action: 'network_point.update',
      entity: 'NetworkPoint',
      entityId: point._id.toString(),
      details: { type: point.type, status: point.status, active: point.active },
    });

    const row = await NetworkPoint.findById(point._id)
      .populate('franchiseId', 'name')
      .populate('createdBy', 'fullName username');
    res.json({ point: row });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager'),
  requirePermission('map.manage'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const point = await NetworkPoint.findById(id);
    if (!point) throw notFound('Network point not found');
    point.active = false;
    await point.save();

    await audit(req, {
      action: 'network_point.archive',
      entity: 'NetworkPoint',
      entityId: point._id.toString(),
      details: { name: point.name },
    });
    res.json({ point });
  }),
);

export default router;
