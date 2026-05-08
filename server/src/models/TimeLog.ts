import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  franchiseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['entree', 'sortie', 'pause_debut', 'pause_fin', 'verif'], required: true },
  timestamp: { type: Date, default: Date.now },
  source: { type: String, enum: ['manual', 'auto_login'], default: 'manual' },
  localDate: { type: String, trim: true, maxlength: 10, default: null },
  gps: {
    lat: Number,
    lng: Number,
    accuracy: Number,
    mocked: { type: Boolean, default: null },
    address: String
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
  device: String,
  note: String,
});

schema.index({ userId: 1, franchiseId: 1, type: 1, timestamp: -1 });
schema.index({ userId: 1, localDate: 1, type: 1 });
schema.index({ 'integrity.blocked': 1, timestamp: -1 });

export const TimeLog = mongoose.model('TimeLog', schema);
