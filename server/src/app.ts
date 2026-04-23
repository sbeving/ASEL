import './db/setup.js'; // must run before any model is imported below
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { requestId } from './middleware/requestId.js';
import { httpMetrics, metricsHandler } from './middleware/metrics.js';
import { openapiSpec } from './openapi.js';

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
  /** Disable metrics collection (per-request timer adds trivial overhead but
   *  tests can opt out to keep the registry clean between runs). */
  metrics?: boolean;
}

export function createApp(opts: CreateAppOptions = {}): Express {
  const { quiet = false, rateLimits = true, metrics = true } = opts;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Swagger UI ships a bundled script that uses eval for schema
          // parsing — allow it only on the docs route via relaxed CSP at the
          // router level below. For the rest of the API, keep it locked down.
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
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
  app.use(requestId);
  if (metrics) app.use(httpMetrics);
  if (!quiet) {
    app.use(
      pinoHttp({
        logger,
        customProps: (req) => ({ reqId: (req as { id?: string }).id }),
      }),
    );
  }
  if (rateLimits) app.use(apiLimiter);

  // --- Ops endpoints (no auth) ---
  app.get('/api/health', (_req, res) => {
    const dbState = mongoose.connection.readyState;
    const ok = dbState === 1;
    res.status(ok ? 200 : 503).json({
      ok,
      db: ok ? 'up' : 'down',
      time: new Date().toISOString(),
    });
  });

  app.get('/api/metrics', metricsHandler);

  // --- API documentation ---
  app.get('/api/openapi.json', (_req, res) => res.json(openapiSpec));
  app.use(
    '/api/docs',
    // Swagger UI uses inline styles + a fetched spec; relax CSP only on
    // these docs pages.
    helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    }),
    swaggerUi.serve,
    swaggerUi.setup(openapiSpec, {
      customSiteTitle: 'ASEL API docs',
      swaggerOptions: { persistAuthorization: true },
    }),
  );

  // --- Domain routes ---
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
