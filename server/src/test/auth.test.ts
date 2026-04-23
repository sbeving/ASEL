import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import {
  buildApp,
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

describe('auth', () => {
  it('rejects login with wrong password', async () => {
    await createUser({ username: 'admin', password: 'correct-horse', role: 'admin' });
    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects login for unknown username with same 401 code', async () => {
    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'nope', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('refuses login for deactivated accounts', async () => {
    const u = await createUser({ username: 'bob', password: 'pass1234', role: 'admin' });
    u.active = false;
    await u.save();
    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'pass1234' });
    expect(res.status).toBe(401);
  });

  it('issues a session cookie on successful login and /me echoes identity', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const agent = await loginAs(app, 'admin', 'admin1234');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('admin');
    expect(me.body.user.role).toBe('admin');
  });

  it('/auth/me is 401 without a cookie', async () => {
    const res = await supertest(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('logout clears the cookie and subsequent /me is 401', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const agent = await loginAs(app, 'admin', 'admin1234');
    await agent.post('/api/auth/logout').expect(200);
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('change-password rejects wrong current password', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const agent = await loginAs(app, 'admin', 'admin1234');
    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'wrong', newPassword: 'NewPass!2024' });
    expect(res.status).toBe(400);
  });

  it('change-password succeeds and new password works', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const agent = await loginAs(app, 'admin', 'admin1234');
    await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'admin1234', newPassword: 'NewPass!2024' })
      .expect(200);
    await loginAs(app, 'admin', 'NewPass!2024'); // throws if fails
  });

  it('change-password rejects a weak new password', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    const agent = await loginAs(app, 'admin', 'admin1234');
    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'admin1234', newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('account lockout', () => {
  it('locks the account after 8 consecutive failed logins and unlocks after a successful change-password', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });

    for (let i = 0; i < 7; i++) {
      const r = await supertest(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'wrong-password' });
      expect(r.status).toBe(401);
    }

    // 8th wrong attempt triggers the lock.
    const locking = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong-password' });
    expect(locking.status).toBe(423);
    expect(locking.body.error.code).toBe('ACCOUNT_LOCKED');

    // Correct password is still refused while locked.
    const afterLock = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin1234' });
    expect(afterLock.status).toBe(423);
  });

  it('resets the failed-attempt counter on successful login', async () => {
    await createUser({ username: 'admin', password: 'admin1234', role: 'admin' });
    for (let i = 0; i < 3; i++) {
      await supertest(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'nope' })
        .expect(401);
    }
    // Good login resets the counter.
    await loginAs(app, 'admin', 'admin1234');
    // We should now be able to fail 7 more times before being locked.
    for (let i = 0; i < 7; i++) {
      const r = await supertest(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'nope' });
      expect(r.status).toBe(401);
    }
  });
});
