import type { Request, Response, NextFunction } from 'express';
import { forbidden } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

const SUSPICIOUS_HEADERS = [
  'via',
  'x-proxy-id',
  'x-forwarded-port',
  'x-vpn',
  'x-tor',
  'x-anonymouse',
  'x-proxy-user',
];

const BOT_USER_AGENTS = [
  'bot', 'crawl', 'spider', 'slurp', 'mediapartners',
  'curl', 'wget', 'postman', 'insomnia', 'python-requests'
];

export function antiBotMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Check for common proxy / VPN headers
  const hasProxyHeader = SUSPICIOUS_HEADERS.some((header) => !!req.headers[header]);

  if (hasProxyHeader) {
    logger.warn({ ip: req.ip, headers: req.headers }, 'Blocked request due to suspicious proxy/VPN headers');
    return next(forbidden('VPNs and Proxies are not allowed. Please use a direct connection.'));
  }

  // Check for generic bot user-agents
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const isBot = BOT_USER_AGENTS.some((botToken) => userAgent.includes(botToken));

  if (isBot) {
    logger.warn({ ip: req.ip, userAgent }, 'Blocked request due to bot User-Agent');
    return next(forbidden('Automated access is not allowed.'));
  }

  next();
}
