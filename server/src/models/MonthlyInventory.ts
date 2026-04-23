import { Schema, model, type InferSchemaType } from 'mongoose';

const monthlyInventoryLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    systemQuantity: { type: Number, required: true, min: 0 },
    countedQuantity: { type: Number, required: true, min: 0 },
    variance: { type: Number, required: true },
    note: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false },
);

const monthlyInventorySchema = new Schema(
  {
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    status: {
      type: String,
      enum: ['draft', 'finalized'],
      default: 'draft',
      required: true,
    },
    totalSystemQuantity: { type: Number, required: true, min: 0, default: 0 },
    totalCountedQuantity: { type: Number, required: true, min: 0, default: 0 },
    totalVariance: { type: Number, required: true, default: 0 },
    appliedAdjustments: { type: Boolean, default: false },
    note: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    finalizedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    finalizedAt: { type: Date, default: null },
    lines: { type: [monthlyInventoryLineSchema], default: [] },
  },
  { timestamps: true, collection: 'monthly_inventories' },
);

monthlyInventorySchema.index({ franchiseId: 1, month: 1 });
monthlyInventorySchema.index({ month: 1, status: 1 });
monthlyInventorySchema.index({ createdAt: -1 });

export type MonthlyInventoryDoc = InferSchemaType<typeof monthlyInventorySchema>;
export const MonthlyInventory = model('MonthlyInventory', monthlyInventorySchema);
