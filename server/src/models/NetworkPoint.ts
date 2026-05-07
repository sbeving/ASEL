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
    responsibleFirstName: { type: String, trim: true, maxlength: 80, default: '' },
    responsibleLastName: { type: String, trim: true, maxlength: 80, default: '' },
    cin: { type: String, trim: true, maxlength: 40, default: '' },
    documents: {
      cinImagePath: { type: String, trim: true, maxlength: 260, default: null },
      shopImagePath: { type: String, trim: true, maxlength: 260, default: null },
      signaturePath: { type: String, trim: true, maxlength: 260, default: null },
      signatureText: { type: String, trim: true, maxlength: 150, default: null },
      infoSheetPdfPath: { type: String, trim: true, maxlength: 260, default: null },
      signedAt: { type: Date, default: null },
      generatedAt: { type: Date, default: null },
    },
    schedule: { type: String, trim: true, maxlength: 255, default: 'Lun-Sam: 09:00-19:00' },
    gps: {
      lat: { type: Number, min: -90, max: 90, default: null },
      lng: { type: Number, min: -180, max: 180, default: null },
      accuracy: { type: Number, min: 0, default: null },
      mocked: { type: Boolean, default: null },
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
    internalNotes: { type: String, trim: true, maxlength: 3000, default: '' },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null },
    commercialId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    zoneId: { type: Schema.Types.ObjectId, ref: 'CommercialZone', default: null },
    leadStatus: {
      type: String,
      enum: ['lead', 'contacted', 'qualified', 'contract_given', 'won', 'lost'],
      default: 'lead',
    },
    contractGiven: { type: Boolean, default: false },
    contractGivenAt: { type: Date, default: null },
    lastContactedAt: { type: Date, default: null },
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
networkPointSchema.index({ commercialId: 1, active: 1 });
networkPointSchema.index({ zoneId: 1, active: 1 });
networkPointSchema.index({ 'integrity.blocked': 1, createdAt: -1 });

export type NetworkPointDoc = InferSchemaType<typeof networkPointSchema>;
export const NetworkPoint = model('NetworkPoint', networkPointSchema);
