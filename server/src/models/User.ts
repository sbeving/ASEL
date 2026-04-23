import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ROLES } from '../utils/roles.js';
import { PERMISSIONS } from '../utils/permissions.js';

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true, minlength: 3, maxlength: 50 },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    role: { type: String, enum: ROLES, required: true },
    franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', default: null },
    customPermissions: {
      grants: [{ type: String, enum: PERMISSIONS }],
      revokes: [{ type: String, enum: PERMISSIONS }],
    },
    sessionVersion: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ franchiseId: 1 });

userSchema.methods.toSafeJSON = function () {
  const obj = this.toObject({ versionKey: false });
  delete obj.passwordHash;
  return obj;
};

export type UserDoc = InferSchemaType<typeof userSchema> & {
  _id: Types.ObjectId;
  toSafeJSON(): Record<string, unknown>;
};

export const User = model('User', userSchema);
