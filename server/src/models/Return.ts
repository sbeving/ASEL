import { Schema, model, type InferSchemaType } from 'mongoose';

export const RETURN_TYPES = ['return', 'exchange'] as const;
export type ReturnType = (typeof RETURN_TYPES)[number];

const returnSchema = new Schema(
  {
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    returnType: { type: String, enum: RETURN_TYPES, required: true },
    unitPrice: { type: Number, required: true, min: 0, default: 0 },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'returns' },
);

returnSchema.index({ franchiseId: 1, createdAt: -1 });
returnSchema.index({ productId: 1, createdAt: -1 });
returnSchema.index({ returnType: 1, createdAt: -1 });

export type ReturnDoc = InferSchemaType<typeof returnSchema>;
export const Return = model('Return', returnSchema);
