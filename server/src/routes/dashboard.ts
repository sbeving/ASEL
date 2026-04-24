import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Product } from '../models/Product.js';
import { Stock } from '../models/Stock.js';
import { Sale } from '../models/Sale.js';
import { Transfer } from '../models/Transfer.js';
import { Franchise } from '../models/Franchise.js';
import { CashFlow } from '../models/CashFlow.js';
import { Installment } from '../models/Installment.js';
import { isGlobalRole } from '../utils/roles.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const isGlobal = isGlobalRole(user.role);
    const fid = user.franchiseId ? new mongoose.Types.ObjectId(user.franchiseId) : null;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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
        reports: {
          topProducts: [],
          paymentBreakdown: [],
          cashToday: { in: 0, out: 0, net: 0 },
          pendingInstallments: 0,
        },
      });
      return;
    }

    const stockFilter = isGlobal ? {} : { franchiseId: fid! };
    const saleFilter = isGlobal ? {} : { franchiseId: fid! };
    const cashFlowFilter = isGlobal ? {} : { franchiseId: fid! };
    const installmentFilter = isGlobal ? {} : { franchiseId: fid! };

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
      Sale.aggregate([
        { $match: { ...saleFilter, createdAt: { $gte: startOfMonth } } },
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
      ]),
      Sale.aggregate([
        { $match: { ...saleFilter, createdAt: { $gte: startOfMonth } } },
        {
          $group: {
            _id: '$paymentMethod',
            total: { $sum: '$total' },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]),
      CashFlow.aggregate([
        { $match: { ...cashFlowFilter, date: { $gte: startOfDay } } },
        {
          $group: {
            _id: '$type',
            amount: { $sum: '$amount' },
          },
        },
      ]),
      Installment.countDocuments({ ...installmentFilter, status: { $in: ['pending', 'late'] } }),
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
