import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { RequestHandler } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { badRequest } from '../utils/AppError.js';
import { ensureUploadDir, normalizeUploadPath } from '../config/uploads.js';

type UploadBucket =
  | 'product-images'
  | 'user-avatars'
  | 'treasury-docs'
  | 'treasury-receipts'
  | 'installment-receipts'
  | 'reception-ocr'
  | 'network-point-docs';

interface CompressionProfile {
  maxEdge: number;
  quality: number;
}

interface CompressedUploader {
  single(fieldName: string): RequestHandler[];
  fields(fields: readonly multer.Field[]): RequestHandler[];
}

const defaultCompressionProfile: CompressionProfile = {
  maxEdge: 1600,
  quality: 78,
};

const bucketCompressionProfiles: Partial<Record<UploadBucket, CompressionProfile>> = {
  'reception-ocr': { maxEdge: 2200, quality: 82 },
};

const compressibleImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

function uploadedFiles(req: Express.Request): Express.Multer.File[] {
  if (req.file) return [req.file];
  if (!req.files) return [];
  if (Array.isArray(req.files)) return req.files;
  return Object.values(req.files).flat();
}

async function replaceIfSmaller(originalPath: string, optimizedPath: string) {
  const [original, optimized] = await Promise.all([fs.stat(originalPath), fs.stat(optimizedPath)]);
  if (optimized.size >= original.size) {
    await fs.rm(optimizedPath, { force: true });
    return original.size;
  }
  await fs.rename(optimizedPath, originalPath);
  return optimized.size;
}

async function compressImageUpload(file: Express.Multer.File, profile: CompressionProfile) {
  if (!compressibleImageTypes.has(file.mimetype)) return;
  const tempPath = `${file.path}.${crypto.randomUUID()}.optimized`;
  try {
    let pipeline = sharp(file.path, { failOn: 'none' })
      .rotate()
      .resize({
        width: profile.maxEdge,
        height: profile.maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      });

    if (file.mimetype === 'image/jpeg') {
      pipeline = pipeline.jpeg({ quality: profile.quality, mozjpeg: true });
    } else if (file.mimetype === 'image/png') {
      pipeline = pipeline.png({ compressionLevel: 9, palette: true, quality: profile.quality });
    } else {
      pipeline = pipeline.webp({ quality: profile.quality, effort: 4 });
    }

    await pipeline.toFile(tempPath);
    file.size = await replaceIfSmaller(file.path, tempPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    await fs.rm(file.path, { force: true });
    throw badRequest('Image upload could not be compressed', {
      filename: file.originalname,
      reason: error instanceof Error ? error.message : 'unknown_error',
    });
  }
}

function compressUploadedImages(bucket: UploadBucket): RequestHandler {
  const profile = bucketCompressionProfiles[bucket] ?? defaultCompressionProfile;
  return async (req, _res, next) => {
    try {
      for (const file of uploadedFiles(req)) {
        await compressImageUpload(file, profile);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function createUploader(bucket: UploadBucket, allowedMimeTypes: string[], maxFileSizeBytes: number, maxFiles = 1): CompressedUploader {
  const upload = multer({
    storage: makeStorage(bucket),
    limits: { fileSize: maxFileSizeBytes, files: maxFiles },
    fileFilter: fileFilterFactory(new Set(allowedMimeTypes)),
  });
  return {
    single: (fieldName: string) => [upload.single(fieldName), compressUploadedImages(bucket)],
    fields: (fields: readonly multer.Field[]) => [upload.fields(fields), compressUploadedImages(bucket)],
  };
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
  30 * 1024 * 1024,
);

export const networkPointDocumentUpload = createUploader(
  'network-point-docs',
  ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  15 * 1024 * 1024,
  2,
);

export function toUploadPath(bucket: UploadBucket, filename: string) {
  return normalizeUploadPath(path.posix.join(bucket, filename));
}
