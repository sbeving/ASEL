import mongoose from 'mongoose';
import { Stock } from '../models/Stock.js';
import { Movement, type MovementType } from '../models/Movement.js';
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

  if (delta < 0) {
    // Guarded decrement — conditional update ensures no negative stock
    const result = await Stock.findOneAndUpdate(
      { franchiseId, productId, quantity: { $gte: -delta } },
      { $inc: { quantity: delta } },
      { new: true, session },
    );
    if (!result) throw badRequest('Insufficient stock for this operation');
  } else {
    await Stock.findOneAndUpdate(
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
}
