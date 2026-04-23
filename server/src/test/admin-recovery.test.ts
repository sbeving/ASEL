import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { buildApp, createUser, loginAs, resetDb, startTestDb, stopTestDb } from './harness.js';

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

describe('admin password reset + force logout', () => {
  it('admin reset-password unlocks the user and sets a new working password', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const target = await createUser({ username: 'bob', password: 'pass1234', role: 'manager' });

    // Lock bob with too many failed logins
    for (let i = 0; i < 8; i++) {
      await supertest(app)
        .post('/api/auth/login')
        .send({ username: 'bob', password: 'nope' });
    }
    const locked = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'pass1234' });
    expect(locked.status).toBe(423);

    const admin = await loginAs(app, 'admin', 'admin1234');
    const reset = await admin
      .post(`/api/users/${target._id.toString()}/reset-password`)
      .send({ password: 'NewPass!2024' });
    expect(reset.status).toBe(200);

    await loginAs(app, 'bob', 'NewPass!2024'); // throws if fails
  });

  it('admin reset-password rejects a weak password', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const target = await createUser({ username: 'bob', password: 'pass1234', role: 'manager' });
    const admin = await loginAs(app, 'admin', 'admin1234');
    const r = await admin.post(`/api/users/${target._id.toString()}/reset-password`).send({ password: 'short' });
    expect(r.status).toBe(400);
  });

  it('force-logout invalidates an existing session at its next /auth/me tick', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const target = await createUser({ username: 'bob', password: 'pass1234', role: 'manager' });
    const bob = await loginAs(app, 'bob', 'pass1234');

    const before = await bob.get('/api/auth/me');
    expect(before.status).toBe(200);

    const admin = await loginAs(app, 'admin', 'admin1234');
    await admin.post(`/api/users/${target._id.toString()}/force-logout`).expect(200);

    const after = await bob.get('/api/auth/me');
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHORIZED');
  });

  it('changing your own password bumps tokenVersion but keeps your current session alive', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const agent = await loginAs(app, 'admin', 'admin1234');
    await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'admin1234', newPassword: 'NewPass!2024' })
      .expect(200);
    // The route re-issued the cookie with the bumped tv — current session
    // keeps working.
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
  });
});
