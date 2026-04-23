import { Schema, model, type InferSchemaType } from 'mongoose';

export const DEMAND_URGENCIES = ['normal', 'urgent', 'critical'] as const;
export const DEMAND_STATUSES = ['pending', 'approved', 'rejected', 'delivered'] as const;

const demandSchema = new Schema(
  {
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    productName: { type: String, trim: true, maxlength: 200, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    urgency: { type: String, enum: DEMAND_URGENCIES, default: 'normal' },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: DEMAND_STATUSES, default: 'pending' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    response: { type: String, trim: true, maxlength: 1000, default: '' },
    processedAt: { type: Date, default: null },
    sourceFranchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null },
  },
  { timestamps: true, collection: 'demands' },
);

demandSchema.index({ franchiseId: 1, createdAt: -1 });
demandSchema.index({ status: 1, urgency: 1, createdAt: -1 });
demandSchema.index({ productName: 'text', note: 'text' });

export type DemandDoc = InferSchemaType<typeof demandSchema>;
export const Demand = model('Demand', demandSchema);
