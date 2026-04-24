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
  SEED_SHARED_PASSWORD: parsed.data.SEED_SHARED_PASSWORD ?? parsed.data.SEED_ADMIN_PASSWORD,
};
export type Env = typeof env;
