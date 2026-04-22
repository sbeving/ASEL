import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Product } from '../models/Product.js';
import { Stock } from '../models/Stock.js';
import { Sale } from '../models/Sale.js';
import { Transfer } from '../models/Transfer.js';
import { Franchise } from '../models/Franchise.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const isGlobal = user.role === 'admin' || user.role === 'manager';
    const fid = user.franchiseId ? new mongoose.Types.ObjectId(user.franchiseId) : null;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const stockFilter = isGlobal ? {} : { franchiseId: fid };
    const saleFilter = isGlobal ? {} : { franchiseId: fid };

    const [
      productCount,
      franchiseCount,
      todaySalesAgg,
      monthSalesAgg,
      lowStockItems,
      pendingTransfers,
      recentSales,
    ] = await Promise.all([
      Product.countDocuments({ active: true }),
      Franchise.countDocuments({ active: true }),
      Sale.aggregate([
        { $match: { ...saleFilter, createdAt: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      Sale.aggregate([
        { $match: { ...saleFilter, createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      Stock.aggregate([
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
      ]),
      Transfer.countDocuments(
        isGlobal
          ? { status: 'pending' }
          : {
              status: 'pending',
              $or: [{ sourceFranchiseId: fid }, { destFranchiseId: fid }],
            },
      ),
      Sale.find(saleFilter)
        .sort({ createdAt: -1 })
        .limit(8)
        .populate('userId', 'username fullName')
        .populate('franchiseId', 'name'),
    ]);

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
    });
  }),
);

export default router;
