import { Schema, model, type InferSchemaType } from 'mongoose';

const franchiseSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    address: { type: String, trim: true, maxlength: 255 },
    phone: { type: String, trim: true, maxlength: 50 },
    manager: { type: String, trim: true, maxlength: 100 },
    gps: {
      lat: Number,
      lng: Number
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'franchises' },
);

export type FranchiseDoc = InferSchemaType<typeof franchiseSchema>;
export const Franchise = model('Franchise', franchiseSchema);
