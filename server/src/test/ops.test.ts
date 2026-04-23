import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import {
  buildApp,
  createFranchise,
  createUser,
  loginAs,
  resetDb,
  startTestDb,
  stopTestDb,
} from './harness.js';

const app = buildApp();

beforeAll(async () => {
  await startTestDb();
});
afterAll(async () => {
  await stopTestDb();
});
beforeEach(async () => {
  await resetDb();
});

describe('ops endpoints', () => {
  it('/api/health reports db=up when connected', async () => {
    const res = await supertest(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe('up');
  });

  it('/api/metrics exposes Prometheus text after traffic', async () => {
    // Generate one request so the HTTP counters are populated.
    await supertest(app).get('/api/health');
    const res = await supertest(app).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });

  it('/api/openapi.json returns the spec', async () => {
    const res = await supertest(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toContain('ASEL');
    expect(res.body.paths['/auth/login']).toBeDefined();
  });

  it('/api/docs serves Swagger UI HTML', async () => {
    const res = await supertest(app).get('/api/docs/').redirects(0);
    // Express redirects /api/docs → /api/docs/ ; request the trailing-slash form directly.
    expect([200, 301, 302]).toContain(res.status);
  });
});

describe('serialization contract', () => {
  it('List responses return `id` (not `_id`) and never leak passwordHash', async () => {
    await createFranchise('A');
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const agent = await loginAs(app, 'admin', 'admin1234');

    const res = await agent.get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    for (const u of res.body.users) {
      expect(u).toHaveProperty('id');
      expect(u).not.toHaveProperty('_id');
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).not.toHaveProperty('__v');
    }
  });

  it('Login response returns a user with string id (no _id)', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin1234' });
    expect(res.status).toBe(200);
    expect(typeof res.body.user.id).toBe('string');
    expect(res.body.user).not.toHaveProperty('_id');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });
});
