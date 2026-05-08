import { Schema, model, type InferSchemaType } from 'mongoose';

const cashFlowSchema = new Schema(
  {
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true, index: true },
    type: { type: String, enum: ['encaissement', 'decaissement'], required: true },
    subType: {
      type: String,
      enum: ['cash_sale', 'central_cashbox', 'bank_transfer', 'expense', 'other'],
      default: 'other',
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true, maxlength: 255 },
    reference: { type: String, trim: true, maxlength: 120, default: '' },
    attachmentPath: { type: String, trim: true, maxlength: 260, default: null },
    attachmentMimeType: { type: String, trim: true, maxlength: 80, default: null },
    attachmentOriginalName: { type: String, trim: true, maxlength: 220, default: null },
    isCentralCashbox: { type: Boolean, default: false, index: true },
    counterpartyFranchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null, index: true },
    linkedFlowId: { type: Schema.Types.ObjectId, ref: 'CashFlow', default: null, index: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 1000, default: '' },
    receiptNumber: { type: String, trim: true, maxlength: 80, default: null },
    receiptPath: { type: String, trim: true, maxlength: 260, default: null },
    receiptCreatedAt: { type: Date, default: null },
    date: { type: Date, default: Date.now, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'cashflows' },
);

cashFlowSchema.index({ franchiseId: 1, date: -1 });
cashFlowSchema.index({ type: 1, date: -1 });
cashFlowSchema.index({ isCentralCashbox: 1, date: -1 });
cashFlowSchema.index(
  { receiptNumber: 1 },
  { unique: true, partialFilterExpression: { receiptNumber: { $type: 'string' } } },
);

export type CashFlowDoc = InferSchemaType<typeof cashFlowSchema>;
export const CashFlow = model('CashFlow', cashFlowSchema);
