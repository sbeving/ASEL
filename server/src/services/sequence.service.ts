import mongoose from 'mongoose';
import { Sequence } from '../models/Sequence.js';

export async function nextSequenceValue(key: string, session?: mongoose.ClientSession): Promise<number> {
  const row = await Sequence.findOneAndUpdate(
    { key },
    { $inc: { value: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session },
  ).lean();

  return row?.value ?? 1;
}
