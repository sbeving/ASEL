import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { Sale } from '../models/Sale.js';
import { Stock } from '../models/Stock.js';
import { Movement } from '../models/Movement.js';

function toObjectIds(ids: string[]) {
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

function marginFromPrices(purchasePrice: number, sellPrice: number) {
  const marginAmount = Math.round((sellPrice - purchasePrice) * 100) / 100;
  const marginPercent = sellPrice > 0 ? Math.round((marginAmount / sellPrice) * 10000) / 100 : 0;

  return { marginAmount, marginPercent };
}

export async function attachProductListMetrics<T extends { _id: mongoose.Types.ObjectId | string; purchasePrice: number; sellPrice: number }>(
  products: T[],
  franchiseScopeId?: string | null,
) {
  if (products.length === 0) return [];

  const productIds = products.map((product) => product._id.toString());
  const scopedMatch = franchiseScopeId ? { franchiseId: new mongoose.Types.ObjectId(franchiseScopeId) } : {};
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(now.getDate() - 90);

  const [stockRows, salesRows] = await Promise.all([
    Stock.aggregate<{
      _id: mongoose.Types.ObjectId;
      stockTotal: number;
    }>([
      {
        $match: {
          ...scopedMatch,
          productId: { $in: toObjectIds(productIds) },
        },
      },
      {
        $group: {
          _id: '$productId',
          stockTotal: { $sum: '$quantity' },
        },
      },
    ]),
    Sale.aggregate<{
      _id: mongoose.Types.ObjectId;
      sales30d: number;
      sales90d: number;
      revenue30d: number;
      revenue90d: number;
    }>([
      {
        $match: {
          ...scopedMatch,
          createdAt: { $gte: ninetyDaysAgo },
        },
      },
      { $unwind: '$items' },
      {
        $match: {
          'items.productId': { $in: toObjectIds(productIds) },
        },
      },
      {
        $group: {
          _id: '$items.productId',
          sales30d: {
            $sum: {
              $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, '$items.quantity', 0],
            },
          },
          sales90d: { $sum: '$items.quantity' },
          revenue30d: {
            $sum: {
              $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, '$items.total', 0],
            },
          },
          revenue90d: { $sum: '$items.total' },
        },
      },
    ]),
  ]);

  const stockMap = new Map(stockRows.map((row) => [row._id.toString(), row.stockTotal]));
  const salesMap = new Map(salesRows.map((row) => [row._id.toString(), row]));

  return products.map((product) => {
    const sales = salesMap.get(product._id.toString());
    const margin = marginFromPrices(product.purchasePrice, product.sellPrice);

    return {
      ...product,
      stockTotal: stockMap.get(product._id.toString()) ?? 0,
      sales30d: sales?.sales30d ?? 0,
      sales90d: sales?.sales90d ?? 0,
      revenue30d: sales?.revenue30d ?? 0,
      revenue90d: sales?.revenue90d ?? 0,
      marginAmount: margin.marginAmount,
      marginPercent: margin.marginPercent,
    };
  });
}

export async function getProductOverview(productId: string, franchiseScopeId?: string | null) {
  const product = await Product.findById(productId)
    .populate('categoryId', 'name')
    .populate('supplierId', 'name')
    .lean();

  if (!product) return null;

  const scopedMatch = franchiseScopeId ? { franchiseId: new mongoose.Types.ObjectId(franchiseScopeId) } : {};
  const productObjectId = new mongoose.Types.ObjectId(productId);
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(now.getDate() - 90);

  const [stockByFranchise, recentMovements, salesStatsRows] = await Promise.all([
    Stock.aggregate<{
      franchiseId: string;
      franchiseName: string;
      quantity: number;
    }>([
      {
        $match: {
          ...scopedMatch,
          productId: productObjectId,
        },
      },
      {
        $lookup: {
          from: 'franchises',
          localField: 'franchiseId',
          foreignField: '_id',
          as: 'franchise',
        },
      },
      { $unwind: '$franchise' },
      {
        $project: {
          _id: 0,
          franchiseId: '$franchise._id',
          franchiseName: '$franchise.name',
          quantity: '$quantity',
        },
      },
      { $sort: { franchiseName: 1 } },
    ]),
    Movement.find({
      ...scopedMatch,
      productId,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('franchiseId', 'name')
      .populate('userId', 'fullName username')
      .lean(),
    Sale.aggregate<{
      _id: null;
      sales30d: number;
      sales90d: number;
      revenue30d: number;
      revenue90d: number;
    }>([
      {
        $match: {
          ...scopedMatch,
          createdAt: { $gte: ninetyDaysAgo },
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.productId': productObjectId } },
      {
        $group: {
          _id: null,
          sales30d: {
            $sum: {
              $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, '$items.quantity', 0],
            },
          },
          sales90d: { $sum: '$items.quantity' },
          revenue30d: {
            $sum: {
              $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, '$items.total', 0],
            },
          },
          revenue90d: { $sum: '$items.total' },
        },
      },
    ]),
  ]);

  const salesStats = salesStatsRows[0] ?? {
    sales30d: 0,
    sales90d: 0,
    revenue30d: 0,
    revenue90d: 0,
  };
  const totalStock = stockByFranchise.reduce((sum, row) => sum + row.quantity, 0);
  const margin = marginFromPrices(product.purchasePrice ?? 0, product.sellPrice ?? 0);

  return {
    product: {
      ...product,
      stockTotal: totalStock,
      marginAmount: margin.marginAmount,
      marginPercent: margin.marginPercent,
    },
    stockByFranchise,
    recentMovements,
    salesStats,
  };
}
