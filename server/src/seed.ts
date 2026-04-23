import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { env } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { User } from './models/User.js';
import { Franchise } from './models/Franchise.js';
import { Category } from './models/Category.js';
import { Supplier } from './models/Supplier.js';
import { Product } from './models/Product.js';
import { Stock } from './models/Stock.js';
import { Sale } from './models/Sale.js';
import { Transfer } from './models/Transfer.js';
import { Reception } from './models/Reception.js';
import { Client } from './models/Client.js';
import { Closing } from './models/Closing.js';
import { Installment } from './models/Installment.js';
import { MonthlyInventory } from './models/MonthlyInventory.js';
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
  const users = await User.insertMany([
    {
      username: env.SEED_ADMIN_USERNAME,
      passwordHash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, rounds),
      fullName: 'Administrateur',
      role: 'admin',
      franchiseId: null,
    },
    {
      username: 'mourouj',
      passwordHash: await bcrypt.hash('mourouj2024', rounds),
      fullName: 'Gérant Mourouj',
      role: 'franchise',
      franchiseId: franchises[0]!._id,
    },
    {
      username: 'soukra',
      passwordHash: await bcrypt.hash('soukra2024', rounds),
      fullName: 'Gérant Soukra',
      role: 'franchise',
      franchiseId: franchises[1]!._id,
    },
  ]);

  const adminUser = users.find((u) => u.role === 'admin');
  const mouroujUser = users.find((u) => u.username === 'mourouj');
  const soukraUser = users.find((u) => u.username === 'soukra');
  if (!adminUser || !mouroujUser || !soukraUser) {
    throw new Error('Seed users are missing');
  }

  // --- Clients ---
  const clients = await Client.insertMany([
    {
      firstName: 'Ahmed',
      lastName: 'Trabelsi',
      fullName: 'Ahmed Trabelsi',
      phone: '52111222',
      email: 'ahmed.trabelsi@example.com',
      clientType: 'walkin',
      franchiseId: franchises[0]!._id,
      active: true,
    },
    {
      firstName: 'Sarra',
      lastName: 'Ben Ali',
      fullName: 'Sarra Ben Ali',
      phone: '53122334',
      clientType: 'boutique',
      company: 'SB Telecom',
      franchiseId: franchises[0]!._id,
      active: true,
    },
    {
      firstName: 'Nour',
      lastName: 'Hammami',
      fullName: 'Nour Hammami',
      phone: '54133445',
      clientType: 'walkin',
      franchiseId: franchises[1]!._id,
      active: true,
    },
  ]);

  const cable = products.find((p) => p.reference === 'BC03CC') || products[0];
  const charger = products.find((p) => p.reference === 'S22') || products[1];
  const phone = products.find((p) => p.reference === 'GPS50-XR13') || products[2];
  const powerBank = products.find((p) => p.reference === 'KSC-1083') || products[3];
  if (!cable || !charger || !phone || !powerBank) {
    throw new Error('Seed products are missing');
  }

  // --- Sales (for dashboard + installments) ---
  const sales = await Sale.insertMany([
    {
      franchiseId: franchises[0]!._id,
      userId: mouroujUser._id,
      items: [
        { productId: cable._id, quantity: 1, unitPrice: cable.sellPrice, total: cable.sellPrice },
        { productId: charger._id, quantity: 1, unitPrice: charger.sellPrice, total: charger.sellPrice },
      ],
      subtotal: cable.sellPrice + charger.sellPrice,
      discount: 5,
      total: cable.sellPrice + charger.sellPrice - 5,
      paymentMethod: 'cash',
      note: 'Vente comptoir seed',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
    {
      franchiseId: franchises[1]!._id,
      userId: soukraUser._id,
      items: [{ productId: powerBank._id, quantity: 2, unitPrice: powerBank.sellPrice, total: powerBank.sellPrice * 2 }],
      subtotal: powerBank.sellPrice * 2,
      discount: 0,
      total: powerBank.sellPrice * 2,
      paymentMethod: 'card',
      note: 'Vente accessoire seed',
      createdAt: new Date(Date.now() - 75 * 60 * 1000),
      updatedAt: new Date(Date.now() - 75 * 60 * 1000),
    },
  ]);

  await Stock.bulkWrite([
    {
      updateOne: {
        filter: { franchiseId: franchises[0]!._id, productId: cable._id },
        update: { $inc: { quantity: -1 } },
      },
    },
    {
      updateOne: {
        filter: { franchiseId: franchises[0]!._id, productId: charger._id },
        update: { $inc: { quantity: -1 } },
      },
    },
    {
      updateOne: {
        filter: { franchiseId: franchises[1]!._id, productId: powerBank._id },
        update: { $inc: { quantity: -2 } },
      },
    },
  ]);

  // --- Transfers ---
  await Transfer.insertMany([
    {
      sourceFranchiseId: franchises[0]!._id,
      destFranchiseId: franchises[1]!._id,
      productId: charger._id,
      quantity: 1,
      status: 'accepted',
      requestedBy: mouroujUser._id,
      resolvedBy: adminUser._id,
      note: 'Rééquilibrage stock chargeurs',
      resolvedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
    {
      sourceFranchiseId: franchises[1]!._id,
      destFranchiseId: franchises[0]!._id,
      productId: powerBank._id,
      quantity: 1,
      status: 'pending',
      requestedBy: soukraUser._id,
      note: 'Demande urgente power bank',
      createdAt: new Date(Date.now() - 50 * 60 * 1000),
      updatedAt: new Date(Date.now() - 50 * 60 * 1000),
    },
  ]);

  await Stock.bulkWrite([
    {
      updateOne: {
        filter: { franchiseId: franchises[0]!._id, productId: charger._id },
        update: { $inc: { quantity: -1 } },
      },
    },
    {
      updateOne: {
        filter: { franchiseId: franchises[1]!._id, productId: charger._id },
        update: { $inc: { quantity: 1 } },
      },
    },
  ]);

  // --- Receptions ---
  await Reception.insertMany([
    {
      number: `BR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-1001`,
      franchiseId: franchises[0]!._id,
      supplierId: suppliers[0]!._id,
      receptionDate: new Date(Date.now() - 8 * 60 * 60 * 1000),
      totalHt: 50,
      vat: 9.5,
      totalTtc: 59.5,
      status: 'validated',
      note: 'Réception validée seed',
      userId: adminUser._id,
      validatedBy: adminUser._id,
      validatedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
      lines: [
        {
          productId: cable._id,
          quantity: 5,
          unitPriceHt: 10,
          vatRate: 19,
          unitPriceTtc: 11.9,
          totalHt: 50,
          totalTtc: 59.5,
        },
      ],
      createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
    },
    {
      number: `BR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-1002`,
      franchiseId: franchises[1]!._id,
      supplierId: suppliers[1]!._id,
      receptionDate: new Date(Date.now() - 60 * 60 * 1000),
      totalHt: 120,
      vat: 22.8,
      totalTtc: 142.8,
      status: 'draft',
      note: 'Brouillon à valider',
      userId: soukraUser._id,
      lines: [
        {
          productId: phone._id,
          quantity: 1,
          unitPriceHt: 120,
          vatRate: 19,
          unitPriceTtc: 142.8,
          totalHt: 120,
          totalTtc: 142.8,
        },
      ],
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    },
  ]);

  await Stock.updateOne(
    { franchiseId: franchises[0]!._id, productId: cable._id },
    { $inc: { quantity: 5 } },
  );

  // --- Closings ---
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  await Closing.insertMany([
    {
      franchiseId: franchises[0]!._id,
      closingDate: yesterday,
      declaredSalesTotal: 95,
      declaredItemsTotal: 3,
      systemSalesTotal: 90,
      systemItemsTotal: 2,
      comment: 'Ecart caisse mineur constaté',
      validated: false,
      submittedBy: mouroujUser._id,
      createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
    },
  ]);

  // --- Installments ---
  await Installment.insertMany([
    {
      saleId: sales[0]!._id,
      franchiseId: franchises[0]!._id,
      clientId: clients[1]!._id,
      amount: 40,
      dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      status: 'pending',
      note: '1ère échéance',
      userId: mouroujUser._id,
    },
    {
      saleId: sales[0]!._id,
      franchiseId: franchises[0]!._id,
      clientId: clients[1]!._id,
      amount: 45,
      dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      status: 'late',
      note: '2ème échéance en retard',
      userId: mouroujUser._id,
    },
  ]);

  // --- Monthly inventory ---
  const latestStock = await Stock.find({ franchiseId: franchises[0]!._id, productId: { $in: [cable._id, charger._id, phone._id] } })
    .select('productId quantity');
  const stockMap = new Map(latestStock.map((s) => [s.productId.toString(), s.quantity]));

  const month = new Date().toISOString().slice(0, 7);
  await MonthlyInventory.insertMany([
    {
      franchiseId: franchises[0]!._id,
      month,
      status: 'draft',
      totalSystemQuantity: (stockMap.get(cable._id.toString()) ?? 0) + (stockMap.get(charger._id.toString()) ?? 0),
      totalCountedQuantity: (stockMap.get(cable._id.toString()) ?? 0) + (stockMap.get(charger._id.toString()) ?? 0) - 1,
      totalVariance: -1,
      appliedAdjustments: false,
      note: 'Brouillon inventaire mensuel',
      createdBy: adminUser._id,
      lines: [
        {
          productId: cable._id,
          systemQuantity: stockMap.get(cable._id.toString()) ?? 0,
          countedQuantity: stockMap.get(cable._id.toString()) ?? 0,
          variance: 0,
          note: 'RAS',
        },
        {
          productId: charger._id,
          systemQuantity: stockMap.get(charger._id.toString()) ?? 0,
          countedQuantity: Math.max(0, (stockMap.get(charger._id.toString()) ?? 0) - 1),
          variance: -1,
          note: '1 pièce manquante',
        },
      ],
    },
  ]);

  logger.info(
    {
      franchises: franchises.length,
      categories: categories.length,
      products: products.length,
      clients: clients.length,
      sales: sales.length,
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
