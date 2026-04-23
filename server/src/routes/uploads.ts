import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { uploadRoot } from '../config/uploads.js';
import { notFound, forbidden } from '../utils/AppError.js';

const router = Router();

const paramsSchema = z.object({
  bucket: z.enum(['product-images', 'user-avatars', 'treasury-docs', 'reception-ocr']),
  filename: z.string().min(1).max(220).regex(/^[a-zA-Z0-9._-]+$/),
});

router.get(
  '/:bucket/:filename',
  requireAuth,
  validate(paramsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { bucket, filename } = req.params as z.infer<typeof paramsSchema>;
    const absolutePath = path.resolve(uploadRoot, bucket, filename);
    const expectedPrefix = path.resolve(uploadRoot, bucket) + path.sep;
    if (!absolutePath.startsWith(expectedPrefix)) throw forbidden();

    try {
      await fs.access(absolutePath);
    } catch {
      throw notFound('File not found');
    }

    res.sendFile(absolutePath);
  }),
);

export default router;
