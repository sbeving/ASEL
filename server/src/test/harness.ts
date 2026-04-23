// Env vars are set by src/test/setup-env.ts before this module loads.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import supertest, { type Test } from 'supertest';
import { createApp } from '../app.js';
import { User } from '../models/User.js';
import { Franchise } from '../models/Franchise.js';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { Stock } from '../models/Stock.js';
import type { Role } from '../utils/roles.js';

let mongod: MongoMemoryServer | null = null;

export async function startTestDb() {
  if (mongod) return;
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

export async function stopTestDb() {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

export async function resetDb() {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export function buildApp(): Express {
  return createApp({ quiet: true, rateLimits: false });
}

interface SeedUser {
  username: string;
  password: string;
  fullName?: string;
  role: Role;
  franchiseId?: string | null;
}

export async function createUser(input: SeedUser) {
  const passwordHash = await bcrypt.hash(input.password, 4);
  return User.create({
    username: input.username,
    passwordHash,
    fullName: input.fullName ?? input.username,
    role: input.role,
    franchiseId: input.franchiseId ?? null,
  });
}

export async function createFranchise(name: string) {
  return Franchise.create({ name });
}

export async function createProduct(categoryId: mongoose.Types.ObjectId, overrides: Partial<Parameters<typeof Product.create>[0]> = {}) {
  return Product.create({
    name: 'Test Product',
    categoryId,
    sellPrice: 10,
    purchasePrice: 5,
    ...overrides,
  });
}

export async function createCategory(name = 'Test Cat') {
  return Category.create({ name });
}

export async function setStock(franchiseId: mongoose.Types.ObjectId, productId: mongoose.Types.ObjectId, quantity: number) {
  await Stock.findOneAndUpdate(
    { franchiseId, productId },
    { $set: { quantity } },
    { upsert: true, new: true },
  );
}

/**
 * Issues a login to the given app and returns a pre-configured supertest
 * agent that carries the auth cookie on every subsequent request.
 */
export async function loginAs(app: Express, username: string, password: string) {
  const agent = supertest.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

export type Agent = ReturnType<typeof supertest.agent>;
export type { Test };
