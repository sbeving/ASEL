import mongoose from 'mongoose';
import { Client } from '../models/Client.js';
import { Sale } from '../models/Sale.js';
import { Installment } from '../models/Installment.js';

function toObjectIds(ids: string[]) {
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

export async function attachClientListMetrics<T extends { _id: mongoose.Types.ObjectId | string }>(
  clients: T[],
  franchiseScopeId?: string | null,
) {
  if (clients.length === 0) return [];

  const clientIds = clients.map((client) => client._id.toString());
  const scopedMatch = franchiseScopeId ? { franchiseId: new mongoose.Types.ObjectId(franchiseScopeId) } : {};

  const [salesRows, installmentRows] = await Promise.all([
    Sale.aggregate<{
      _id: mongoose.Types.ObjectId;
      totalSpent: number;
      saleCount: number;
      lastSaleAt: Date | null;
    }>([
      {
        $match: {
          ...scopedMatch,
          clientId: { $in: toObjectIds(clientIds) },
        },
      },
      {
        $group: {
          _id: '$clientId',
          totalSpent: { $sum: '$total' },
          saleCount: { $sum: 1 },
          lastSaleAt: { $max: '$createdAt' },
        },
      },
    ]),
    Installment.aggregate<{
      _id: mongoose.Types.ObjectId;
      balanceDue: number;
      pendingInstallments: number;
      lateInstallments: number;
    }>([
      {
        $match: {
          ...scopedMatch,
          clientId: { $in: toObjectIds(clientIds) },
        },
      },
      {
        $group: {
          _id: '$clientId',
          balanceDue: {
            $sum: {
              $cond: [{ $in: ['$status', ['pending', 'late']] }, '$amount', 0],
            },
          },
          pendingInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0],
            },
          },
          lateInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'late'] }, 1, 0],
            },
          },
        },
      },
    ]),
  ]);

  const salesMap = new Map(salesRows.map((row) => [row._id.toString(), row]));
  const installmentMap = new Map(installmentRows.map((row) => [row._id.toString(), row]));

  return clients.map((client) => {
    const sales = salesMap.get(client._id.toString());
    const installments = installmentMap.get(client._id.toString());

    return {
      ...client,
      totalSpent: sales?.totalSpent ?? 0,
      saleCount: sales?.saleCount ?? 0,
      lastSaleAt: sales?.lastSaleAt ?? null,
      balanceDue: installments?.balanceDue ?? 0,
      pendingInstallments: installments?.pendingInstallments ?? 0,
      lateInstallments: installments?.lateInstallments ?? 0,
    };
  });
}

export async function getClientOverview(clientId: string, franchiseScopeId?: string | null) {
  const client = await Client.findById(clientId).populate('franchiseId', 'name').lean();
  if (!client) return null;

  if (franchiseScopeId && client.franchiseId && client.franchiseId._id.toString() !== franchiseScopeId) {
    return 'forbidden' as const;
  }

  const scopedMatch = franchiseScopeId ? { franchiseId: new mongoose.Types.ObjectId(franchiseScopeId) } : {};
  const clientObjectId = new mongoose.Types.ObjectId(clientId);

  const [salesSummaryRows, installmentSummaryRows, recentSales, recentInstallments] = await Promise.all([
    Sale.aggregate<{
      _id: null;
      totalSpent: number;
      saleCount: number;
      lastSaleAt: Date | null;
    }>([
      {
        $match: {
          ...scopedMatch,
          clientId: clientObjectId,
        },
      },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$total' },
          saleCount: { $sum: 1 },
          lastSaleAt: { $max: '$createdAt' },
        },
      },
    ]),
    Installment.aggregate<{
      _id: null;
      balanceDue: number;
      pendingInstallments: number;
      lateInstallments: number;
      paidInstallments: number;
    }>([
      {
        $match: {
          ...scopedMatch,
          clientId: clientObjectId,
        },
      },
      {
        $group: {
          _id: null,
          balanceDue: {
            $sum: {
              $cond: [{ $in: ['$status', ['pending', 'late']] }, '$amount', 0],
            },
          },
          pendingInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0],
            },
          },
          lateInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'late'] }, 1, 0],
            },
          },
          paidInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'paid'] }, 1, 0],
            },
          },
        },
      },
    ]),
    Sale.find({
      ...scopedMatch,
      clientId,
    })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate('franchiseId', 'name')
      .populate('userId', 'fullName username')
      .lean(),
    Installment.find({
      ...scopedMatch,
      clientId,
    })
      .sort({ dueDate: 1 })
      .limit(8)
      .populate('saleId', 'invoiceNumber saleType total createdAt')
      .lean(),
  ]);

  return {
    client,
    salesSummary: salesSummaryRows[0] ?? {
      totalSpent: 0,
      saleCount: 0,
      lastSaleAt: null,
    },
    installmentSummary: installmentSummaryRows[0] ?? {
      balanceDue: 0,
      pendingInstallments: 0,
      lateInstallments: 0,
      paidInstallments: 0,
    },
    recentSales,
    recentInstallments,
  };
}
