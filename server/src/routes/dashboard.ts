import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Product } from '../models/Product.js';
import { Stock } from '../models/Stock.js';
import { Sale } from '../models/Sale.js';
import { Transfer } from '../models/Transfer.js';
import { Franchise } from '../models/Franchise.js';
import { CashFlow } from '../models/CashFlow.js';
import { Installment } from '../models/Installment.js';
import { TimeLog } from '../models/TimeLog.js';
import { User } from '../models/User.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { NetworkPoint } from '../models/NetworkPoint.js';
import { CommercialZone } from '../models/CommercialZone.js';
import { Reception } from '../models/Reception.js';
import { LocationPing } from '../models/LocationPing.js';
import { isGlobalRole } from '../utils/roles.js';
import { WORKER_ROLES } from '../utils/pointage.js';
import { computeWorkedMinutes } from '../utils/workSession.js';
import { env } from '../config/env.js';
import { badRequest } from '../utils/AppError.js';

const router = Router();

const dashboardQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  franchiseId: z.string().refine((value) => mongoose.isValidObjectId(value), { message: 'Invalid franchiseId' }).optional(),
  paymentMethod: z.enum(['cash', 'card', 'transfer', 'installment', 'other']).optional(),
});

function dateStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateEnd(value: string) {
  return new Date(`${value}T23:59:59.999Z`);
}

function startOfWeek(date = new Date()) {
  const value = new Date(date);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  value.setHours(0, 0, 0, 0);
  return value;
}

