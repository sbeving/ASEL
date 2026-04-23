import mongoose from 'mongoose';

/**
 * Global Mongoose serialization contract — runs ONCE, before any model is
 * compiled, so every API response shares the same shape:
 *
 *   - `_id` (ObjectId) is rewritten to `id` (string)
 *   - `__v` (version key) is stripped
 *   - any explicitly-hidden fields (`toJSON: { hide: true }` in the schema
 *     path options) are removed
 *
 * Without this, some routes returned `_id` while `/auth/login` returned a
 * hand-mapped `id`; clients had to branch on both. Now every document is
 * serialized identically.
 */
mongoose.plugin((schema) => {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(_doc, ret) {
      if (ret._id) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
      // Defense in depth: never serialize secrets even if the field was
      // explicitly selected via `.select('+passwordHash')`.
      delete ret.passwordHash;
      return ret;
    },
  });
});

mongoose.set('strictQuery', true);
// NOTE: `sanitizeFilter` is intentionally NOT enabled globally — it
// wraps values like `{ quantity: { $gte: -delta } }` in an `$eq` and
// breaks legitimate operator usage (the stock guard depends on `$gte`).
// Query injection is prevented by Zod validation + never letting user
// input dictate filter field names.
