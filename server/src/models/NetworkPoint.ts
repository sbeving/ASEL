import { Schema, model, type InferSchemaType } from 'mongoose';

const networkPointSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    type: {
      type: String,
      enum: ['franchise', 'activation', 'recharge', 'activation_recharge'],
      default: 'activation_recharge',
      required: true,
    },
    status: {
      type: String,
      enum: ['prospect', 'contact', 'contrat_non_signe', 'contrat_signe', 'actif', 'suspendu', 'resilie'],
      default: 'prospect',
      required: true,
    },
    address: { type: String, trim: true, maxlength: 255, default: '' },
    city: { type: String, trim: true, maxlength: 100, default: '' },
    governorate: { type: String, trim: true, maxlength: 100, default: '' },
    phone: { type: String, trim: true, maxlength: 50, default: '' },
    phone2: { type: String, trim: true, maxlength: 50, default: '' },
    email: { type: String, trim: true, maxlength: 150, default: '' },
    responsible: { type: String, trim: true, maxlength: 150, default: '' },
    schedule: { type: String, trim: true, maxlength: 255, default: 'Lun-Sam: 09:00-19:00' },
    gps: {
      lat: { type: Number, min: -90, max: 90, default: null },
      lng: { type: Number, min: -180, max: 180, default: null },
    },
    internalNotes: { type: String, trim: true, maxlength: 3000, default: '' },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null },
    contactDate: { type: Date, default: null },
    contractDate: { type: Date, default: null },
    activationDate: { type: Date, default: null },
    commissionPct: { type: Number, min: 0, max: 100, default: 0 },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'network_points' },
);

networkPointSchema.index({ active: 1, type: 1, status: 1, name: 1 });
networkPointSchema.index({ city: 1 });
networkPointSchema.index({ governorate: 1 });
networkPointSchema.index({ 'gps.lat': 1, 'gps.lng': 1 });
networkPointSchema.index({ franchiseId: 1 });

export type NetworkPointDoc = InferSchemaType<typeof networkPointSchema>;
export const NetworkPoint = model('NetworkPoint', networkPointSchema);
