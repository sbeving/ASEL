import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApp,
  createCategory,
  createFranchise,
  createProduct,
  createUser,
  loginAs,
  resetDb,
  setStock,
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

describe('cursor pagination', () => {
  it('paginates /api/sales with nextCursor and converges', async () => {
    const franchise = await createFranchise('Main');
    const cat = await createCategory();
    const product = await createProduct(cat._id, { sellPrice: 10 });
    await setStock(franchise._id, product._id, 1_000);
    await createUser({
      username: 'alice',
      password: 'pass1234',
      role: 'franchise',
      franchiseId: franchise._id.toString(),
    });
    const agent = await loginAs(app, 'alice', 'pass1234');

    // Record 7 sales
    for (let i = 0; i < 7; i++) {
      await agent
        .post('/api/sales')
        .send({ items: [{ productId: product._id, quantity: 1, unitPrice: 10 }] })
        .expect(201);
      // Force a perceptible createdAt gap so cursor ordering is deterministic.
      await new Promise((r) => setTimeout(r, 5));
    }

    const page1 = await agent.get('/api/sales').query({ limit: 3 });
    expect(page1.status).toBe(200);
    expect(page1.body.sales).toHaveLength(3);
    expect(typeof page1.body.nextCursor).toBe('string');

    const page2 = await agent.get('/api/sales').query({ limit: 3, cursor: page1.body.nextCursor });
    expect(page2.body.sales).toHaveLength(3);
    expect(typeof page2.body.nextCursor).toBe('string');

    const page3 = await agent.get('/api/sales').query({ limit: 3, cursor: page2.body.nextCursor });
    expect(page3.body.sales).toHaveLength(1);
    expect(page3.body.nextCursor).toBeNull();

    // No duplicates across pages
    const ids = [...page1.body.sales, ...page2.body.sales, ...page3.body.sales].map((s: { id: string }) => s.id);
    expect(new Set(ids).size).toBe(7);
  });
});
