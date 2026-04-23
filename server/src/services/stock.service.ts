import mongoose from 'mongoose';
import { Stock, type StockDoc } from '../models/Stock.js';
import { Movement, type MovementType } from '../models/Movement.js';
import { Product } from '../models/Product.js';
import { Franchise } from '../models/Franchise.js';
import { createNotification } from './notification.service.js';
import { badRequest } from '../utils/AppError.js';

interface StockChange {
  franchiseId: string | mongoose.Types.ObjectId;
  productId: string | mongoose.Types.ObjectId;
  delta: number;
  type: MovementType;
  userId?: string | mongoose.Types.ObjectId;
  unitPrice?: number;
  note?: string;
  refId?: mongoose.Types.ObjectId | null;
  session?: mongoose.ClientSession;
}

/**
 * Atomically apply a stock delta for a (franchise, product). Fails loudly
 * if the resulting quantity would go negative. Logs a Movement row.
 */
export async function applyStockDelta(change: StockChange) {
  const { franchiseId, productId, delta, type, userId, unitPrice, note, refId, session } = change;

  if (!Number.isFinite(delta) || delta === 0) {
    throw badRequest('Stock delta must be a non-zero number');
  }

  let updatedStock: mongoose.HydratedDocument<StockDoc> | null = null;
  if (delta < 0) {
    // Guarded decrement: conditional update ensures no negative stock.
    updatedStock = await Stock.findOneAndUpdate(
      { franchiseId, productId, quantity: { $gte: -delta } },
      { $inc: { quantity: delta } },
      { new: true, session },
    );
    if (!updatedStock) throw badRequest('Insufficient stock for this operation');
  } else {
    updatedStock = await Stock.findOneAndUpdate(
      { franchiseId, productId },
      { $inc: { quantity: delta } },
      { upsert: true, new: true, session },
    );
  }

  await Movement.create(
    [
      {
        franchiseId,
        productId,
        type,
        delta,
        unitPrice: unitPrice ?? 0,
        note,
        userId,
        refId: refId ?? null,
      },
    ],
    { session },
  );

  // Legacy parity + secure alerting: create low-stock notifications after downward moves.
  if (delta < 0 && updatedStock) {
    const productQuery = Product.findById(productId).select('name lowStockThreshold');
    const franchiseQuery = Franchise.findById(franchiseId).select('name');
    if (session) {
      productQuery.session(session);
      franchiseQuery.session(session);
    }
    const [product, franchise] = await Promise.all([productQuery, franchiseQuery]);

    if (
      product &&
      typeof product.lowStockThreshold === 'number' &&
      updatedStock.quantity <= product.lowStockThreshold
    ) {
      const level = updatedStock.quantity <= 0 ? 'danger' : 'warning';
      const stockLabel =
        updatedStock.quantity <= 0
          ? 'EPUISE'
          : `Stock bas: ${updatedStock.quantity} restant(s)`;

      await createNotification({
        franchiseId: updatedStock.franchiseId,
        title: `Alerte stock - ${product.name}`,
        message: `${franchise?.name ?? 'Franchise'} - ${stockLabel}`,
        type: level,
        link: '/stock',
        dedupeKey: `low-stock:${updatedStock.franchiseId.toString()}:${product._id.toString()}:${level}`,
        dedupeWindowMinutes: 90,
        metadata: {
          kind: 'low_stock',
          franchiseId: updatedStock.franchiseId.toString(),
          productId: product._id.toString(),
          quantity: updatedStock.quantity,
          threshold: product.lowStockThreshold,
        },
        session,
      });
    }
  }
}