async function buildPilotageStats(ranges: { periodStart: Date; periodEnd: Date }, selectedFranchiseId?: mongoose.Types.ObjectId | null) {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const saleMatch = {
    cancelledAt: null,
    createdAt: mongoose.trusted({ $gte: ranges.periodStart, $lte: ranges.periodEnd }),
    ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}),
  };
  const stockMatch = selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {};
  const cashMatch = {
    date: mongoose.trusted({ $gte: ranges.periodStart, $lte: ranges.periodEnd }),
    ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}),
  };
  const receptionMatch = {
    status: 'validated',
    receptionDate: mongoose.trusted({ $gte: ranges.periodStart, $lte: ranges.periodEnd }),
    ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}),
  };
  const networkPointMatch = {
    active: true,
    commercialId: mongoose.trusted({ $ne: null }),
    ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}),
  };
  const zoneMatch = {
    active: true,
    ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}),
  };

  const [
    caByFranchise,
    franchiseProfitability,
    stockValueAgg,
    cashAgg,
    purchasesBySupplier,
    commercialActivity,
    commercials,
    deadZones,
    dormantProducts,
  ] = await Promise.all([
    Sale.aggregate([
      { $match: saleMatch },
      { $group: { _id: '$franchiseId', ca: { $sum: '$total' }, salesCount: { $sum: 1 } } },
      { $sort: { ca: -1 } },
      { $limit: 12 },
      { $lookup: { from: 'franchises', localField: '_id', foreignField: '_id', as: 'franchise' } },
      { $unwind: { path: '$franchise', preserveNullAndEmptyArrays: true } },
      { $project: { franchiseId: '$_id', franchiseName: '$franchise.name', ca: 1, salesCount: 1 } },
    ]),
    Sale.aggregate([
      { $match: saleMatch },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.productId', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$franchiseId',
          ca: { $sum: '$items.total' },
          estimatedCost: { $sum: { $multiply: ['$items.quantity', { $ifNull: ['$product.purchasePrice', 0] }] } },
        },
      },
      { $addFields: { margin: { $subtract: ['$ca', '$estimatedCost'] } } },
      { $lookup: { from: 'franchises', localField: '_id', foreignField: '_id', as: 'franchise' } },
      { $unwind: { path: '$franchise', preserveNullAndEmptyArrays: true } },
      { $project: { franchiseId: '$_id', franchiseName: '$franchise.name', ca: 1, estimatedCost: 1, margin: 1 } },
      { $sort: { margin: -1 } },
      { $limit: 12 },
    ]),
    Stock.aggregate([
      { $match: stockMatch },
      { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      {
        $group: {
          _id: null,
          quantity: { $sum: '$quantity' },
          stockValue: { $sum: { $multiply: ['$quantity', { $ifNull: ['$product.purchasePrice', 0] }] } },
          stockSellValue: { $sum: { $multiply: ['$quantity', { $ifNull: ['$product.sellPrice', 0] }] } },
        },
      },
    ]),
    CashFlow.aggregate([
      { $match: cashMatch },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Reception.aggregate([
      { $match: receptionMatch },
      { $group: { _id: '$supplierId', total: { $sum: '$totalTtc' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 8 },
      { $lookup: { from: 'suppliers', localField: '_id', foreignField: '_id', as: 'supplier' } },
      { $unwind: { path: '$supplier', preserveNullAndEmptyArrays: true } },
      { $project: { supplierId: '$_id', supplierName: { $ifNull: ['$supplier.name', 'Sans fournisseur'] }, total: 1, count: 1 } },
    ]),
    NetworkPoint.aggregate([
      { $match: networkPointMatch },
      {
        $group: {
          _id: '$commercialId',
          points: { $sum: 1 },
          activePoints: { $sum: { $cond: [{ $in: ['$status', ['actif', 'contrat_signe']] }, 1, 0] } },
          won: { $sum: { $cond: [{ $eq: ['$leadStatus', 'won'] }, 1, 0] } },
          lastActivityAt: { $max: '$updatedAt' },
        },
      },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'commercial' } },
      { $unwind: { path: '$commercial', preserveNullAndEmptyArrays: true } },
      { $project: { commercialId: '$_id', commercialName: '$commercial.fullName', points: 1, activePoints: 1, won: 1, lastActivityAt: 1 } },
      { $sort: { activePoints: -1, points: -1 } },
      { $limit: 12 },
    ]),
    User.find({ role: 'commercial', active: true }).select('_id fullName username franchiseId').lean(),
    CommercialZone.aggregate([
      { $match: zoneMatch },
      { $lookup: { from: 'network_points', localField: '_id', foreignField: 'zoneId', as: 'points' } },
      {
        $project: {
          name: 1,
          color: 1,
          pointCount: { $size: '$points' },
          ownerCount: {
            $add: [
              { $cond: [{ $ifNull: ['$franchiseId', false] }, 1, 0] },
              { $size: { $ifNull: ['$assignedCommercialIds', []] } },
            ],
          },
        },
      },
      { $match: { $or: [{ pointCount: 0 }, { ownerCount: 0 }] } },
      { $sort: { ownerCount: 1, pointCount: 1, name: 1 } },
      { $limit: 12 },
    ]),
    Product.aggregate([
      { $match: { active: true } },
      {
        $lookup: {
          from: 'sales',
          let: { productId: '$_id' },
          pipeline: [
            { $match: { cancelledAt: null, createdAt: { $gte: ninetyDaysAgo } } },
            { $unwind: '$items' },
            { $match: { $expr: { $eq: ['$items.productId', '$$productId'] } } },
            { $limit: 1 },
          ],
          as: 'recentSales',
        },
      },
      { $match: { recentSales: { $size: 0 } } },
      { $project: { name: 1, reference: 1, barcode: 1, sellPrice: 1, purchasePrice: 1 } },
      { $limit: 10 },
    ]),
  ]);

  const activityByCommercial = new Map(commercialActivity.map((row) => [row.commercialId?.toString?.() ?? '', row]));
  const scopedCommercials = selectedFranchiseId
    ? commercials.filter((commercial) => {
        const id = commercial._id.toString();
        return commercial.franchiseId?.toString?.() === selectedFranchiseId.toString() || activityByCommercial.has(id);
      })
    : commercials;
  const dormantCommercials = scopedCommercials
    .map((commercial) => {
      const activity = activityByCommercial.get(commercial._id.toString());
      const lastActivityAt = activity?.lastActivityAt ?? null;
      const isDormant = !lastActivityAt || new Date(lastActivityAt).getTime() < thirtyDaysAgo.getTime();
      return {
        commercialId: commercial._id.toString(),
        commercialName: commercial.fullName || commercial.username,
        points: activity?.points ?? 0,
        lastActivityAt,
        isDormant,
      };
    })
    .filter((row) => row.isDormant)
    .slice(0, 8);

  const stock = stockValueAgg[0] ?? { quantity: 0, stockValue: 0, stockSellValue: 0 };
  const encaissements = cashAgg.find((row) => row._id === 'encaissement')?.total ?? 0;
  const decaissements = cashAgg.find((row) => row._id === 'decaissement')?.total ?? 0;

  return {
    caByFranchise,
    franchiseProfitability,
    bestCommercial: commercialActivity[0] ?? null,
    dormantCommercials,
    deadZones,
    dormantProducts,
    purchasesBySupplier,
    stock: {
      quantity: stock.quantity ?? 0,
      value: stock.stockValue ?? 0,
      sellValue: stock.stockSellValue ?? 0,
      marginPotential: (stock.stockSellValue ?? 0) - (stock.stockValue ?? 0),
    },
    treasury: {
      encaissements,
      decaissements,
      net: encaissements - decaissements,
    },
  };
}

