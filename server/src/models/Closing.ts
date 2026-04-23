import { Schema, model, type InferSchemaType } from 'mongoose';

const closingSchema = new Schema(
  {
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    closingDate: { type: Date, required: true },
    declaredSalesTotal: { type: Number, required: true, min: 0, default: 0 },
    declaredItemsTotal: { type: Number, required: true, min: 0, default: 0 },
    systemSalesTotal: { type: Number, required: true, min: 0, default: 0 },
    systemItemsTotal: { type: Number, required: true, min: 0, default: 0 },
    comment: { type: String, trim: true, maxlength: 2000 },
    validated: { type: Boolean, default: false },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    validatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    validatedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'closings' },
);

closingSchema.index({ franchiseId: 1, closingDate: -1 }, { unique: true });

export type ClosingDoc = InferSchemaType<typeof closingSchema>;
export const Closing = model('Closing', closingSchema);
