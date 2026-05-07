import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES: z.string().default('12h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  COOKIE_SECURE: z.string().optional(),
  COOKIE_DOMAIN: z.string().optional(),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  UPLOAD_DIR: z.string().default('uploads'),
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_OCR_MODEL: z.string().default('mistral-ocr-latest'),
  OCR_HTTP_ENDPOINT: z.string().url().optional(),
  OCR_HTTP_API_KEY: z.string().optional(),
  OCR_LOCAL_ENABLED: z.string().default('true'),
  OCR_PREPROCESS_MAX_EDGE: z.coerce.number().int().min(800).max(5000).default(2600),
  BACKUP_ENABLED: z.string().default('true'),
  BACKUP_DIR: z.string().default('backups'),
  BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  BACKUP_MAX_FILES: z.coerce.number().int().min(1).max(365).default(30),
  BACKUP_MAX_TOTAL_MB: z.coerce.number().int().min(64).max(10240).default(512),
  SIEGE_NAME: z.string().trim().min(1).default('ASEL Siege'),
  SIEGE_LAT: z.coerce.number().min(-90).max(90).default(36.8065),
  SIEGE_LNG: z.coerce.number().min(-180).max(180).default(10.1815),
  SIEGE_RADIUS_METERS: z.coerce.number().int().min(20).max(5000).default(300),
  SEED_ADMIN_USERNAME: z.string().default('admin'),
  SEED_ADMIN_PASSWORD: z.string().default('ChangeMeNow!2024'),
  SEED_SHARED_PASSWORD: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  COOKIE_SECURE:
    parsed.data.COOKIE_SECURE !== undefined
      ? parsed.data.COOKIE_SECURE === 'true'
      : parsed.data.NODE_ENV === 'production',
  BACKUP_ENABLED: parsed.data.BACKUP_ENABLED !== 'false',
  OCR_LOCAL_ENABLED: parsed.data.OCR_LOCAL_ENABLED !== 'false',
  SEED_SHARED_PASSWORD: parsed.data.SEED_SHARED_PASSWORD ?? parsed.data.SEED_ADMIN_PASSWORD,
};
export type Env = typeof env;
