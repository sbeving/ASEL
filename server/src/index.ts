import { env } from './config/env.js';
import { connectDb } from './db/connect.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';

async function main() {
  await connectDb();
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server listening');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
