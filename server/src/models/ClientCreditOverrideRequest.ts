import { Schema, model, type InferSchemaType } from 'mongoose';

const clientCreditOverrideRequestSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    franchiseId: {
      type: Schema.Types.ObjectId,
      ref: 'Franchise',
      required: true,
    },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedCreditLimit: { type: Number, min: 0, required: true },
    requestedMonthlyPayment: { type: Number, min: 0, default: 0 },
    requestReason: {
      type: String,
      trim: true,
      maxlength: 1500,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },
    approvedCreditLimit: { type: Number, min: 0, default: 0 },
    approvedMonthlyPayment: { type: Number, min: 0, default: 0 },
    expiresAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 1500, default: '' },
  },
  { timestamps: true, collection: 'client_credit_override_requests' },
);

clientCreditOverrideRequestSchema.index({ clientId: 1, createdAt: -1 });
clientCreditOverrideRequestSchema.index({ franchiseId: 1, status: 1 });
clientCreditOverrideRequestSchema.index({ expiresAt: 1 });

export type ClientCreditOverrideRequestDoc = InferSchemaType<
  typeof clientCreditOverrideRequestSchema
>;
export const ClientCreditOverrideRequest = model(
  'ClientCreditOverrideRequest',
  clientCreditOverrideRequestSchema,
);
