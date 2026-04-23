import { Schema, model, type InferSchemaType } from 'mongoose';

const saleItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const installmentPlanSchema = new Schema(
  {
    totalLots: { type: Number, required: true, min: 1 },
    intervalDays: { type: Number, required: true, min: 1 },
    upfrontAmount: { type: Number, required: true, min: 0 },
    remainingAmount: { type: Number, required: true, min: 0 },
    firstDueDate: { type: Date, required: true },
    generatedLots: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const saleSchema = new Schema(
  {
    invoiceNumber: { type: String, trim: true, maxlength: 40, default: null },
    saleType: {
      type: String,
      enum: ['ticket', 'facture', 'devis'],
      default: 'ticket',
    },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [saleItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ['cash', 'card', 'transfer', 'installment', 'other'],
      default: 'cash',
    },
    paymentStatus: {
      type: String,
      enum: ['paid', 'partial', 'pending'],
      default: 'paid',
    },
    amountReceived: { type: Number, min: 0, default: null },
    changeDue: { type: Number, min: 0, default: 0 },
    installmentPlan: { type: installmentPlanSchema, default: undefined },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, collection: 'sales' },
);

saleSchema.index({ franchiseId: 1, createdAt: -1 });
saleSchema.index({ createdAt: -1 });
saleSchema.index({ invoiceNumber: 1 }, { sparse: true });
saleSchema.index({ clientId: 1, createdAt: -1 });

export type SaleDoc = InferSchemaType<typeof saleSchema>;
export const Sale = model('Sale', saleSchema);
