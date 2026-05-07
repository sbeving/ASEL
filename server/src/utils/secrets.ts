import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function secretKey(): Buffer {
  return crypto.createHash('sha256').update(env.JWT_SECRET).digest();
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decryptSecret(value: string): string {
  const [version, ivHex, tagHex, encryptedHex] = value.split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !encryptedHex) {
    throw new Error('Unsupported secret format');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, secretKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}

export function secretLast4(value: string): string {
  return value.slice(-4);
}
