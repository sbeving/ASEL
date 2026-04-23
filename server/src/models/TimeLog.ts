import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  franchiseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['entree', 'sortie', 'pause_debut', 'pause_fin'], required: true },
  timestamp: { type: Date, default: Date.now },
  gps: {
    lat: Number,
    lng: Number,
    address: String
  },
  device: String,
  note: String,
});

export const TimeLog = mongoose.model('TimeLog', schema);
