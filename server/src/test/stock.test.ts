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
import { Stock } from '../models/Stock.js';
import { Sale } from '../models/Sale.js';
import { Movement } from '../models/Movement.js';

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

async function setup() {
  const franchise = await createFranchise('Main');
  const cat = await createCategory();
  const product = await createProduct(cat._id, { sellPrice: 20 });
  await setStock(franchise._id, product._id, 5);
  await createUser({
    username: 'alice',
    password: 'pass1234',
    role: 'franchise',
    franchiseId: franchise._id.toString(),
  });
  const agent = await loginAs(app, 'alice', 'pass1234');
  return { franchise, product, agent };
}

describe('sale stock safety', () => {
  it('decrements stock on a successful sale and records a movement', async () => {
    const { franchise, product, agent } = await setup();

    const res = await agent.post('/api/sales').send({
      items: [{ productId: product._id, quantity: 3, unitPrice: 20 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.sale.total).toBe(60);

    const stock = await Stock.findOne({ franchiseId: franchise._id, productId: product._id });
    expect(stock?.quantity).toBe(2);

    const movements = await Movement.find({ franchiseId: franchise._id, type: 'sale' });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.delta).toBe(-3);
  });

  it('rejects a sale that would push stock negative and leaves stock intact', async () => {
    const { franchise, product, agent } = await setup();

    const res = await agent.post('/api/sales').send({
      items: [{ productId: product._id, quantity: 99, unitPrice: 20 }],
    });
    expect(res.status).toBe(400);

    const stock = await Stock.findOne({ franchiseId: franchise._id, productId: product._id });
    expect(stock?.quantity).toBe(5);
    expect(await Sale.countDocuments()).toBe(0);
    expect(await Movement.countDocuments()).toBe(0);
  });

  it('multi-line sale rolls back prior lines when a later line fails', async () => {
    const { franchise, agent } = await setup();
    const cat = await createCategory('Accessories');
    const productA = await createProduct(cat._id, { name: 'A', sellPrice: 10 });
    const productB = await createProduct(cat._id, { name: 'B', sellPrice: 10 });
    await setStock(franchise._id, productA._id, 10);
    await setStock(franchise._id, productB._id, 1);

    const res = await agent.post('/api/sales').send({
      items: [
        { productId: productA._id, quantity: 2, unitPrice: 10 },
        { productId: productB._id, quantity: 5, unitPrice: 10 }, // insufficient
      ],
    });
    expect(res.status).toBe(400);

    // Both stocks must be unchanged and no sale header saved
    const [a, b] = await Promise.all([
      Stock.findOne({ productId: productA._id }),
      Stock.findOne({ productId: productB._id }),
    ]);
    expect(a?.quantity).toBe(10);
    expect(b?.quantity).toBe(1);
    expect(await Sale.countDocuments()).toBe(0);
  });

  it('rejects discount greater than subtotal', async () => {
    const { product, agent } = await setup();
    const res = await agent.post('/api/sales').send({
      items: [{ productId: product._id, quantity: 1, unitPrice: 10 }],
      discount: 999,
    });
    expect(res.status).toBe(400);
  });
});

describe('stock entry', () => {
  it('creates a stock row with the entered quantity', async () => {
    const franchise = await createFranchise('Main');
    const cat = await createCategory();
    const product = await createProduct(cat._id);
    await createUser({
      username: 'alice',
      password: 'pass1234',
      role: 'franchise',
      franchiseId: franchise._id.toString(),
    });
    const agent = await loginAs(app, 'alice', 'pass1234');

    const res = await agent
      .post('/api/stock/entry')
      .send({ productId: product._id, quantity: 7 });
    expect(res.status).toBe(201);

    const stock = await Stock.findOne({ franchiseId: franchise._id, productId: product._id });
    expect(stock?.quantity).toBe(7);
  });
});
