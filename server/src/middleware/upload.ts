import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { badRequest } from '../utils/AppError.js';
import { ensureUploadDir, normalizeUploadPath } from '../config/uploads.js';

type UploadBucket = 'product-images' | 'user-avatars' | 'treasury-docs' | 'reception-ocr';

function makeStorage(bucket: UploadBucket) {
  ensureUploadDir(bucket);
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureUploadDir(bucket)),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || '').toLowerCase();
      const safeExt = extension.match(/^\.[a-z0-9]{1,8}$/i) ? extension : '';
      cb(null, `${Date.now()}-${crypto.randomUUID()}${safeExt}`);
    },
  });
}

function fileFilterFactory(allowedMimeTypes: Set<string>) {
  return (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      cb(badRequest(`Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  };
}

function createUploader(bucket: UploadBucket, allowedMimeTypes: string[], maxFileSizeBytes: number) {
  return multer({
    storage: makeStorage(bucket),
    limits: { fileSize: maxFileSizeBytes, files: 1 },
    fileFilter: fileFilterFactory(new Set(allowedMimeTypes)),
  });
}

export const productImageUpload = createUploader(
  'product-images',
  ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  8 * 1024 * 1024,
);

export const userAvatarUpload = createUploader(
  'user-avatars',
  ['image/jpeg', 'image/png', 'image/webp'],
  5 * 1024 * 1024,
);

export const treasuryAttachmentUpload = createUploader(
  'treasury-docs',
  ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  15 * 1024 * 1024,
);

export const receptionOcrUpload = createUploader(
  'reception-ocr',
  ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  20 * 1024 * 1024,
);

export function toUploadPath(bucket: UploadBucket, filename: string) {
  return normalizeUploadPath(path.posix.join(bucket, filename));
}
