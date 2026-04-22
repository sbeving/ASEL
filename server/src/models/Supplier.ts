import { Schema, model, type InferSchemaType } from 'mongoose';

const supplierSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 50 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    address: { type: String, trim: true, maxlength: 255 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'suppliers' },
);

export type SupplierDoc = InferSchemaType<typeof supplierSchema>;
export const Supplier = model('Supplier', supplierSchema);
