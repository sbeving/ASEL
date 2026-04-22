import { Schema, model, type InferSchemaType } from 'mongoose';

const saleItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const saleSchema = new Schema(
  {
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [saleItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ['cash', 'card', 'transfer', 'other'],
      default: 'cash',
    },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, collection: 'sales' },
);

saleSchema.index({ franchiseId: 1, createdAt: -1 });
saleSchema.index({ createdAt: -1 });

export type SaleDoc = InferSchemaType<typeof saleSchema>;
export const Sale = model('Sale', saleSchema);
