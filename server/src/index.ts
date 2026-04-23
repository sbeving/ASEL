import { env } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';

async function main() {
  await connectDb();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server listening');
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Shutdown signal received, draining…');
    // Stop accepting new connections; existing ones get up to 10s to finish.
    const closed = new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    const timeout = new Promise<void>((_res, rej) =>
      setTimeout(() => rej(new Error('Forced shutdown after 10s')), 10_000),
    );
    try {
      await Promise.race([closed, timeout]);
      await disconnectDb();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Shutdown error — exiting non-zero');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
