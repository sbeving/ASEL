import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requirePermission, requireRole, type JwtPayload } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { TimeLog } from '../models/TimeLog.js';
import { LocationPing } from '../models/LocationPing.js';
import { CommercialZone } from '../models/CommercialZone.js';
import { Franchise } from '../models/Franchise.js';
import { User } from '../models/User.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden } from '../utils/AppError.js';
import { isPermissionGranted } from '../utils/permissions.js';
import { env } from '../config/env.js';
import { ROLES, type Role, isGlobalRole } from '../utils/roles.js';
import { getSiegePointageZone, isSiegePointageRole, saveSiegePointageZone } from '../utils/pointage.js';
import { assertLocationIntegrity, deviceIntegritySchema } from '../utils/locationIntegrity.js';
import { computeWorkedMinutes } from '../utils/workSession.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });
interface GeoPoint {
  lat: number;
  lng: number;
}

const logSchema = z.object({
  type: z.enum(['entree', 'sortie', 'pause_debut', 'pause_fin', 'verif']),
  gps: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).optional().nullable(),
    mocked: z.boolean().optional().nullable(),
    address: z.string().optional()
  }),
  integrity: deviceIntegritySchema,
  note: z.string().max(500).optional()
});

const siegeZoneSchema = z.object({
  name: z.string().trim().min(1).max(140),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(20).max(5000),
});

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listQuery = z.object({
  scope: z.enum(['self', 'team']).default('self'),
  franchiseId: objectId.optional(),
  userId: objectId.optional(),
  role: z.enum(ROLES).optional(),
  workingZone: z.enum(['siege', 'franchise', 'commercial_zone']).optional(),
  commercialZoneId: objectId.optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

function buildDateRange(input: {
  from?: string;
  to?: string;
  month?: string;
}): { $gte?: Date; $lte?: Date } | undefined {
  if (input.month) {
    const [yearText, monthText] = input.month.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return undefined;
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return { $gte: start, $lte: end };
  }

  if (!input.from && !input.to) return undefined;
  return {
    ...(input.from ? { $gte: new Date(`${input.from}T00:00:00.000Z`) } : {}),
    ...(input.to ? { $lte: new Date(`${input.to}T23:59:59.999Z`) } : {}),
  };
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const earth = 6_371_000;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);
  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function workZoneRoles(workingZone?: 'siege' | 'franchise' | 'commercial_zone'): Role[] | null {
  if (workingZone === 'siege') return ['hr_admin', 'siege_employee'];
  if (workingZone === 'commercial_zone') return ['commercial'];
  if (workingZone === 'franchise') return ['franchise', 'seller', 'vendeur', 'viewer'];
  return null;
}

function mergeRoleFilters(role?: Role, workingZone?: 'siege' | 'franchise' | 'commercial_zone'): Role[] | null {
  const zoneRoles = workZoneRoles(workingZone);
  if (role && zoneRoles && !zoneRoles.includes(role)) return [];
  if (role) return [role];
  return zoneRoles;
}

async function resolveCommercialZoneUserIds(commercialZoneId?: string): Promise<string[] | null> {
  if (!commercialZoneId) return null;
  const zone = await CommercialZone.findById(commercialZoneId).select('assignedCommercialIds').lean();
  if (!zone) return [];
  return (zone.assignedCommercialIds ?? []).map((id) => id.toString());
}

async function resolveUserIdsForFilters(input: {
  role?: Role;
  workingZone?: 'siege' | 'franchise' | 'commercial_zone';
  commercialZoneId?: string;
}) {
  const roles = mergeRoleFilters(input.role, input.workingZone);
  const zoneUserIds = await resolveCommercialZoneUserIds(input.commercialZoneId);

  if (roles === null && zoneUserIds === null) return null;
  if (roles?.length === 0 || zoneUserIds?.length === 0) return [];

  const filter: Record<string, unknown> = { active: true };
  if (roles) filter.role = roles.length === 1 ? roles[0] : mongoose.trusted({ $in: roles });
  if (zoneUserIds) filter._id = mongoose.trusted({ $in: zoneUserIds });
  const users = await User.find(filter).select('_id').lean();
  return users.map((user) => user._id.toString());
}

function applyUserFilter(filter: Record<string, unknown>, userIds: string[] | null) {
  if (!userIds) return;
  if (userIds.length === 0) {
    filter.userId = '000000000000000000000000';
    return;
  }
  if (typeof filter.userId === 'string') {
    if (!userIds.includes(filter.userId)) filter.userId = '000000000000000000000000';
    return;
  }
  filter.userId = mongoose.trusted({ $in: userIds });
}

function commercialZoneAccessFilter(user: JwtPayload, activeOnly = true) {
  const filter: Record<string, unknown> = activeOnly ? { active: true } : {};
  if (isGlobalRole(user.role)) {
    return filter;
  }
  if (user.role === 'commercial') {
    filter.assignedCommercialIds = user.sub;
    return filter;
  }
  if (user.franchiseId) {
    filter.franchiseId = user.franchiseId;
    return filter;
  }
  filter._neverMatch = true;
  return filter;
}

function canSeeSiegePointageZone(user: JwtPayload) {
  return isGlobalRole(user.role) || isSiegePointageRole(user.role);
}

function groupLogsByUser(logs: Array<{ userId: unknown; type: string; timestamp: Date }>) {
  const logsByUser = new Map<string, Array<{ type: string; timestamp: Date }>>();
  for (const log of logs) {
    const id =
      typeof log.userId === 'string'
        ? log.userId
        : (log.userId as { _id?: { toString?: () => string }; toString?: () => string } | null)?._id?.toString?.() ??
          (log.userId as { toString?: () => string } | null)?.toString?.() ??
          '';
    if (!id) continue;
    const rows = logsByUser.get(id) ?? [];
    rows.push({ type: log.type, timestamp: log.timestamp });
    logsByUser.set(id, rows);
  }
  return logsByUser;
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

async function assertPointageGeofence(user: JwtPayload, gps: GeoPoint) {
  if (user.role === 'commercial') {
    const zones = await CommercialZone.find({
      active: true,
      assignedCommercialIds: user.sub,
    })
      .select('_id polygon name')
      .lean();
    if (zones.length === 0) throw badRequest('Commercial must be linked to an active zone before pointage');
    if (!zones.some((zone) => pointInPolygon(gps, zone.polygon as GeoPoint[]))) {
      throw badRequest('Commercial pointage is outside assigned zone');
    }
    return;
  }

  if (isSiegePointageRole(user.role)) {
    const siegeZone = await getSiegePointageZone();
    const distance = distanceMeters(gps.lat, gps.lng, siegeZone.gps.lat, siegeZone.gps.lng);
    if (distance > siegeZone.radiusMeters) {
      throw badRequest('Pointage must be inside siege perimeter', {
        siege: siegeZone.name,
        distanceMeters: Math.round(distance),
        radiusMeters: siegeZone.radiusMeters,
      });
    }
    return;
  }

  if (!user.franchiseId) return;
  const franchise = await Franchise.findById(user.franchiseId)
    .select('name gps')
    .lean<{ name?: string; gps?: { lat?: number | null; lng?: number | null } }>();
  const fLat = franchise?.gps?.lat;
  const fLng = franchise?.gps?.lng;
  if (typeof fLat !== 'number' || typeof fLng !== 'number') {
    throw badRequest('Franchise GPS is required before pointage');
  }
  const distance = distanceMeters(gps.lat, gps.lng, fLat, fLng);
  if (distance > env.SIEGE_RADIUS_METERS) {
    throw badRequest('Pointage must be inside franchise perimeter', {
      franchise: franchise?.name ?? user.franchiseId,
      distanceMeters: Math.round(distance),
      radiusMeters: env.SIEGE_RADIUS_METERS,
    });
  }
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const escaped = raw.replaceAll('"', '""');
  return `"${escaped}"`;
}

router.post(
  '/',
  requireAuth,
  requirePermission('timelogs.create'),
  validate(logSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof logSchema>;
    if (!req.user!.franchiseId && req.user!.role !== 'commercial' && !isSiegePointageRole(req.user!.role)) {
      throw badRequest('User must belong to a franchise to punch in');
    }
    const integrityAssessment = assertLocationIntegrity(input.gps, input.integrity);
    await assertPointageGeofence(req.user!, input.gps);

    const log = await TimeLog.create({
      userId: req.user!.sub,
      franchiseId: req.user!.franchiseId ?? null,
      type: input.type,
      gps: input.gps,
      integrity: integrityAssessment.integrity,
      note: input.note,
      device: req.headers['user-agent']
    });

    await audit(req, {
      action: 'timelog.create',
      entity: 'TimeLog',
      entityId: log._id.toString(),
      franchiseId: req.user!.franchiseId ?? undefined,
      details: { type: input.type }
    });

    res.status(201).json({ log });
  })
);

router.get(
  '/siege-zone',
  requireAuth,
  requirePermission('timelogs.view.self', 'timelogs.view.all'),
  asyncHandler(async (req, res) => {
    if (!canSeeSiegePointageZone(req.user!)) throw forbidden();
    res.json({ zone: await getSiegePointageZone() });
  }),
);

router.patch(
  '/siege-zone',
  requireAuth,
  requireRole('ceo', 'admin', 'superadmin', 'manager'),
  validate(siegeZoneSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof siegeZoneSchema>;
    const before = await getSiegePointageZone();
    const zone = await saveSiegePointageZone({
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      radiusMeters: input.radiusMeters,
      updatedBy: req.user!.sub,
    });
    await audit(req, {
      action: 'settings.siege_zone.update',
      entity: 'SystemSetting',
      entityId: 'pointage.siege_zone',
      details: { before, after: zone },
    });
    res.json({ zone });
  }),
);

router.get(
  '/workers',
  requireAuth,
  requirePermission('timelogs.view.all'),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { active: true, ...franchiseScopeFilter(req.user) };
    const users = await User.find(filter)
      .sort({ role: 1, fullName: 1 })
      .select('_id fullName username role franchiseId')
      .lean();
    res.json({ users });
  }),
);