async function buildFranchiseDashboardStats(
  franchiseId: mongoose.Types.ObjectId,
  ranges: { periodStart: Date; periodEnd: Date },
  paymentMethod?: z.infer<typeof dashboardQuery>['paymentMethod'],
) {
  const saleMatch = {
    cancelledAt: null,
    franchiseId,
    createdAt: mongoose.trusted({ $gte: ranges.periodStart, $lte: ranges.periodEnd }),
    ...(paymentMethod ? { paymentMethod } : {}),
  };
  const [salesAgg, stockAgg, lowStockAgg, cashAgg, purchasesAgg, topMarginProducts] = await Promise.all([
    Sale.aggregate([
      { $match: saleMatch },
      { $group: { _id: null, ca: { $sum: '$total' }, salesCount: { $sum: 1 } } },
    ]),
    Stock.aggregate([
      { $match: { franchiseId } },
      { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      {
        $group: {
          _id: null,
          quantity: { $sum: '$quantity' },
          stockCost: { $sum: { $multiply: ['$quantity', { $ifNull: ['$product.purchasePrice', 0] }] } },
          stockSellValue: { $sum: { $multiply: ['$quantity', { $ifNull: ['$product.sellPrice', 0] }] } },
        },
      },
    ]),
    Stock.aggregate([
      { $match: { franchiseId } },
      { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $match: { $expr: { $lte: ['$quantity', '$product.lowStockThreshold'] } } },
      { $count: 'count' },
    ]),
    CashFlow.aggregate([
      { $match: { franchiseId, date: mongoose.trusted({ $gte: ranges.periodStart, $lte: ranges.periodEnd }) } },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Reception.aggregate([
      { $match: { franchiseId, status: 'validated', receptionDate: mongoose.trusted({ $gte: ranges.periodStart, $lte: ranges.periodEnd }) } },
      { $group: { _id: null, total: { $sum: '$totalTtc' }, count: { $sum: 1 } } },
    ]),
    Sale.aggregate([
      { $match: saleMatch },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.productId', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$items.productId',
          name: { $first: '$product.name' },
          quantity: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.total' },
          estimatedCost: { $sum: { $multiply: ['$items.quantity', { $ifNull: ['$product.purchasePrice', 0] }] } },
        },
      },
      { $addFields: { margin: { $subtract: ['$revenue', '$estimatedCost'] } } },
      { $sort: { margin: -1, revenue: -1 } },
      { $limit: 5 },
      { $project: { productId: '$_id', name: { $ifNull: ['$name', 'Produit supprime'] }, quantity: 1, revenue: 1, estimatedCost: 1, margin: 1 } },
    ]),
  ]);

  const stock = stockAgg[0] ?? { quantity: 0, stockCost: 0, stockSellValue: 0 };
  const sales = salesAgg[0] ?? { ca: 0, salesCount: 0 };
  const encaissements = cashAgg.find((row) => row._id === 'encaissement')?.total ?? 0;
  const decaissements = cashAgg.find((row) => row._id === 'decaissement')?.total ?? 0;

  return {
    ca: sales.ca ?? 0,
    salesCount: sales.salesCount ?? 0,
    averageTicket: (sales.salesCount ?? 0) > 0 ? Math.round(((sales.ca ?? 0) / sales.salesCount) * 100) / 100 : 0,
    stockQuantity: stock.quantity ?? 0,
    stockCost: stock.stockCost ?? 0,
    stockSellValue: stock.stockSellValue ?? 0,
    stockMarginPotential: (stock.stockSellValue ?? 0) - (stock.stockCost ?? 0),
    lowStockCount: lowStockAgg[0]?.count ?? 0,
    purchasesTotal: purchasesAgg[0]?.total ?? 0,
    purchasesCount: purchasesAgg[0]?.count ?? 0,
    treasury: {
      encaissements,
      decaissements,
      net: encaissements - decaissements,
    },
    topMarginProducts,
  };
}

async function buildCommercialDirectorStats(
  ranges: { periodStart: Date; periodEnd: Date; startOfWeek: Date },
  selectedFranchiseId?: mongoose.Types.ObjectId | null,
) {
  const pointMatch = {
    active: true,
    ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}),
  };
  const zoneMatch = {
    active: true,
    ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}),
  };
  const pingMatch = {
    role: 'commercial',
    timestamp: mongoose.trusted({ $gte: ranges.periodStart, $lte: ranges.periodEnd }),
    ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}),
  };
  const weeklyPingMatch = {
    role: 'commercial',
    timestamp: mongoose.trusted({ $gte: ranges.startOfWeek, $lte: ranges.periodEnd }),
    ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}),
  };

  const [
    commercialCount,
    activeCommercialIds,
    outOfZonePings,
    pingsCount,
    zones,
    pointsByStatus,
    commercialActivity,
    commercials,
    latestPings,
  ] = await Promise.all([
    User.countDocuments({ role: 'commercial', active: true, ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}) }),
    LocationPing.distinct('userId', weeklyPingMatch),
    LocationPing.countDocuments({ ...pingMatch, inZone: false }),
    LocationPing.countDocuments(pingMatch),
    CommercialZone.find(zoneMatch).select('_id name color assignedCommercialIds franchiseId').lean(),
    NetworkPoint.aggregate([
      { $match: pointMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    NetworkPoint.aggregate([
      { $match: { ...pointMatch, commercialId: mongoose.trusted({ $ne: null }) } },
      {
        $group: {
          _id: '$commercialId',
          points: { $sum: 1 },
          activePoints: { $sum: { $cond: [{ $in: ['$status', ['actif', 'contrat_signe']] }, 1, 0] } },
          won: { $sum: { $cond: [{ $eq: ['$leadStatus', 'won'] }, 1, 0] } },
          lastActivityAt: { $max: '$updatedAt' },
        },
      },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'commercial' } },
      { $unwind: { path: '$commercial', preserveNullAndEmptyArrays: true } },
      { $project: { commercialId: '$_id', commercialName: '$commercial.fullName', points: 1, activePoints: 1, won: 1, lastActivityAt: 1 } },
      { $sort: { activePoints: -1, points: -1 } },
      { $limit: 10 },
    ]),
    User.find({ role: 'commercial', active: true, ...(selectedFranchiseId ? { franchiseId: selectedFranchiseId } : {}) })
      .select('_id fullName username franchiseId')
      .lean(),
    LocationPing.find(pingMatch)
      .sort({ timestamp: -1 })
      .limit(8)
      .populate('userId', 'fullName username role')
      .populate('zoneId', 'name color')
      .lean(),
  ]);

  const dormantCutoff = new Date();
  dormantCutoff.setDate(dormantCutoff.getDate() - 30);
  const activityByCommercial = new Map(commercialActivity.map((row) => [row.commercialId?.toString?.() ?? '', row]));
  const dormantCommercials = commercials
    .map((commercial) => {
      const activity = activityByCommercial.get(commercial._id.toString());
      return {
        commercialId: commercial._id.toString(),
        commercialName: commercial.fullName || commercial.username,
        points: activity?.points ?? 0,
        activePoints: activity?.activePoints ?? 0,
        won: activity?.won ?? 0,
        lastActivityAt: activity?.lastActivityAt ?? null,
      };
    })
    .filter((row) => !row.lastActivityAt || new Date(row.lastActivityAt).getTime() < dormantCutoff.getTime())
    .slice(0, 8);

  return {
    commercialCount,
    activeCommercialsThisWeek: activeCommercialIds.length,
    zonesCount: zones.length,
    unassignedZones: zones.filter((zone) => (zone.assignedCommercialIds?.length ?? 0) === 0).length,
    networkPoints: pointsByStatus.reduce((sum, row) => sum + (row.count ?? 0), 0),
    outOfZonePings,
    pingsCount,
    pointsByStatus: pointsByStatus.map((row) => ({ status: row._id, count: row.count ?? 0 })),
    bestCommercial: commercialActivity[0] ?? null,
    dormantCommercials,
    latestPings: latestPings.map((ping) => ({
      _id: ping._id.toString(),
      timestamp: ping.timestamp,
      inZone: ping.inZone,
      accuracy: ping.gps?.accuracy ?? null,
      commercialName:
        typeof ping.userId === 'object' && ping.userId
          ? ((ping.userId as { fullName?: string; username?: string }).fullName ??
            (ping.userId as { username?: string }).username ??
            '')
          : '',
      zoneName:
        typeof ping.zoneId === 'object' && ping.zoneId
          ? ((ping.zoneId as { name?: string }).name ?? '')
          : '',
    })),
  };
}

