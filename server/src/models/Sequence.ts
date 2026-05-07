import { Schema, model, type InferSchemaType } from 'mongoose';

const sequenceSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, maxlength: 160 },
    value: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true, collection: 'sequences' },
);

export type SequenceDoc = InferSchemaType<typeof sequenceSchema>;
export const Sequence = model('Sequence', sequenceSchema);