router.get(
  '/',
  requireAuth,
  requirePermission('timelogs.view.self', 'timelogs.view.all'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { scope, franchiseId, userId, role, workingZone, commercialZoneId, from, to, month, page, pageSize } =
      req.query as unknown as z.infer<typeof listQuery>;
    const canViewAll = isPermissionGranted(
      req.user!.role,
      'timelogs.view.all',
      req.user!.customPermissions,
    );
    if (scope === 'team' && !canViewAll) {
      throw forbidden('Team pointage view requires elevated permission');
    }

    const canViewSelfOnly = scope === 'self' || !canViewAll;
    const scopeFilter = canViewSelfOnly ? {} : franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scopeFilter };
    if (franchiseId) {
      if (scopeFilter.franchiseId && scopeFilter.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }

    if (canViewSelfOnly) {
      filter.userId = req.user!.sub;
    } else if (userId) {
      filter.userId = userId;
    }
    if (!canViewSelfOnly) {
      applyUserFilter(filter, await resolveUserIdsForFilters({ role, workingZone, commercialZoneId }));
    }

    const timestampFilter = buildDateRange({ from, to, month });
    if (timestampFilter) filter.timestamp = mongoose.trusted(timestampFilter);

    const skip = (page - 1) * pageSize;
    const [total, logs, activityLogs, entreeCount, sortieCount, pauseDebutCount, pauseFinCount, verifCount] = await Promise.all([
      TimeLog.countDocuments(filter),
      TimeLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('userId', 'fullName username role')
        .populate('franchiseId', 'name'),
      TimeLog.find(filter).sort({ timestamp: 1 }).select('userId type timestamp').lean(),
      TimeLog.countDocuments({ ...filter, type: 'entree' }),
      TimeLog.countDocuments({ ...filter, type: 'sortie' }),
      TimeLog.countDocuments({ ...filter, type: 'pause_debut' }),
      TimeLog.countDocuments({ ...filter, type: 'pause_fin' }),
      TimeLog.countDocuments({ ...filter, type: 'verif' }),
    ]);
    const activeUsers = [...groupLogsByUser(activityLogs).values()]
      .map((rows) => computeWorkedMinutes(rows))
      .filter((row) => row.activeShift).length;

    res.json({
      logs,
      summary: {
        total,
        activeUsers,
        byType: {
          entree: entreeCount,
          sortie: sortieCount,
          pause_debut: pauseDebutCount,
          pause_fin: pauseFinCount,
          verif: verifCount,
        },
      },
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  })
);

const mapQuery = z.object({
  scope: z.enum(['self', 'team']).default('team'),
  franchiseId: objectId.optional(),
  userId: objectId.optional(),
  role: z.enum(ROLES).optional(),
  workingZone: z.enum(['siege', 'franchise', 'commercial_zone']).optional(),
  commercialZoneId: objectId.optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(1000),
  trackLimit: z.coerce.number().int().min(1).max(5000).default(2500),
  radiusMeters: z.coerce.number().int().min(20).max(5000).default(env.SIEGE_RADIUS_METERS),
});

router.get(
  '/map',
  requireAuth,
  requirePermission('timelogs.view.self', 'timelogs.view.all'),
  validate(mapQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { scope, franchiseId, userId, role, workingZone, commercialZoneId, from, to, month, limit, trackLimit, radiusMeters } =
      req.query as unknown as z.infer<typeof mapQuery>;

    const canViewAll = isPermissionGranted(
      req.user!.role,
      'timelogs.view.all',
      req.user!.customPermissions,
    );
    if (scope === 'team' && !canViewAll) {
      throw forbidden('Team pointage view requires elevated permission');
    }

    const canViewSelfOnly = scope === 'self' || !canViewAll;
    const scopeFilter = canViewSelfOnly ? {} : franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = {
      ...scopeFilter,
      'gps.lat': mongoose.trusted({ $ne: null }),
      'gps.lng': mongoose.trusted({ $ne: null }),
    };

    if (franchiseId) {
      if (scopeFilter.franchiseId && scopeFilter.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }

    if (canViewSelfOnly) {
      filter.userId = req.user!.sub;
    } else if (userId) {
      filter.userId = userId;
    }
    const filteredUserIds = canViewSelfOnly
      ? null
      : await resolveUserIdsForFilters({ role, workingZone, commercialZoneId });
    if (!canViewSelfOnly) applyUserFilter(filter, filteredUserIds);

    const timestampFilter = buildDateRange({ from, to, month });
    if (timestampFilter) filter.timestamp = mongoose.trusted(timestampFilter);

    const zoneAccessFilter = commercialZoneAccessFilter(req.user!, true);
    const requestedZoneFilter = commercialZoneId ? { _id: commercialZoneId } : {};
    const commercialZonesPromise = CommercialZone.find({ ...zoneAccessFilter, ...requestedZoneFilter })
      .sort({ name: 1 })
      .populate('franchiseId', 'name')
      .populate('assignedCommercialIds', 'fullName username role')
      .lean();

    const pingFilter: Record<string, unknown> = {
      ...(canViewSelfOnly ? {} : franchiseScopeFilter(req.user)),
      'gps.lat': mongoose.trusted({ $ne: null }),
      'gps.lng': mongoose.trusted({ $ne: null }),
      role: 'commercial',
    };
    if (franchiseId) {
      if (pingFilter.franchiseId && pingFilter.franchiseId !== franchiseId) throw forbidden();
      pingFilter.franchiseId = franchiseId;
    }
    if (canViewSelfOnly) {
      pingFilter.userId = req.user!.sub;
    } else if (userId) {
      pingFilter.userId = userId;
    }
    if (!canViewSelfOnly) applyUserFilter(pingFilter, filteredUserIds);
    if (commercialZoneId) pingFilter.zoneId = commercialZoneId;
    if (role && role !== 'commercial') pingFilter.userId = '000000000000000000000000';
    if (workingZone && workingZone !== 'commercial_zone') pingFilter.userId = '000000000000000000000000';
    if (timestampFilter) pingFilter.timestamp = mongoose.trusted(timestampFilter);

    const [siegeZone, logs, commercialZones, pings] = await Promise.all([
      getSiegePointageZone(),
      TimeLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('userId', 'fullName username role')
        .populate('franchiseId', 'name gps'),
      commercialZonesPromise,
      LocationPing.find(pingFilter)
        .sort({ timestamp: 1 })
        .limit(trackLimit)
        .populate('userId', 'fullName username role')
        .populate('zoneId', 'name color')
        .lean(),
    ]);

    const points = logs
      .map((log) => {
        const lat = log.gps?.lat;
        const lng = log.gps?.lng;
        if (typeof lat !== 'number' || typeof lng !== 'number') return null;

        const userRow =
          typeof log.userId === 'object' && log.userId
            ? {
                _id: (log.userId as any)._id?.toString?.() ?? '',
                fullName: (log.userId as any).fullName || (log.userId as any).username || '',
                role: (log.userId as any).role || '',
              }
            : null;
        const franchise =
          typeof log.franchiseId === 'object' && log.franchiseId ? (log.franchiseId as any) : null;
        const workplace = franchise
          ? {
              _id: franchise._id?.toString?.() ?? '',
              name: franchise.name || '',
              gps:
                typeof franchise.gps?.lat === 'number' && typeof franchise.gps?.lng === 'number'
                  ? { lat: franchise.gps.lat, lng: franchise.gps.lng }
                  : null,
              radiusMeters,
            }
          : isSiegePointageRole(userRow?.role)
            ? siegeZone
            : null;
        const fLat = workplace?.gps?.lat;
        const fLng = workplace?.gps?.lng;
        const workplaceRadius = typeof workplace?.radiusMeters === 'number' ? workplace.radiusMeters : radiusMeters;
        const distance =
          typeof fLat === 'number' && typeof fLng === 'number'
            ? Math.round(distanceMeters(lat, lng, fLat, fLng))
            : null;

        return {
          _id: log._id.toString(),
          type: log.type,
          timestamp: log.timestamp,
          note: log.note || '',
          device: log.device || '',
          gps: {
            lat,
            lng,
            accuracy: typeof log.gps?.accuracy === 'number' ? Math.round(log.gps.accuracy) : null,
            address: log.gps?.address || '',
          },
          user: userRow,
          franchise: workplace,
          inZone: distance == null ? null : distance <= workplaceRadius,
          distanceMeters: distance,
        };
      })
      .filter(Boolean);

    const zonesMap = new Map<
      string,
      { _id: string; name: string; kind: 'franchise' | 'siege'; gps: { lat: number; lng: number }; radiusMeters: number }
    >();
    if (canSeeSiegePointageZone(req.user!) && !commercialZoneId && (!workingZone || workingZone === 'siege')) {
      zonesMap.set('siege', {
        _id: 'siege',
        name: siegeZone.name,
        kind: 'siege',
        gps: siegeZone.gps,
        radiusMeters: siegeZone.radiusMeters,
      });
    }
    for (const point of points) {
      if (!point?.franchise?.gps) continue;
      zonesMap.set(point.franchise._id, {
        _id: point.franchise._id,
        name: point.franchise.name,
        kind: point.franchise._id === 'siege' ? 'siege' : 'franchise',
        gps: point.franchise.gps,
        radiusMeters: point.franchise._id === 'siege' ? siegeZone.radiusMeters : radiusMeters,
      });
    }

    const tracks = new Map<
      string,
      {
        user: { _id: string; fullName: string; role: string } | null;
        zone: { _id: string; name: string; color?: string } | null;
        points: Array<{
          _id: string;
          timestamp: Date;
          gps: { lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null };
          inZone: boolean | null;
          batteryPct: number | null;
        }>;
      }
    >();
    for (const ping of pings) {
      const pingGps = ping.gps;
      if (!pingGps) continue;
      const userRow =
        typeof ping.userId === 'object' && ping.userId
          ? {
              _id: (ping.userId as any)._id?.toString?.() ?? '',
              fullName: (ping.userId as any).fullName || (ping.userId as any).username || '',
              role: (ping.userId as any).role || '',
            }
          : null;
      const trackKey = userRow?._id || ping.userId?.toString?.() || ping._id.toString();
      const zoneRow =
        typeof ping.zoneId === 'object' && ping.zoneId
          ? {
              _id: (ping.zoneId as any)._id?.toString?.() ?? '',
              name: (ping.zoneId as any).name || '',
              color: (ping.zoneId as any).color || undefined,
            }
          : null;
      if (!tracks.has(trackKey)) tracks.set(trackKey, { user: userRow, zone: zoneRow, points: [] });
      tracks.get(trackKey)!.points.push({
        _id: ping._id.toString(),
        timestamp: ping.timestamp,
        gps: {
          lat: pingGps.lat,
          lng: pingGps.lng,
          accuracy: typeof pingGps.accuracy === 'number' ? Math.round(pingGps.accuracy) : null,
          heading: typeof pingGps.heading === 'number' ? pingGps.heading : null,
          speed: typeof pingGps.speed === 'number' ? pingGps.speed : null,
        },
        inZone: typeof ping.inZone === 'boolean' ? ping.inZone : null,
        batteryPct: typeof ping.batteryPct === 'number' ? ping.batteryPct : null,
      });
    }

    res.json({
      points,
      zones: [...zonesMap.values()],
      commercialZones: commercialZones.map((zone) => ({
        _id: zone._id.toString(),
        name: zone.name,
        color: zone.color,
        franchiseId: zone.franchiseId,
        assignedCommercialIds: zone.assignedCommercialIds,
        polygon: zone.polygon,
        active: zone.active,
        note: zone.note,
      })),
      commercialTracks: [...tracks.values()]
        .filter((track) => track.points.length > 0)
        .map((track) => ({
          user: track.user,
          zone: track.zone,
          points: track.points,
          latest: track.points[track.points.length - 1],
        })),
      summary: {
        total: points.length,
        inZone:
          points.filter((point) => point?.inZone === true).length,
        outOfZone:
          points.filter((point) => point?.inZone === false).length,
        unknownZone:
          points.filter((point) => point?.inZone == null).length,
        radiusMeters,
        siegeRadiusMeters: siegeZone.radiusMeters,
      },
    });
  }),
);

const exportQuery = z.object({
  scope: z.enum(['self', 'team']).default('team'),
  franchiseId: objectId.optional(),
  userId: objectId.optional(),
  role: z.enum(ROLES).optional(),
  workingZone: z.enum(['siege', 'franchise', 'commercial_zone']).optional(),
  commercialZoneId: objectId.optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

router.get(
  '/export',
  requireAuth,
  requirePermission('timelogs.export'),
  validate(exportQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { scope, franchiseId, userId, role, workingZone, commercialZoneId, from, to, month } =
      req.query as unknown as z.infer<typeof exportQuery>;

    const canViewAll = isPermissionGranted(
      req.user!.role,
      'timelogs.view.all',
      req.user!.customPermissions,
    );
    if (scope === 'team' && !canViewAll) throw forbidden();

    const canViewSelfOnly = scope === 'self' || !canViewAll;
    const scopeFilter = canViewSelfOnly ? {} : franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scopeFilter };
    if (franchiseId) {
      if (scopeFilter.franchiseId && scopeFilter.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (canViewSelfOnly) {
      filter.userId = req.user!.sub;
    } else if (userId) {
      filter.userId = userId;
    }
    if (!canViewSelfOnly) {
      applyUserFilter(filter, await resolveUserIdsForFilters({ role, workingZone, commercialZoneId }));
    }
    const timestampFilter = buildDateRange({ from, to, month });
    if (timestampFilter) filter.timestamp = mongoose.trusted(timestampFilter);

    const logs = await TimeLog.find(filter)
      .sort({ timestamp: 1 })
      .populate('userId', 'fullName username role')
      .populate('franchiseId', 'name');
    const siegeZone = await getSiegePointageZone();

    const filenameSuffix = month ?? from ?? new Date().toISOString().slice(0, 10);
    const lines = [
      '\uFEFFDate;Heure;Employe;Role;Site;Type;Latitude;Longitude;Precision metres;Adresse;Note',
    ];

    for (const log of logs) {
      const at = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
      const userLabel =
        typeof log.userId === 'object' && log.userId
          ? ((log.userId as { fullName?: string; username?: string }).fullName ??
            (log.userId as { fullName?: string; username?: string }).username ??
            '')
          : '';
      const roleLabel =
        typeof log.userId === 'object' && log.userId
          ? ((log.userId as { role?: string }).role ?? '')
          : '';
      const franchiseLabel =
        typeof log.franchiseId === 'object' && log.franchiseId
          ? ((log.franchiseId as { name?: string }).name ?? '')
          : isSiegePointageRole(roleLabel)
            ? siegeZone.name
            : '';

      lines.push(
        [
          csvCell(at.toISOString().slice(0, 10)),
          csvCell(at.toISOString().slice(11, 16)),
          csvCell(userLabel),
          csvCell(roleLabel),
          csvCell(franchiseLabel),
          csvCell(log.type),
          csvCell(log.gps?.lat),
          csvCell(log.gps?.lng),
          csvCell(log.gps?.accuracy),
          csvCell(log.gps?.address),
          csvCell(log.note),
        ].join(';'),
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="pointage_${filenameSuffix}.csv"`,
    );
    res.status(200).send(lines.join('\n'));
  }),
);

export default router;
