import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  franchiseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Franchise', required: true },
  type: { type: String, enum: ['encaissement', 'decaissement'], required: true },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  reference: String,
  date: { type: Date, default: Date.now },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
});

export const CashFlow = mongoose.model('CashFlow', schema);
