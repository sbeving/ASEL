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
    sellPrice: { type: Number, min: 0, default: 0 },
    lowStockThreshold: { type: Number, min: 0, default: 3 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'products' },
);

productSchema.index({ name: 'text', reference: 'text', barcode: 'text', brand: 'text' });
productSchema.index({ reference: 1 });
productSchema.index({ barcode: 1 });
productSchema.index({ categoryId: 1, active: 1 });

export type ProductDoc = InferSchemaType<typeof productSchema>;
export const Product = model('Product', productSchema);
