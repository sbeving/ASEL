import { Schema, model, type InferSchemaType } from 'mongoose';
import { ROLES } from '../utils/roles.js';

const locationPingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null, index: true },
    role: { type: String, enum: ROLES, required: true, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    clientRequestId: { type: String, trim: true, maxlength: 80 },
    source: {
      type: String,
      enum: ['mobile_foreground', 'mobile_background', 'manual'],
      default: 'mobile_foreground',
    },
    gps: {
      lat: { type: Number, required: true, min: -90, max: 90 },
      lng: { type: Number, required: true, min: -180, max: 180 },
      accuracy: { type: Number, min: 0, default: null },
      heading: { type: Number, default: null },
      speed: { type: Number, default: null },
      mocked: { type: Boolean, default: null },
      address: { type: String, trim: true, maxlength: 255, default: '' },
    },
    integrity: {
      platform: { type: String, trim: true, maxlength: 40, default: null },
      appId: { type: String, trim: true, maxlength: 160, default: null },
      appVersion: { type: String, trim: true, maxlength: 80, default: null },
      buildVersion: { type: String, trim: true, maxlength: 80, default: null },
      deviceName: { type: String, trim: true, maxlength: 160, default: null },
      brand: { type: String, trim: true, maxlength: 80, default: null },
      modelName: { type: String, trim: true, maxlength: 120, default: null },
      osName: { type: String, trim: true, maxlength: 80, default: null },
      osVersion: { type: String, trim: true, maxlength: 80, default: null },
      isDevice: { type: Boolean, default: null },
      networkType: { type: String, trim: true, maxlength: 80, default: null },
      isInternetReachable: { type: Boolean, default: null },
      suspicious: { type: [String], default: [] },
      blocked: { type: Boolean, default: false },
    },
    zoneId: { type: Schema.Types.ObjectId, ref: 'CommercialZone', default: null, index: true },
    inZone: { type: Boolean, default: null, index: true },
    batteryPct: { type: Number, min: 0, max: 100, default: null },
    device: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true, collection: 'location_pings' },
);

locationPingSchema.index({ userId: 1, timestamp: -1 });
locationPingSchema.index({ franchiseId: 1, timestamp: -1 });
locationPingSchema.index({ role: 1, inZone: 1, timestamp: -1 });
locationPingSchema.index({ 'integrity.blocked': 1, timestamp: -1 });
locationPingSchema.index(
  { userId: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } },
);

export type LocationPingDoc = InferSchemaType<typeof locationPingSchema>;
export const LocationPing = model('LocationPing', locationPingSchema);
