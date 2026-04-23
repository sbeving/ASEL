import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

export const uploadRoot = path.isAbsolute(env.UPLOAD_DIR)
  ? env.UPLOAD_DIR
  : path.resolve(process.cwd(), env.UPLOAD_DIR);

export function ensureUploadDir(subDir?: string) {
  const dir = subDir ? path.join(uploadRoot, subDir) : uploadRoot;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function normalizeUploadPath(relativePath: string): string {
  return relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
}

ensureUploadDir();
