import { Schema, model, type InferSchemaType } from 'mongoose';

const cashLedgerEntrySchema = new Schema(
  {
    accountType: { type: String, enum: ['franchise_cashbox', 'central_cashbox'], required: true, index: true },
    accountKey: { type: String, required: true, trim: true, index: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true, index: true },
    cashFlowId: { type: Schema.Types.ObjectId, ref: 'CashFlow', required: true, index: true },
    linkedFlowId: { type: Schema.Types.ObjectId, ref: 'CashFlow', default: null, index: true },
    revision: { type: Number, required: true, min: 1 },
    active: { type: Boolean, default: true, index: true },
    direction: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true, min: 0 },
    signedAmount: { type: Number, required: true },
    flowType: { type: String, enum: ['encaissement', 'decaissement'], required: true },
    flowSubType: { type: String, required: true, trim: true },
    reason: { type: String, required: true, trim: true, maxlength: 255 },
    reference: { type: String, trim: true, maxlength: 120, default: '' },
    receiptNumber: { type: String, trim: true, maxlength: 80, default: null },
    date: { type: Date, required: true, index: true },
    postedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    postedAt: { type: Date, default: Date.now, index: true },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, trim: true, maxlength: 255, default: '' },
  },
  { timestamps: true, collection: 'cash_ledger_entries' },
);

cashLedgerEntrySchema.index({ cashFlowId: 1, revision: 1 }, { unique: true });
cashLedgerEntrySchema.index({ accountKey: 1, active: 1, date: -1 });
cashLedgerEntrySchema.index({ franchiseId: 1, active: 1, date: -1 });

export type CashLedgerEntryDoc = InferSchemaType<typeof cashLedgerEntrySchema>;
export const CashLedgerEntry = model('CashLedgerEntry', cashLedgerEntrySchema);
