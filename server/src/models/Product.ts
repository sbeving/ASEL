import { Schema, model, type InferSchemaType } from 'mongoose';

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    brand: { type: String, trim: true, maxlength: 80 },
    reference: { type: String, trim: true, maxlength: 80 },
    barcode: { type: String, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 1000 },
    imagePath: { type: String, trim: true, maxlength: 260, default: null },
    purchasePrice: { type: Number, min: 0, default: 0 },
    purchasePriceHt: { type: Number, min: 0, default: 0 },
    purchaseTaxRate: { type: Number, min: 0, max: 100, default: 19 },
    purchasePriceTtc: { type: Number, min: 0, default: 0 },
    sellPrice: { type: Number, min: 0, default: 0 },
    sellPriceHt: { type: Number, min: 0, default: 0 },
    sellTaxRate: { type: Number, min: 0, max: 100, default: 19 },
    sellPriceTtc: { type: Number, min: 0, default: 0 },
    productType: {
      type: String,
      enum: ['standard', 'asel_recharge', 'asel_forfait'],
      default: 'standard',
      index: true,
    },
    priceMode: {
      type: String,
      enum: ['fixed', 'variable'],
      default: 'fixed',
    },
    stockManaged: { type: Boolean, default: true, index: true },
    commissionRate: { type: Number, min: 0, max: 100, default: 0 },
    companyShareRate: { type: Number, min: 0, max: 100, default: 100 },
    franchiseManagerShareRate: { type: Number, min: 0, max: 100, default: 0 },
    lowStockThreshold: { type: Number, min: 0, default: 3 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'products' },
);

productSchema.index({ name: 'text', reference: 'text', barcode: 'text', brand: 'text' });
productSchema.index({ reference: 1 });
productSchema.index({ barcode: 1 });
productSchema.index({ categoryId: 1, active: 1 });
productSchema.index({ productType: 1, active: 1 });
productSchema.index({ stockManaged: 1, active: 1 });

export type ProductDoc = InferSchemaType<typeof productSchema>;
export const Product = model('Product', productSchema);
