import { Schema, model, type InferSchemaType } from 'mongoose';

const franchiseSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    address: { type: String, trim: true, maxlength: 255 },
    phone: { type: String, trim: true, maxlength: 50 },
    manager: { type: String, trim: true, maxlength: 100 },
    taxId: { type: String, trim: true, maxlength: 80, default: '' },
    gps: {
      lat: Number,
      lng: Number
    },
    workSchedule: {
      enabled: { type: Boolean, default: true },
      days: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
      startTime: { type: String, trim: true, maxlength: 5, default: '09:00' },
      endTime: { type: String, trim: true, maxlength: 5, default: '19:00' },
      timezone: { type: String, trim: true, maxlength: 80, default: 'Africa/Tunis' },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'franchises' },
);

export type FranchiseDoc = InferSchemaType<typeof franchiseSchema>;
export const Franchise = model('Franchise', franchiseSchema);
