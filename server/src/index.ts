import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { connectDb } from './db/connect.js';
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
import clientRoutes from './routes/clients.js';
import receptionRoutes from './routes/receptions.js';
import closingRoutes from './routes/closings.js';
import installmentRoutes from './routes/installments.js';
import monthlyInventoryRoutes from './routes/monthlyInventories.js';
import timeLogRoutes from './routes/timeLogs.js';
import cashFlowRoutes from './routes/cashFlows.js';
import returnRoutes from './routes/returns.js';
import demandRoutes from './routes/demands.js';
import serviceRoutes from './routes/services.js';
import networkPointRoutes from './routes/networkPoints.js';
import notificationRoutes from './routes/notifications.js';

async function main() {
  await connectDb();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // same-origin / curl / mobile
        if (env.CORS_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));
  app.use(apiLimiter);

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
  app.use('/api/clients', clientRoutes);
  app.use('/api/receptions', receptionRoutes);
  app.use('/api/closings', closingRoutes);
  app.use('/api/installments', installmentRoutes);
  app.use('/api/monthly-inventories', monthlyInventoryRoutes);
  app.use('/api/timelogs', timeLogRoutes);
  app.use('/api/cashflows', cashFlowRoutes);
  app.use('/api/returns', returnRoutes);
  app.use('/api/demands', demandRoutes);
  app.use('/api/services', serviceRoutes);
  app.use('/api/network-points', networkPointRoutes);
  app.use('/api/notifications', notificationRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server listening');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
