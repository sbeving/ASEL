import { Schema, model, type InferSchemaType } from 'mongoose';

const leaveRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null, index: true },
    assignedManagerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    type: {
      type: String,
      enum: ['conge_annuel', 'maladie', 'sans_solde', 'exceptionnel', 'autre'],
      default: 'conge_annuel',
      required: true,
    },
    fromDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    toDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    reason: { type: String, trim: true, maxlength: 1000, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      required: true,
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { timestamps: true, collection: 'leave_requests' },
);

leaveRequestSchema.index({ userId: 1, fromDate: -1 });
leaveRequestSchema.index({ assignedManagerId: 1, status: 1, fromDate: -1 });
leaveRequestSchema.index({ franchiseId: 1, status: 1, fromDate: -1 });

export type LeaveRequestDoc = InferSchemaType<typeof leaveRequestSchema>;
export const LeaveRequest = model('LeaveRequest', leaveRequestSchema);
