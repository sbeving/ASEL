import { Schema, model, type InferSchemaType } from 'mongoose';

const cashFlowSchema = new Schema(
  {
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true, index: true },
    type: { type: String, enum: ['encaissement', 'decaissement'], required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true, maxlength: 255 },
    reference: { type: String, trim: true, maxlength: 120, default: '' },
    attachmentPath: { type: String, trim: true, maxlength: 260, default: null },
    attachmentMimeType: { type: String, trim: true, maxlength: 80, default: null },
    attachmentOriginalName: { type: String, trim: true, maxlength: 220, default: null },
    date: { type: Date, default: Date.now, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'cashflows' },
);

cashFlowSchema.index({ franchiseId: 1, date: -1 });
cashFlowSchema.index({ type: 1, date: -1 });

export type CashFlowDoc = InferSchemaType<typeof cashFlowSchema>;
export const CashFlow = model('CashFlow', cashFlowSchema);
