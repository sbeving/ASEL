import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import franchiseRoutes from './routes/franchises.js';
import categoryRoutes from './routes/categories.js';
import supplierRoutes from './routes/suppliers.js';
import productRoutes from './routes/products.js';
import stockRoutes from './routes/stock.js';
import saleRoutes from './routes/sales.js';
import transferRoutes from './routes/transfers.js';
import dashboardRoutes from './routes/dashboard.js';
import auditRoutes from './routes/audit.js';

export interface CreateAppOptions {
  /** Disable the request/response logger (useful in tests). */
  quiet?: boolean;
  /** Disable the global rate limiter (tests / benchmarks). */
  rateLimits?: boolean;
}

export function createApp(opts: CreateAppOptions = {}): Express {
  const { quiet = false, rateLimits = true } = opts;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (env.CORS_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (!quiet) app.use(pinoHttp({ logger }));
  if (rateLimits) app.use(apiLimiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/franchises', franchiseRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/stock', stockRoutes);
  app.use('/api/sales', saleRoutes);
  app.use('/api/transfers', transferRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/audit', auditRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
