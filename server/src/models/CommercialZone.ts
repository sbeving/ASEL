import { Schema, model, type InferSchemaType } from 'mongoose';

const zonePointSchema = new Schema(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false },
);

const commercialZoneSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    color: { type: String, trim: true, maxlength: 20, default: '#2563eb' },
    active: { type: Boolean, default: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null },
    assignedCommercialIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    polygon: {
      type: [zonePointSchema],
      validate: {
        validator: (value: unknown[]) => Array.isArray(value) && value.length >= 3,
        message: 'A zone needs at least 3 points',
      },
      required: true,
    },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'commercial_zones' },
);

commercialZoneSchema.index({ active: 1, franchiseId: 1 });
commercialZoneSchema.index({ assignedCommercialIds: 1, active: 1 });

export type CommercialZoneDoc = InferSchemaType<typeof commercialZoneSchema>;
export const CommercialZone = model('CommercialZone', commercialZoneSchema);
