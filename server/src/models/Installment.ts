import { Schema, model, type InferSchemaType } from 'mongoose';

const installmentDueDateHistorySchema = new Schema(
  {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    reason: { type: String, trim: true, maxlength: 1000, default: '' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const installmentPaymentHistorySchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    paidAt: { type: Date, required: true },
    paymentMethod: { type: String, trim: true, maxlength: 40, default: null },
    receiptNumber: { type: String, trim: true, maxlength: 80, default: null },
    receiptPath: { type: String, trim: true, maxlength: 260, default: null },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const installmentSchema = new Schema(
  {
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    amount: { type: Number, required: true, min: 0 },
    originalAmount: { type: Number, min: 0, default: null },
    paidAmount: { type: Number, min: 0, default: 0 },
    dueDate: { type: Date, required: true },
    dueDateHistory: { type: [installmentDueDateHistorySchema], default: [] },
    dueDateUpdatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    dueDateUpdatedAt: { type: Date, default: null },
    status: { type: String, enum: ['pending', 'paid', 'late'], default: 'pending' },
    paidAt: { type: Date, default: null },
    paidAtUpdatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    paidAtUpdatedAt: { type: Date, default: null },
    paymentMethod: { type: String, trim: true, maxlength: 40, default: null },
    paymentHistory: { type: [installmentPaymentHistorySchema], default: [] },
    receiptNumber: { type: String, trim: true, maxlength: 80, default: null },
    receiptPath: { type: String, trim: true, maxlength: 260, default: null },
    receiptCreatedAt: { type: Date, default: null },
    note: { type: String, trim: true, maxlength: 1000 },
    splitFromInstallmentId: { type: Schema.Types.ObjectId, ref: 'Installment', default: null },
    remind7dSent: { type: Boolean, default: false },
    remind3dSent: { type: Boolean, default: false },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'installments' },
);

installmentSchema.index({ franchiseId: 1, dueDate: 1, status: 1 });
installmentSchema.index({ saleId: 1 });
installmentSchema.index(
  { receiptNumber: 1 },
  { unique: true, partialFilterExpression: { receiptNumber: { $type: 'string' } } },
);

export type InstallmentDoc = InferSchemaType<typeof installmentSchema>;
export const Installment = model('Installment', installmentSchema);
