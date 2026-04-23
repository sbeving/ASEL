import { Schema, model, type InferSchemaType } from 'mongoose';

const clientSchema = new Schema(
  {
    firstName: { type: String, trim: true, maxlength: 100, default: '' },
    lastName: { type: String, trim: true, maxlength: 100, default: '' },
    fullName: { type: String, required: true, trim: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 40 },
    phone2: { type: String, trim: true, maxlength: 40 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },
    address: { type: String, trim: true, maxlength: 300 },
    clientType: {
      type: String,
      enum: ['walkin', 'boutique', 'wholesale', 'passager', 'other'],
      default: 'walkin',
    },
    company: { type: String, trim: true, maxlength: 160 },
    taxId: { type: String, trim: true, maxlength: 80 },
    cin: { type: String, trim: true, maxlength: 40 },
    notes: { type: String, trim: true, maxlength: 1000 },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'clients' },
);

clientSchema.index({ fullName: 1 });
clientSchema.index({ phone: 1 });
clientSchema.index({ franchiseId: 1, active: 1 });

export type ClientDoc = InferSchemaType<typeof clientSchema>;
export const Client = model('Client', clientSchema);
