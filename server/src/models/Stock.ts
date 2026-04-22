import { Schema, model, type InferSchemaType } from 'mongoose';

const stockSchema = new Schema(
  {
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: 'stocks' },
);

stockSchema.index({ franchiseId: 1, productId: 1 }, { unique: true });
stockSchema.index({ productId: 1 });

export type StockDoc = InferSchemaType<typeof stockSchema>;
export const Stock = model('Stock', stockSchema);
