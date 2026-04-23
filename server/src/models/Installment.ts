import { Schema, model, type InferSchemaType } from 'mongoose';

const installmentSchema = new Schema(
  {
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    amount: { type: Number, required: true, min: 0 },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'paid', 'late'], default: 'pending' },
    paidAt: { type: Date, default: null },
    paymentMethod: { type: String, trim: true, maxlength: 40, default: null },
    note: { type: String, trim: true, maxlength: 1000 },
    remind7dSent: { type: Boolean, default: false },
    remind3dSent: { type: Boolean, default: false },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'installments' },
);

installmentSchema.index({ franchiseId: 1, dueDate: 1, status: 1 });
installmentSchema.index({ saleId: 1 });

export type InstallmentDoc = InferSchemaType<typeof installmentSchema>;
export const Installment = model('Installment', installmentSchema);
