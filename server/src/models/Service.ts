import { Schema, model, type InferSchemaType } from 'mongoose';

const serviceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    category: {
      type: String,
      enum: ['technique', 'compte', 'autre'],
      default: 'technique',
    },
    price: { type: Number, min: 0, default: 0 },
    description: { type: String, trim: true, maxlength: 1200, default: '' },
    durationMinutes: { type: Number, min: 1, max: 1440, default: 15 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'services' },
);

serviceSchema.index({ active: 1, category: 1, name: 1 });
serviceSchema.index({ name: 1 });

export type ServiceDoc = InferSchemaType<typeof serviceSchema>;
export const Service = model('Service', serviceSchema);
