import type { Request, RequestHandler, Response } from 'express';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

/**
 * Module-scoped registry so tests can observe metrics, and so we never
 * conflict with other prom-client users in the same process.
 */
export const registry = new Registry();
registry.setDefaultLabels({ app: 'asel-server' });
collectDefaultMetrics({ register: registry });

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests handled by the API, labelled with route template and status class.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

/**
 * Collect per-request metrics. We use the matched Express route template
 * (e.g. `/api/products/:id`) as the `route` label to avoid high cardinality
 * from unique ids.
 */
export const httpMetrics: RequestHandler = (req, res, next) => {
  const endTimer = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const matched = (req as Request & { route?: { path?: string } }).route?.path;
    const route = matched ?? (`${req.baseUrl}${req.route?.path ?? ''}`.trim() || 'unmatched');
    const labels = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    endTimer(labels);
  });
  next();
};

/** Route handler for the /metrics endpoint (Prometheus text format). */
export const metricsHandler: RequestHandler = async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
};
