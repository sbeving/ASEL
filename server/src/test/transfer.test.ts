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
  const [source, dest] = await Promise.all([
    createFranchise('Source'),
    createFranchise('Dest'),
  ]);
  const cat = await createCategory();
  const product = await createProduct(cat._id);
  await setStock(source._id, product._id, 10);
  await setStock(dest._id, product._id, 2);
  await createUser({ username: 'admin', password: 'pass1234', role: 'admin' });
  const admin = await loginAs(app, 'admin', 'pass1234');
  return { source, dest, product, admin };
}

describe('transfers', () => {
  it('admin-created transfer starts in pending status', async () => {
    const { source, dest, product, admin } = await setup();
    const res = await admin.post('/api/transfers').send({
      sourceFranchiseId: source._id,
      destFranchiseId: dest._id,
      productId: product._id,
      quantity: 3,
    });
    expect(res.status).toBe(201);
    expect(res.body.transfer.status).toBe('pending');
  });

  it('accept swaps stock in both franchises', async () => {
    const { source, dest, product, admin } = await setup();
    const { body } = await admin.post('/api/transfers').send({
      sourceFranchiseId: source._id,
      destFranchiseId: dest._id,
      productId: product._id,
      quantity: 3,
    });
    const id = body.transfer.id;
    const accepted = await admin.post(`/api/transfers/${id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.transfer.status).toBe('accepted');

    const [srcStock, dstStock] = await Promise.all([
      Stock.findOne({ franchiseId: source._id, productId: product._id }),
      Stock.findOne({ franchiseId: dest._id, productId: product._id }),
    ]);
    expect(srcStock?.quantity).toBe(7);
    expect(dstStock?.quantity).toBe(5);
  });

  it('reject does not touch stock', async () => {
    const { source, dest, product, admin } = await setup();
    const { body } = await admin.post('/api/transfers').send({
      sourceFranchiseId: source._id,
      destFranchiseId: dest._id,
      productId: product._id,
      quantity: 3,
    });
    const id = body.transfer.id;
    const rej = await admin.post(`/api/transfers/${id}/reject`);
    expect(rej.body.transfer.status).toBe('rejected');

    const [srcStock, dstStock] = await Promise.all([
      Stock.findOne({ franchiseId: source._id, productId: product._id }),
      Stock.findOne({ franchiseId: dest._id, productId: product._id }),
    ]);
    expect(srcStock?.quantity).toBe(10);
    expect(dstStock?.quantity).toBe(2);
  });

  it('accept fails when source has insufficient stock', async () => {
    const { source, dest, product, admin } = await setup();
    const { body } = await admin.post('/api/transfers').send({
      sourceFranchiseId: source._id,
      destFranchiseId: dest._id,
      productId: product._id,
      quantity: 999,
    });
    const id = body.transfer.id;
    const res = await admin.post(`/api/transfers/${id}/accept`);
    expect(res.status).toBe(400);

    const [srcStock, dstStock] = await Promise.all([
      Stock.findOne({ franchiseId: source._id, productId: product._id }),
      Stock.findOne({ franchiseId: dest._id, productId: product._id }),
    ]);
    expect(srcStock?.quantity).toBe(10);
    expect(dstStock?.quantity).toBe(2);
  });

  it('rejects a second accept (already resolved)', async () => {
    const { source, dest, product, admin } = await setup();
    const { body } = await admin.post('/api/transfers').send({
      sourceFranchiseId: source._id,
      destFranchiseId: dest._id,
      productId: product._id,
      quantity: 1,
    });
    const id = body.transfer.id;
    await admin.post(`/api/transfers/${id}/accept`).expect(200);
    const again = await admin.post(`/api/transfers/${id}/accept`);
    expect(again.status).toBe(409);
  });
});
