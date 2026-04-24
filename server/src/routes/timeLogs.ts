import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { franchiseScopeFilter, requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { TimeLog } from '../models/TimeLog.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden } from '../utils/AppError.js';
import { isPermissionGranted } from '../utils/permissions.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const logSchema = z.object({
  type: z.enum(['entree', 'sortie', 'pause_debut', 'pause_fin']),
  gps: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional()
  }).optional(),
  note: z.string().max(500).optional()
});

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listQuery = z.object({
  scope: z.enum(['self', 'team']).default('self'),
  franchiseId: objectId.optional(),
  userId: objectId.optional(),
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
    if (!req.user!.franchiseId) throw badRequest('User must belong to a franchise to punch in');

    const log = await TimeLog.create({
      userId: req.user!.sub,
      franchiseId: req.user!.franchiseId,
      type: input.type,
      gps: input.gps,
      note: input.note,
      device: req.headers['user-agent']
    });

    await audit(req, {
      action: 'timelog.create',
      entity: 'TimeLog',
      entityId: log._id.toString(),
      franchiseId: req.user!.franchiseId,
      details: { type: input.type }
    });

    res.status(201).json({ log });
  })
);

router.get(
  '/',
  requireAuth,
  requirePermission('timelogs.view.self', 'timelogs.view.all'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { scope, franchiseId, userId, from, to, month, page, pageSize } =
      req.query as unknown as z.infer<typeof listQuery>;
    const canViewAll = isPermissionGranted(
      req.user!.role,
      'timelogs.view.all',
      req.user!.customPermissions,
    );
    if (scope === 'team' && !canViewAll) {
      throw forbidden('Team pointage view requires elevated permission');
    }

    const scopeFilter = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scopeFilter };
    if (franchiseId) {
      if (scopeFilter.franchiseId && scopeFilter.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }

    if (scope === 'self' || !canViewAll) {
      filter.userId = req.user!.sub;
    } else if (userId) {
      filter.userId = userId;
    }

    const timestampFilter = buildDateRange({ from, to, month });
    if (timestampFilter) filter.timestamp = mongoose.trusted(timestampFilter);

    const skip = (page - 1) * pageSize;
    const [total, logs, byTypeRows, activeUsers] = await Promise.all([
      TimeLog.countDocuments(filter),
      TimeLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('userId', 'fullName username role')
        .populate('franchiseId', 'name'),
      TimeLog.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      TimeLog.distinct('userId', filter),
    ]);

    const byType = byTypeRows.reduce<Record<string, number>>((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});

    res.json({
      logs,
      summary: {
        total,
        activeUsers: activeUsers.length,
        byType: {
          entree: byType.entree ?? 0,
          sortie: byType.sortie ?? 0,
          pause_debut: byType.pause_debut ?? 0,
          pause_fin: byType.pause_fin ?? 0,
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
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(1000),
  radiusMeters: z.coerce.number().int().min(20).max(5000).default(300),
});

router.get(
  '/map',
  requireAuth,
  requirePermission('timelogs.view.self', 'timelogs.view.all'),
  validate(mapQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { scope, franchiseId, userId, from, to, month, limit, radiusMeters } =
      req.query as unknown as z.infer<typeof mapQuery>;

    const canViewAll = isPermissionGranted(
      req.user!.role,
      'timelogs.view.all',
      req.user!.customPermissions,
    );
    if (scope === 'team' && !canViewAll) {
      throw forbidden('Team pointage view requires elevated permission');
    }

    const scopeFilter = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = {
      ...scopeFilter,
      'gps.lat': mongoose.trusted({ $ne: null }),
      'gps.lng': mongoose.trusted({ $ne: null }),
    };

    if (franchiseId) {
      if (scopeFilter.franchiseId && scopeFilter.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }

    if (scope === 'self' || !canViewAll) {
      filter.userId = req.user!.sub;
    } else if (userId) {
      filter.userId = userId;
    }

    const timestampFilter = buildDateRange({ from, to, month });
    if (timestampFilter) filter.timestamp = mongoose.trusted(timestampFilter);

    const logs = await TimeLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('userId', 'fullName username role')
      .populate('franchiseId', 'name gps');

    const points = logs
      .map((log) => {
        const lat = log.gps?.lat;
        const lng = log.gps?.lng;
        if (typeof lat !== 'number' || typeof lng !== 'number') return null;

        const franchise =
          typeof log.franchiseId === 'object' && log.franchiseId ? (log.franchiseId as any) : null;
        const fLat = franchise?.gps?.lat;
        const fLng = franchise?.gps?.lng;
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
          gps: { lat, lng, address: log.gps?.address || '' },
          user:
            typeof log.userId === 'object' && log.userId
              ? {
                  _id: (log.userId as any)._id?.toString?.() ?? '',
                  fullName: (log.userId as any).fullName || (log.userId as any).username || '',
                  role: (log.userId as any).role || '',
                }
              : null,
          franchise: franchise
            ? {
                _id: franchise._id?.toString?.() ?? '',
                name: franchise.name || '',
                gps:
                  typeof fLat === 'number' && typeof fLng === 'number'
                    ? { lat: fLat, lng: fLng }
                    : null,
              }
            : null,
          inZone: distance == null ? null : distance <= radiusMeters,
          distanceMeters: distance,
        };
      })
      .filter(Boolean);

    const zonesMap = new Map<
      string,
      { _id: string; name: string; gps: { lat: number; lng: number } }
    >();
    for (const point of points) {
      if (!point?.franchise?.gps) continue;
      zonesMap.set(point.franchise._id, {
        _id: point.franchise._id,
        name: point.franchise.name,
        gps: point.franchise.gps,
      });
    }

    res.json({
      points,
      zones: [...zonesMap.values()],
      summary: {
        total: points.length,
        inZone:
          points.filter((point) => point?.inZone === true).length,
        outOfZone:
          points.filter((point) => point?.inZone === false).length,
        unknownZone:
          points.filter((point) => point?.inZone == null).length,
        radiusMeters,
      },
    });
  }),
);

const exportQuery = z.object({
  scope: z.enum(['self', 'team']).default('team'),
  franchiseId: objectId.optional(),
  userId: objectId.optional(),
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
    const { scope, franchiseId, userId, from, to, month } =
      req.query as unknown as z.infer<typeof exportQuery>;

    const canViewAll = isPermissionGranted(
      req.user!.role,
      'timelogs.view.all',
      req.user!.customPermissions,
    );
    if (scope === 'team' && !canViewAll) throw forbidden();

    const scopeFilter = franchiseScopeFilter(req.user);
    const filter: Record<string, unknown> = { ...scopeFilter };
    if (franchiseId) {
      if (scopeFilter.franchiseId && scopeFilter.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (scope === 'self' || !canViewAll) {
      filter.userId = req.user!.sub;
    } else if (userId) {
      filter.userId = userId;
    }
    const timestampFilter = buildDateRange({ from, to, month });
    if (timestampFilter) filter.timestamp = mongoose.trusted(timestampFilter);

    const logs = await TimeLog.find(filter)
      .sort({ timestamp: 1 })
      .populate('userId', 'fullName username role')
      .populate('franchiseId', 'name');

    const filenameSuffix = month ?? from ?? new Date().toISOString().slice(0, 10);
    const lines = [
      '\uFEFFDate;Heure;Employe;Role;Franchise;Type;Latitude;Longitude;Adresse;Note',
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
