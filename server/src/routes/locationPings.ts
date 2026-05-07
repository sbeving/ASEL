import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission, franchiseScopeFilter } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { LocationPing } from '../models/LocationPing.js';
import { CommercialZone } from '../models/CommercialZone.js';
import { forbidden } from '../utils/AppError.js';
import { isPermissionGranted } from '../utils/permissions.js';
import { assessLocationIntegrity, deviceIntegritySchema } from '../utils/locationIntegrity.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

interface GeoPoint {
  lat: number;
  lng: number;
}

function pointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects =
      pi.lng > point.lng !== pj.lng > point.lng &&
      point.lat < ((pj.lat - pi.lat) * (point.lng - pi.lng)) / ((pj.lng - pi.lng) || Number.EPSILON) + pi.lat;
    if (intersects) inside = !inside;
  }
  return inside;
}

async function resolveCommercialZone(user: NonNullable<Express.Request['user']>, gps: GeoPoint) {
  if (user.role !== 'commercial') return { zoneId: null, inZone: null };

  const filter: Record<string, unknown> = {
    active: true,
    assignedCommercialIds: user.sub,
  };
  if (user.franchiseId) {
    filter.$or = [{ franchiseId: user.franchiseId }, { franchiseId: null }];
  }

  const zones = await CommercialZone.find(filter).select('_id polygon').lean();
  const zone = zones.find((row) => pointInPolygon(gps, row.polygon as GeoPoint[]));
  return {
    zoneId: zone?._id ?? null,
    inZone: zones.length === 0 ? null : Boolean(zone),
  };
}

const createSchema = z.object({
  gps: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).optional().nullable(),
    heading: z.number().optional().nullable(),
    speed: z.number().optional().nullable(),
    mocked: z.boolean().optional().nullable(),
    address: z.string().trim().max(255).optional(),
  }),
  integrity: deviceIntegritySchema,
  timestamp: z.string().datetime().optional(),
  source: z.enum(['mobile_foreground', 'mobile_background', 'manual']).default('mobile_foreground'),
  batteryPct: z.number().min(0).max(100).optional().nullable(),
});

router.post(
  '/',
  requireAuth,
  requirePermission('timelogs.create'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;
    const user = req.user!;
    const zone = await resolveCommercialZone(user, input.gps);
    const integrityAssessment = assessLocationIntegrity(input.gps, input.integrity);

    const ping = await LocationPing.create({
      userId: user.sub,
      franchiseId: user.franchiseId ?? null,
      role: user.role,
      timestamp: input.timestamp ? new Date(input.timestamp) : new Date(),
      source: input.source,
      gps: {
        lat: input.gps.lat,
        lng: input.gps.lng,
        accuracy: input.gps.accuracy ?? null,
        heading: input.gps.heading ?? null,
        speed: input.gps.speed ?? null,
        mocked: input.gps.mocked ?? null,
        address: input.gps.address ?? '',
      },
      integrity: integrityAssessment.integrity,
      zoneId: zone.zoneId,
      inZone: zone.inZone,
      batteryPct: input.batteryPct ?? null,
      device: String(req.headers['user-agent'] ?? ''),
    });

    res.status(201).json({ ping });
  }),
);

const listQuery = z.object({
  scope: z.enum(['self', 'team']).default('self'),
  franchiseId: objectId.optional(),
  userId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

router.get(
  '/',
  requireAuth,
  requirePermission('timelogs.view.self', 'timelogs.view.all'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { scope, franchiseId, userId, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const canViewAll = isPermissionGranted(req.user!.role, 'timelogs.view.all', req.user!.customPermissions);
    if (scope === 'team' && !canViewAll) throw forbidden();

    const canViewSelfOnly = scope === 'self' || !canViewAll;
    const filter: Record<string, unknown> = canViewSelfOnly ? {} : franchiseScopeFilter(req.user);

    if (franchiseId) {
      if (filter.franchiseId && filter.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (canViewSelfOnly) {
      filter.userId = req.user!.sub;
    } else if (userId) {
      filter.userId = userId;
    }

    const pings = await LocationPing.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('userId', 'fullName username role')
      .populate('franchiseId', 'name')
      .populate('zoneId', 'name color');

    res.json({ pings });
  }),
);

router.get(
  '/latest',
  requireAuth,
  requirePermission('timelogs.view.self', 'timelogs.view.all'),
  asyncHandler(async (req, res) => {
    const canViewAll = isPermissionGranted(req.user!.role, 'timelogs.view.all', req.user!.customPermissions);
    const filter = canViewAll ? franchiseScopeFilter(req.user) : { userId: req.user!.sub };

    const pings = await LocationPing.aggregate([
      { $match: filter },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$userId',
          ping: { $first: '$$ROOT' },
        },
      },
      { $replaceRoot: { newRoot: '$ping' } },
      { $sort: { timestamp: -1 } },
      { $limit: 500 },
    ]);

    res.json({ pings });
  }),
);

export default router;
