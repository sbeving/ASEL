import { Schema, model, type InferSchemaType } from 'mongoose';

const receptionLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceHt: { type: Number, required: true, min: 0, default: 0 },
    vatRate: { type: Number, required: true, min: 0, max: 100, default: 19 },
    unitPriceTtc: { type: Number, required: true, min: 0, default: 0 },
    totalHt: { type: Number, required: true, min: 0, default: 0 },
    totalTtc: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const receptionSchema = new Schema(
  {
    number: { type: String, required: true, trim: true, maxlength: 80 },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    receptionDate: { type: Date, default: Date.now },
    totalHt: { type: Number, required: true, min: 0, default: 0 },
    vat: { type: Number, required: true, min: 0, default: 0 },
    totalTtc: { type: Number, required: true, min: 0, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'validated', 'cancelled'],
      default: 'draft',
    },
    note: { type: String, trim: true, maxlength: 2000 },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    validatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    validatedAt: { type: Date, default: null },
    lines: { type: [receptionLineSchema], default: [] },
  },
  { timestamps: true, collection: 'receptions' },
);

receptionSchema.index({ number: 1 }, { unique: true });
receptionSchema.index({ franchiseId: 1, status: 1, createdAt: -1 });

export type ReceptionDoc = InferSchemaType<typeof receptionSchema>;
export const Reception = model('Reception', receptionSchema);
