import 'dotenv/config';
import './db/setup.js';
import bcrypt from 'bcryptjs';
import { env } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { User } from './models/User.js';
import { Franchise } from './models/Franchise.js';
import { Category } from './models/Category.js';
import { Supplier } from './models/Supplier.js';
import { Product } from './models/Product.js';
import { Stock } from './models/Stock.js';
import { logger } from './utils/logger.js';

async function seed() {
  await connectDb();

  if (await User.countDocuments({ role: 'admin' })) {
    logger.info('Admin user already exists — skipping initial seed.');
    await disconnectDb();
    return;
  }

  // --- Franchises ---
  const franchises = await Franchise.insertMany([
    { name: 'ASEL Mobile — Mourouj', address: 'Mourouj, Ben Arous', phone: '52 123 456', manager: 'Gérant Mourouj' },
    { name: 'ASEL Mobile — Soukra', address: 'Soukra, Ariana', phone: '52 234 567', manager: 'Gérant Soukra' },
  ]);

  // --- Categories ---
  const categoryNames = [
    'Câbles', 'Chargeurs', 'Chargeurs auto', 'Écouteurs', 'Casques',
    'Enceintes', 'Power Banks', 'Supports téléphone', 'Accessoires montre',
    'Montres connectées', 'Téléphones',
  ];
  const categories = await Category.insertMany(categoryNames.map((name) => ({ name })));
  const catByName = new Map(categories.map((c) => [c.name, c._id]));

  // --- Suppliers ---
  const suppliers = await Supplier.insertMany([
    { name: 'Actelo', address: 'Tunisie' },
    { name: 'Mokhtar', address: 'Tunisie' },
  ]);

  // --- Products (abbreviated sample; legacy seed has full list) ---
  const products = await Product.insertMany([
    { name: 'USB-C to USB-C 1m PD60W', categoryId: catByName.get('Câbles'), brand: 'Blackwave', reference: 'BC03CC', purchasePrice: 0, sellPrice: 25 },
    { name: 'Type C vers Lightning PD 27W 1M', categoryId: catByName.get('Câbles'), brand: 'Blackwave', reference: 'BC03CL', purchasePrice: 10, sellPrice: 30 },
    { name: 'Apple USB-C Lightning 1m', categoryId: catByName.get('Câbles'), brand: 'Apple', reference: 'MQKJ3ZM/A', supplierId: suppliers[1]!._id, purchasePrice: 15, sellPrice: 45 },
    { name: 'USB-C PD 35W', categoryId: catByName.get('Chargeurs'), brand: 'PD Adapter', reference: 'S22', purchasePrice: 25, sellPrice: 50 },
    { name: 'Car Charger Dual USB 30W', categoryId: catByName.get('Chargeurs auto'), brand: 'Inkax', reference: 'CA-27', purchasePrice: 12, sellPrice: 30 },
    { name: 'Ecouteurs filaires Celebrat G12', categoryId: catByName.get('Écouteurs'), brand: 'Celebrat', reference: 'G12-B', purchasePrice: 6, sellPrice: 15 },
    { name: 'Casque Marshall Major IV', categoryId: catByName.get('Casques'), brand: 'Marshall', reference: 'MAJOR-IV', purchasePrice: 40, sellPrice: 75 },
    { name: 'Enceinte Bluetooth 5W', categoryId: catByName.get('Enceintes'), brand: 'Generic', reference: 'JZ-200', purchasePrice: 30, sellPrice: 45 },
    { name: 'Power Bank 10000mAh', categoryId: catByName.get('Power Banks'), brand: 'Kakusiga', reference: 'KSC-1083', purchasePrice: 25, sellPrice: 45 },
    { name: 'Support voiture magnétique', categoryId: catByName.get('Supports téléphone'), brand: 'Kakusiga', reference: 'KSC-525', purchasePrice: 15, sellPrice: 35 },
    { name: 'Xiaomi Redmi 13 6/128', categoryId: catByName.get('Téléphones'), brand: 'Xiaomi', reference: 'GPS50-XR13', purchasePrice: 470, sellPrice: 520, lowStockThreshold: 2 },
    { name: 'Samsung A07 4/64', categoryId: catByName.get('Téléphones'), brand: 'Samsung', reference: 'GPS50-SA07', purchasePrice: 355, sellPrice: 399, lowStockThreshold: 2 },
    { name: 'Nokia 105 2024', categoryId: catByName.get('Téléphones'), brand: 'Nokia', reference: 'NOK-105', purchasePrice: 54.4, sellPrice: 65 },
  ]);

  // --- Initial stock: 5 of each for each franchise ---
  await Stock.insertMany(
    franchises.flatMap((f) => products.map((p) => ({ franchiseId: f._id, productId: p._id, quantity: 5 }))),
  );

  // --- Users ---
  const rounds = env.BCRYPT_ROUNDS;
  await User.insertMany([
    {
      username: env.SEED_ADMIN_USERNAME,
      passwordHash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, rounds),
      fullName: 'Administrateur',
      role: 'admin',
      franchiseId: null,
    },
    {
      username: 'mourouj',
      passwordHash: await bcrypt.hash('Mourouj!2024', rounds),
      fullName: 'Gérant Mourouj',
      role: 'franchise',
      franchiseId: franchises[0]!._id,
    },
    {
      username: 'soukra',
      passwordHash: await bcrypt.hash('Soukra!2024', rounds),
      fullName: 'Gérant Soukra',
      role: 'franchise',
      franchiseId: franchises[1]!._id,
    },
  ]);

  logger.info(
    {
      franchises: franchises.length,
      categories: categories.length,
      products: products.length,
    },
    'Seed complete',
  );
  logger.info(
    `Admin credentials: username="${env.SEED_ADMIN_USERNAME}" password="${env.SEED_ADMIN_PASSWORD}" — CHANGE THIS IMMEDIATELY.`,
  );

  await disconnectDb();
}

seed().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
