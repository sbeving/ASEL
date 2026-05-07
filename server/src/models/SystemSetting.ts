import { Schema, model, type InferSchemaType } from 'mongoose';

const systemSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'system_settings' },
);

export type SystemSettingDoc = InferSchemaType<typeof systemSettingSchema>;
export const SystemSetting = model('SystemSetting', systemSettingSchema);
