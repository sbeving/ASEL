import { Schema, model, type InferSchemaType } from 'mongoose';

export const MOVEMENT_TYPES = [
  'stock_in',        // Supplier delivery / manual entry
  'sale',            // Sold to end customer
  'transfer_out',    // Leaving this franchise for another
  'transfer_in',     // Received from another franchise
  'adjustment',      // Manual correction (+/-)
  'return',          // Customer return (+)
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

const movementSchema = new Schema(
  {
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    /** Signed quantity: positive = added to franchise stock, negative = removed. */
    delta: { type: Number, required: true },
    unitPrice: { type: Number, min: 0, default: 0 },
    note: { type: String, trim: true, maxlength: 500 },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    refId: { type: Schema.Types.ObjectId, default: null }, // sale / transfer doc id
  },
  { timestamps: true, collection: 'movements' },
);

movementSchema.index({ franchiseId: 1, createdAt: -1 });
movementSchema.index({ productId: 1, createdAt: -1 });
movementSchema.index({ type: 1, createdAt: -1 });

export type MovementDoc = InferSchemaType<typeof movementSchema>;
export const Movement = model('Movement', movementSchema);
