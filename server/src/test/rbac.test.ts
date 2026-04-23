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

describe('franchise isolation', () => {
  it('franchise user cannot read stock of another franchise', async () => {
    const [fa, fb] = await Promise.all([createFranchise('A'), createFranchise('B')]);
    const cat = await createCategory();
    const product = await createProduct(cat._id);
    await setStock(fa._id, product._id, 5);
    await setStock(fb._id, product._id, 5);

    await createUser({ username: 'alice', password: 'pass1234', role: 'franchise', franchiseId: fa._id.toString() });
    const agent = await loginAs(app, 'alice', 'pass1234');

    // Own franchise works
    const own = await agent.get('/api/stock').query({ franchiseId: fa._id.toString() });
    expect(own.status).toBe(200);
    expect(own.body.items).toHaveLength(1);

    // Other franchise forbidden
    const other = await agent.get('/api/stock').query({ franchiseId: fb._id.toString() });
    expect(other.status).toBe(403);
  });

  it('franchise user listing sales only sees their own franchise sales', async () => {
    const [fa, fb] = await Promise.all([createFranchise('A'), createFranchise('B')]);
    const cat = await createCategory();
    const product = await createProduct(cat._id);
    await setStock(fa._id, product._id, 10);
    await setStock(fb._id, product._id, 10);

    await createUser({ username: 'alice', password: 'pass1234', role: 'franchise', franchiseId: fa._id.toString() });
    await createUser({ username: 'bob',   password: 'pass1234', role: 'franchise', franchiseId: fb._id.toString() });

    const alice = await loginAs(app, 'alice', 'pass1234');
    const bob = await loginAs(app, 'bob', 'pass1234');

    await alice.post('/api/sales').send({
      items: [{ productId: product._id, quantity: 1, unitPrice: 10 }],
    }).expect(201);
    await bob.post('/api/sales').send({
      items: [{ productId: product._id, quantity: 2, unitPrice: 10 }],
    }).expect(201);

    const aliceSales = await alice.get('/api/sales');
    expect(aliceSales.body.sales).toHaveLength(1);
    expect(aliceSales.body.sales[0].items[0].quantity).toBe(1);

    const bobSales = await bob.get('/api/sales');
    expect(bobSales.body.sales).toHaveLength(1);
    expect(bobSales.body.sales[0].items[0].quantity).toBe(2);
  });

  it('non-admin cannot access /api/users', async () => {
    await createUser({ username: 'mgr', password: 'pass1234', role: 'manager' });
    const agent = await loginAs(app, 'mgr', 'pass1234');
    const res = await agent.get('/api/users');
    expect(res.status).toBe(403);
  });

  it('non-admin cannot access audit log', async () => {
    await createUser({ username: 'mgr', password: 'pass1234', role: 'manager' });
    const agent = await loginAs(app, 'mgr', 'pass1234');
    const res = await agent.get('/api/audit');
    expect(res.status).toBe(403);
  });

  it('seller cannot create products', async () => {
    const fa = await createFranchise('A');
    const cat = await createCategory();
    await createUser({ username: 'sell', password: 'pass1234', role: 'seller', franchiseId: fa._id.toString() });
    const agent = await loginAs(app, 'sell', 'pass1234');
    const res = await agent.post('/api/products').send({ name: 'X', categoryId: cat._id });
    expect(res.status).toBe(403);
  });
});