async function buildRoleStats(
  user: NonNullable<Express.Request['user']>,
  ranges: { startOfDay: Date; periodStart: Date; periodEnd: Date; startOfWeek: Date },
  options: { selectedFranchiseId?: mongoose.Types.ObjectId | null; paymentMethod?: z.infer<typeof dashboardQuery>['paymentMethod'] } = {},
) {
  if (user.role === 'ceo') {
    return { pilotage: await buildPilotageStats(ranges, options.selectedFranchiseId) };
  }

  if (['admin', 'superadmin', 'manager'].includes(user.role)) {
    return { pilotage: await buildPilotageStats(ranges, options.selectedFranchiseId) };
  }

  if (user.role === 'commercial_director') {
    return { commercialDirector: await buildCommercialDirectorStats(ranges, options.selectedFranchiseId) };
  }

  if (user.role === 'franchise' && options.selectedFranchiseId) {
    return {
      franchise: await buildFranchiseDashboardStats(options.selectedFranchiseId, ranges, options.paymentMethod),
    };
  }

  if (user.role === 'hr_admin') {
    const workers = await User.find({ role: mongoose.trusted({ $in: [...WORKER_ROLES] }), active: true }).select('_id').lean();
    const workerIds = workers.map((worker) => worker._id);
    const [logs, pendingLeaveRequests, byRoleRows, latestPunches, outOfZoneCommercialPings] = await Promise.all([
      TimeLog.find({
        userId: mongoose.trusted({ $in: workerIds }),
        timestamp: mongoose.trusted({ $gte: ranges.startOfWeek, $lte: ranges.periodEnd }),
      }).select('userId type timestamp').lean(),
      LeaveRequest.countDocuments({ status: 'pending' }),
      User.aggregate([
        { $match: { role: { $in: WORKER_ROLES }, active: true } },
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      TimeLog.find({ userId: mongoose.trusted({ $in: workerIds }) })
        .sort({ timestamp: -1 })
        .limit(8)
        .populate('userId', 'fullName username role')
        .populate('franchiseId', 'name')
        .lean(),
      LocationPing.countDocuments({
        role: 'commercial',
        inZone: false,
        timestamp: mongoose.trusted({ $gte: ranges.periodStart, $lte: ranges.periodEnd }),
      }),
    ]);
    const logsByUser = new Map<string, Array<{ type: string; timestamp: Date }>>();
    for (const log of logs) {
      const id = log.userId?.toString?.() ?? '';
      if (!id) continue;
      const rows = logsByUser.get(id) ?? [];
      rows.push({ type: log.type, timestamp: log.timestamp });
      logsByUser.set(id, rows);
    }
    const computed = [...logsByUser.values()].map((rows) => computeWorkedMinutes(rows));
    return {
      hr: {
        employeeCount: workers.length,
        atWorkCount: computed.filter((row) => row.activeShift).length,
        pendingLeaveRequests,
        weekHours: Math.round(computed.reduce((sum, row) => sum + row.workedMinutes, 0) / 60),
        outOfZoneCommercialPings,
        byRole: byRoleRows.map((row) => ({ role: row._id, count: row.count ?? 0 })),
        latestPunches: latestPunches.map((log) => ({
          _id: log._id.toString(),
          type: log.type,
          timestamp: log.timestamp,
          employeeName:
            typeof log.userId === 'object' && log.userId
              ? ((log.userId as { fullName?: string; username?: string }).fullName ??
                (log.userId as { username?: string }).username ??
                '')
              : '',
          role:
            typeof log.userId === 'object' && log.userId
              ? ((log.userId as { role?: string }).role ?? '')
              : '',
          site:
            typeof log.franchiseId === 'object' && log.franchiseId
              ? ((log.franchiseId as { name?: string }).name ?? '')
              : env.SIEGE_NAME,
        })),
      },
    };
  }

  if (user.role === 'commercial') {
    const commercialFilter = user.franchiseId
      ? { $or: [{ commercialId: user.sub }, { franchiseId: user.franchiseId }] }
      : { commercialId: user.sub };
    const [networkPoints, pointsWithGps, zones] = await Promise.all([
      NetworkPoint.countDocuments({ active: true, ...commercialFilter }),
      NetworkPoint.countDocuments({
        active: true,
        ...commercialFilter,
        'gps.lat': mongoose.trusted({ $ne: null }),
        'gps.lng': mongoose.trusted({ $ne: null }),
      }),
      CommercialZone.countDocuments({ active: true, assignedCommercialIds: user.sub }),
    ]);
    return { commercial: { networkPoints, zones, pointsWithGps } };
  }

  if (user.role === 'siege_employee') {
    const [logs, pendingLeaveRequests] = await Promise.all([
      TimeLog.find({ userId: user.sub, timestamp: mongoose.trusted({ $gte: ranges.startOfWeek }) }).sort({ timestamp: 1 }).select('type timestamp').lean(),
      LeaveRequest.countDocuments({ userId: user.sub, status: 'pending' }),
    ]);
    const worked = computeWorkedMinutes(logs);
    const lastLog = logs[logs.length - 1] ?? null;
    return {
      employee: {
        workedMinutesThisWeek: worked.workedMinutes,
        activeShift: worked.activeShift,
        pendingLeaveRequests,
        siteName: env.SIEGE_NAME,
        lastType: lastLog?.type ?? null,
        lastTimestamp: lastLog?.timestamp ?? null,
      },
    };
  }

  return {};
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsedQuery = dashboardQuery.safeParse(req.query);
    if (!parsedQuery.success) throw badRequest('Invalid dashboard filters', parsedQuery.error.flatten());
    const input = parsedQuery.data;
    const user = req.user!;
    const isGlobal = isGlobalRole(user.role);
    const fid = user.franchiseId ? new mongoose.Types.ObjectId(user.franchiseId) : null;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodStart = input.from ? dateStart(input.from) : startOfMonth;
    const periodEnd = input.to ? dateEnd(input.to) : now;
    if (periodStart.getTime() > periodEnd.getTime()) throw badRequest('La date debut doit etre avant la date fin');
    const startOfWeekDate = startOfWeek(now);
    const sellerScoped = user.role === 'seller' || user.role === 'vendeur';
    const opsDataAllowed = !['hr_admin', 'commercial', 'siege_employee'].includes(user.role);
    const selectedFid =
      isGlobal && input.franchiseId ? new mongoose.Types.ObjectId(input.franchiseId) : fid;
    const roleStats = await buildRoleStats(
      user,
      { startOfDay, periodStart, periodEnd, startOfWeek: startOfWeekDate },
      { selectedFranchiseId: selectedFid, paymentMethod: input.paymentMethod },
    );

    if (!isGlobal && !fid) {
      res.json({
        kpis: {
          productCount: 0,
          franchiseCount: 0,
          todaySalesTotal: 0,
          todaySalesCount: 0,
          monthSalesTotal: 0,
          monthSalesCount: 0,
          lowStockCount: 0,
          pendingTransfers: 0,
        },
        lowStock: [],
        recentSales: [],
        roleProfile: {
          role: user.role,
          scope: 'franchise',
          primaryGoal: 'Affectez une franchise a cet utilisateur pour activer le dashboard',
          recommendedActions: ['Associer la franchise dans la gestion des utilisateurs'],
        },
        roleStats,
        reports: {
          topProducts: [],
          paymentBreakdown: [],
          cashToday: { in: 0, out: 0, net: 0 },
          pendingInstallments: 0,
        },
      });
      return;
    }

    const stockFilter = selectedFid ? { franchiseId: selectedFid } : {};
    const saleFilter = sellerScoped
      ? { franchiseId: fid!, userId: new mongoose.Types.ObjectId(user.sub) }
      : isGlobal && !selectedFid
        ? {}
        : { franchiseId: selectedFid! };
    const paymentFilter = input.paymentMethod ? { paymentMethod: input.paymentMethod } : {};
    const periodRange = mongoose.trusted({ $gte: periodStart, $lte: periodEnd });
    const todayRange = mongoose.trusted({ $gte: startOfDay, $lte: now });
    const periodSaleFilter = { ...saleFilter, ...paymentFilter, cancelledAt: null, createdAt: periodRange };
    const todaySaleFilter = { ...saleFilter, ...paymentFilter, cancelledAt: null, createdAt: todayRange };
    const cashFlowFilter = selectedFid ? { franchiseId: selectedFid } : {};
    const installmentFilter = selectedFid ? { franchiseId: selectedFid } : {};

    const [
      productCount,
      franchiseCount,
      todaySalesAgg,
      monthSalesAgg,
      lowStockItems,
      pendingTransfers,
      recentSales,
      topProducts,
      paymentBreakdown,
      cashTodayAgg,
      pendingInstallments,
    ] = await Promise.all([
      opsDataAllowed ? Product.countDocuments({ active: true }) : Promise.resolve(0),
      opsDataAllowed ? Franchise.countDocuments({ active: true }) : Promise.resolve(0),
      opsDataAllowed ? Sale.aggregate([
        { $match: todaySaleFilter },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]) : Promise.resolve([]),
      opsDataAllowed ? Sale.aggregate([
        { $match: periodSaleFilter },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]) : Promise.resolve([]),
      opsDataAllowed ? Stock.aggregate([
        { $match: stockFilter },
        {
          $lookup: {
            from: 'products',
            localField: 'productId',
            foreignField: '_id',
            as: 'product',
          },
        },
        { $unwind: '$product' },
        { $match: { $expr: { $lte: ['$quantity', '$product.lowStockThreshold'] } } },
        { $limit: 20 },
        {
          $lookup: {
            from: 'franchises',
            localField: 'franchiseId',
            foreignField: '_id',
            as: 'franchise',
          },
        },
        { $unwind: { path: '$franchise', preserveNullAndEmptyArrays: true } },
      ]) : Promise.resolve([]),
      opsDataAllowed ? Transfer.countDocuments(
        isGlobal
          ? { status: 'pending' }
          : {
              status: 'pending',
              $or: [{ sourceFranchiseId: fid }, { destFranchiseId: fid }],
            },
      ) : Promise.resolve(0),
      opsDataAllowed ? Sale.find(periodSaleFilter)
        .sort({ createdAt: -1 })
        .limit(8)
        .populate('userId', 'username fullName')
        .populate('franchiseId', 'name') : Promise.resolve([]),
      opsDataAllowed ? Sale.aggregate([
        { $match: periodSaleFilter },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.total' },
          },
        },
        { $sort: { quantity: -1, revenue: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product',
          },
        },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      ]) : Promise.resolve([]),
      opsDataAllowed ? Sale.aggregate([
        { $match: periodSaleFilter },
        {
          $group: {
            _id: '$paymentMethod',
            total: { $sum: '$total' },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]) : Promise.resolve([]),
      opsDataAllowed ? CashFlow.aggregate([
        { $match: { ...cashFlowFilter, date: { $gte: periodStart, $lte: periodEnd } } },
        {
          $group: {
            _id: '$type',
            amount: { $sum: '$amount' },
          },
        },
      ]) : Promise.resolve([]),
      opsDataAllowed ? Installment.countDocuments({ ...installmentFilter, status: mongoose.trusted({ $in: ['pending', 'late'] }) }) : Promise.resolve(0),
    ]);

    const cashIn = cashTodayAgg.find((entry) => entry._id === 'encaissement')?.amount ?? 0;
    const cashOut = cashTodayAgg.find((entry) => entry._id === 'decaissement')?.amount ?? 0;
    const roleProfile = isGlobal
      ? {
          scope: 'global',
          primaryGoal: 'Piloter la performance multi-franchise',
          recommendedActions: [
            'Suivre les produits critiques et transferer les stocks',
            'Verifier les echeances en retard et relancer',
            'Analyser les modes de paiement et la marge',
          ],
        }
      : {
          scope: 'franchise',
          primaryGoal: 'Optimiser la performance de la franchise',
          recommendedActions: [
            'Traiter les ruptures a risque',
            'Verifier les ventes du jour vs tresorerie',
            'Suivre les echeances clients en attente',
          ],
        };

    res.json({
      kpis: {
        productCount,
        franchiseCount,
        todaySalesTotal: todaySalesAgg[0]?.total ?? 0,
        todaySalesCount: todaySalesAgg[0]?.count ?? 0,
        monthSalesTotal: monthSalesAgg[0]?.total ?? 0,
        monthSalesCount: monthSalesAgg[0]?.count ?? 0,
        lowStockCount: lowStockItems.length,
        pendingTransfers,
      },
      lowStock: lowStockItems,
      recentSales,
      roleProfile: {
        role: user.role,
        ...roleProfile,
      },
      roleStats: {
        ...roleStats,
        ...(sellerScoped
          ? {
              seller: {
                monthSalesCount: monthSalesAgg[0]?.count ?? 0,
                monthSalesTotal: monthSalesAgg[0]?.total ?? 0,
                todaySalesCount: todaySalesAgg[0]?.count ?? 0,
                todaySalesTotal: todaySalesAgg[0]?.total ?? 0,
                averageTicket:
                  (monthSalesAgg[0]?.count ?? 0) > 0
                    ? Math.round(((monthSalesAgg[0]?.total ?? 0) / (monthSalesAgg[0]?.count ?? 1)) * 100) / 100
                    : 0,
              },
            }
          : {}),
      },
      reports: {
        topProducts: topProducts.map((entry) => ({
          productId: entry._id,
          name: entry.product?.name ?? 'Produit supprime',
          quantity: entry.quantity ?? 0,
          revenue: entry.revenue ?? 0,
        })),
        paymentBreakdown: paymentBreakdown.map((entry) => ({
          paymentMethod: entry._id,
          count: entry.count ?? 0,
          total: entry.total ?? 0,
        })),
        cashToday: {
          in: cashIn,
          out: cashOut,
          net: cashIn - cashOut,
        },
        pendingInstallments,
      },
    });
  }),
);

export default router;
