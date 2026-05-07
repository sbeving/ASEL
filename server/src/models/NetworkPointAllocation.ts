import { Schema, model, type InferSchemaType } from 'mongoose';

const networkPointAllocationSchema = new Schema(
  {
    networkPointId: { type: Schema.Types.ObjectId, ref: 'NetworkPoint', required: true, index: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
    kind: { type: String, enum: ['sim', 'recharge', 'other'], required: true, index: true },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    amount: { type: Number, min: 0, default: 0 },
    barcodes: [{ type: String, trim: true, maxlength: 120 }],
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    commercialId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'network_point_allocations' },
);

networkPointAllocationSchema.index({ networkPointId: 1, createdAt: -1 });
networkPointAllocationSchema.index({ barcodes: 1 });

export type NetworkPointAllocationDoc = InferSchemaType<typeof networkPointAllocationSchema>;
export const NetworkPointAllocation = model('NetworkPointAllocation', networkPointAllocationSchema);
