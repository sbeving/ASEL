import { Schema, model, type InferSchemaType } from 'mongoose';

const prestationSchema = new Schema(
  {
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', default: null },
    billedPrice: { type: Number, min: 0, required: true },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    performedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, collection: 'prestations' },
);

prestationSchema.index({ serviceId: 1, performedAt: -1 });
prestationSchema.index({ userId: 1, performedAt: -1 });

export type PrestationDoc = InferSchemaType<typeof prestationSchema>;
export const Prestation = model('Prestation', prestationSchema);
