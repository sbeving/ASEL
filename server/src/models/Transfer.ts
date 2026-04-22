import { Schema, model, type InferSchemaType } from 'mongoose';

export const TRANSFER_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

const transferSchema = new Schema(
  {
    sourceFranchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    destFranchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    status: { type: String, enum: TRANSFER_STATUSES, default: 'pending' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, maxlength: 500 },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'transfers' },
);

transferSchema.index({ sourceFranchiseId: 1, status: 1, createdAt: -1 });
transferSchema.index({ destFranchiseId: 1, status: 1, createdAt: -1 });

export type TransferDoc = InferSchemaType<typeof transferSchema>;
export const Transfer = model('Transfer', transferSchema);
