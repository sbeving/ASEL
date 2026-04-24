import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from './db/connect.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { Franchise } from './models/Franchise.js';
import { Category } from './models/Category.js';
import { Supplier } from './models/Supplier.js';
import { Product } from './models/Product.js';
import { Stock } from './models/Stock.js';
import { User } from './models/User.js';
import { Client } from './models/Client.js';
import { Sale } from './models/Sale.js';
import { Transfer } from './models/Transfer.js';
import { Reception } from './models/Reception.js';
import { Installment } from './models/Installment.js';
import { Closing } from './models/Closing.js';
import { MonthlyInventory } from './models/MonthlyInventory.js';
import { Movement } from './models/Movement.js';
import { CashFlow } from './models/CashFlow.js';
import { Return } from './models/Return.js';
import { Demand } from './models/Demand.js';
import { Service } from './models/Service.js';
import { Prestation } from './models/Prestation.js';
import { TimeLog } from './models/TimeLog.js';
import { NetworkPoint } from './models/NetworkPoint.js';
import { Notification } from './models/Notification.js';
import { AuditLog } from './models/AuditLog.js';

type ObjectIdLike = string | { toString(): string };

function idOf(value: ObjectIdLike): string {
  return typeof value === 'string' ? value : value.toString();
}

function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function receptionLine(productId: ObjectIdLike, quantity: number, unitPriceHt: number, vatRate = 19) {
  const unitPriceTtc = round2(unitPriceHt * (1 + vatRate / 100));
  const totalHt = round2(unitPriceHt * quantity);
  const totalTtc = round2(unitPriceTtc * quantity);
  return {
    productId,
    quantity,
    unitPriceHt,
    vatRate,
    unitPriceTtc,
    totalHt,
    totalTtc,
  };
}

async function resetCollections() {
  await Promise.all([
    AuditLog.deleteMany({}),
    Notification.deleteMany({}),
    TimeLog.deleteMany({}),
    Prestation.deleteMany({}),
    Service.deleteMany({}),
    NetworkPoint.deleteMany({}),
    Demand.deleteMany({}),
    Return.deleteMany({}),
    CashFlow.deleteMany({}),
    Movement.deleteMany({}),
    Installment.deleteMany({}),
    Closing.deleteMany({}),
    MonthlyInventory.deleteMany({}),
    Reception.deleteMany({}),
    Transfer.deleteMany({}),
    Sale.deleteMany({}),
    Stock.deleteMany({}),
    Product.deleteMany({}),
    Supplier.deleteMany({}),
    Category.deleteMany({}),
    Client.deleteMany({}),
    User.deleteMany({}),
    Franchise.deleteMany({}),
  ]);
}

async function adjustStockAndMovement(params: {
  franchiseId: ObjectIdLike;
  productId: ObjectIdLike;
  delta: number;
  type: 'stock_in' | 'sale' | 'transfer_in' | 'transfer_out' | 'return' | 'adjustment';
  userId: ObjectIdLike;
  unitPrice: number;
  note: string;
  refId?: ObjectIdLike | null;
  at?: Date;
}) {
  const at = params.at ?? new Date();
  await Stock.updateOne(
    { franchiseId: params.franchiseId, productId: params.productId },
    { $inc: { quantity: params.delta } },
    { upsert: true },
  );

  await Movement.create({
    franchiseId: params.franchiseId,
    productId: params.productId,
    type: params.type,
    delta: params.delta,
    unitPrice: params.unitPrice,
    note: params.note,
    userId: params.userId,
    refId: params.refId ?? null,
    createdAt: at,
    updatedAt: at,
  });
}

async function seed() {
  const noReset = process.argv.includes('--no-reset');
  await connectDb();

  if (!noReset) {
    await resetCollections();
    logger.info('Seed reset complete.');
  } else {
    const alreadyInitialized = await User.exists({});
    if (alreadyInitialized) {
      logger.warn('Skipping seed because data already exists and --no-reset was provided.');
      await disconnectDb();
      return;
    }
  }

  const adminPassword = env.SEED_ADMIN_PASSWORD;
  const sharedPassword = env.SEED_SHARED_PASSWORD;
  const adminHash = await bcrypt.hash(adminPassword, env.BCRYPT_ROUNDS);
  const sharedHash = await bcrypt.hash(sharedPassword, env.BCRYPT_ROUNDS);

  const franchises = await Franchise.insertMany([
    {
      name: 'ASEL Stock Central',
      address: 'Centre logistique ASEL, Tunis',
      phone: '+216 71 000 100',
      manager: 'Central Manager',
      gps: { lat: 36.8065, lng: 10.1815 },
      active: true,
    },
    {
      name: 'ASEL Mobile Mourouj',
      address: 'Mourouj 5, Ben Arous',
      phone: '+216 52 123 456',
      manager: 'Yassine Mourouj',
      gps: { lat: 36.734, lng: 10.213 },
      active: true,
    },
    {
      name: 'ASEL Mobile Soukra',
      address: 'Avenue de la Soukra, Ariana',
      phone: '+216 52 234 567',
      manager: 'Nour Soukra',
      gps: { lat: 36.878, lng: 10.272 },
      active: true,
    },
  ]);

  const central = must(franchises[0], 'Central franchise missing');
  const mourouj = must(franchises[1], 'Mourouj franchise missing');
  const soukra = must(franchises[2], 'Soukra franchise missing');

  const categories = await Category.insertMany([
    { name: 'Cables', description: 'USB, Lightning, Type-C cables' },
    { name: 'Chargeurs', description: 'Wall and car chargers' },
    { name: 'Audio', description: 'Earbuds, headphones, speakers' },
    { name: 'Power Banks', description: 'Portable batteries' },
    { name: 'Phones', description: 'Smartphones and feature phones' },
    { name: 'Wearables', description: 'Smartwatches and accessories' },
    { name: 'Services Accessories', description: 'SIM and service accessories' },
  ]);
  const categoryByName = new Map(categories.map((category) => [category.name, category]));

  const suppliers = await Supplier.insertMany([
    { name: 'Actelo', phone: '+216 70 111 111', email: 'contact@actelo.tn', address: 'Tunis' },
    { name: 'Mokhtar Trading', phone: '+216 70 222 222', email: 'sales@mokhtar.tn', address: 'Sfax' },
    { name: 'Infogenie', phone: '+216 53 193 192', email: 'hello@infogenie.tn', address: 'Lafayette, Tunis' },
  ]);
  const supplierByName = new Map(suppliers.map((supplier) => [supplier.name, supplier]));

  const products = await Product.insertMany([
    {
      name: 'Blackwave USB-C to USB-C 1m 60W',
      categoryId: must(categoryByName.get('Cables'), 'Category Cables missing')._id,
      supplierId: must(supplierByName.get('Actelo'), 'Supplier Actelo missing')._id,
      brand: 'Blackwave',
      reference: 'BW-CBL-C-C-1M',
      barcode: '619300110001',
      purchasePrice: 8,
      sellPrice: 18,
      lowStockThreshold: 6,
      active: true,
    },
    {
      name: 'Blackwave Type-C to Lightning 1m 27W',
      categoryId: must(categoryByName.get('Cables'), 'Category Cables missing')._id,
      supplierId: must(supplierByName.get('Actelo'), 'Supplier Actelo missing')._id,
      brand: 'Blackwave',
      reference: 'BW-CBL-C-L-1M',
      barcode: '619300110002',
      purchasePrice: 10,
      sellPrice: 24,
      lowStockThreshold: 5,
      active: true,
    },
    {
      name: 'PD Wall Charger 35W',
      categoryId: must(categoryByName.get('Chargeurs'), 'Category Chargeurs missing')._id,
      supplierId: must(supplierByName.get('Mokhtar Trading'), 'Supplier Mokhtar missing')._id,
      brand: 'ASEL',
      reference: 'ASEL-PD35',
      barcode: '619300110010',
      purchasePrice: 18,
      sellPrice: 39,
      lowStockThreshold: 5,
      active: true,
    },
    {
      name: 'Dual USB Car Charger 30W',
      categoryId: must(categoryByName.get('Chargeurs'), 'Category Chargeurs missing')._id,
      supplierId: must(supplierByName.get('Actelo'), 'Supplier Actelo missing')._id,
      brand: 'Inkax',
      reference: 'INK-CC30',
      barcode: '619300110011',
      purchasePrice: 12,
      sellPrice: 29,
      lowStockThreshold: 4,
      active: true,
    },
    {
      name: 'Celebrat G12 Wired Earbuds',
      categoryId: must(categoryByName.get('Audio'), 'Category Audio missing')._id,
      supplierId: must(supplierByName.get('Mokhtar Trading'), 'Supplier Mokhtar missing')._id,
      brand: 'Celebrat',
      reference: 'CEL-G12',
      barcode: '619300110020',
      purchasePrice: 5,
      sellPrice: 14,
      lowStockThreshold: 8,
      active: true,
    },
    {
      name: 'Kakusiga Power Bank 10000mAh',
      categoryId: must(categoryByName.get('Power Banks'), 'Category Power Banks missing')._id,
      supplierId: must(supplierByName.get('Infogenie'), 'Supplier Infogenie missing')._id,
      brand: 'Kakusiga',
      reference: 'KKS-PB10',
      barcode: '619300110030',
      purchasePrice: 20,
      sellPrice: 45,
      lowStockThreshold: 4,
      active: true,
    },
    {
      name: 'Xiaomi Redmi 13 6/128',
      categoryId: must(categoryByName.get('Phones'), 'Category Phones missing')._id,
      supplierId: must(supplierByName.get('Infogenie'), 'Supplier Infogenie missing')._id,
      brand: 'Xiaomi',
      reference: 'XIA-REDMI13-6128',
      barcode: '619300110040',
      purchasePrice: 470,
      sellPrice: 549,
      lowStockThreshold: 2,
      active: true,
    },
    {
      name: 'Samsung A07 4/64',
      categoryId: must(categoryByName.get('Phones'), 'Category Phones missing')._id,
      supplierId: must(supplierByName.get('Infogenie'), 'Supplier Infogenie missing')._id,
      brand: 'Samsung',
      reference: 'SMS-A07-464',
      barcode: '619300110041',
      purchasePrice: 355,
      sellPrice: 399,
      lowStockThreshold: 2,
      active: true,
    },
    {
      name: 'Nokia 105 2024',
      categoryId: must(categoryByName.get('Phones'), 'Category Phones missing')._id,
      supplierId: must(supplierByName.get('Mokhtar Trading'), 'Supplier Mokhtar missing')._id,
      brand: 'Nokia',
      reference: 'NOK-105-2024',
      barcode: '619300110042',
      purchasePrice: 54,
      sellPrice: 69,
      lowStockThreshold: 3,
      active: true,
    },
    {
      name: 'Smartwatch Magnetic Strap 22mm',
      categoryId: must(categoryByName.get('Wearables'), 'Category Wearables missing')._id,
      supplierId: must(supplierByName.get('Actelo'), 'Supplier Actelo missing')._id,
      brand: 'ASEL',
      reference: 'ASL-STRP22',
      barcode: '619300110050',
      purchasePrice: 7,
      sellPrice: 16,
      lowStockThreshold: 6,
      active: true,
    },
    {
      name: 'SIM Registration Kit',
      categoryId: must(categoryByName.get('Services Accessories'), 'Category Services Accessories missing')._id,
      supplierId: must(supplierByName.get('Actelo'), 'Supplier Actelo missing')._id,
      brand: 'ASEL',
      reference: 'ASEL-SIM-KIT',
      barcode: '619300110060',
      purchasePrice: 2,
      sellPrice: 8,
      lowStockThreshold: 10,
      active: true,
    },
  ]);
  const productByRef = new Map(products.map((product) => [product.reference || product.name, product]));

  const users = await User.insertMany([
    {
      username: env.SEED_ADMIN_USERNAME,
      passwordHash: adminHash,
      fullName: 'ASEL Admin',
      role: 'admin',
      franchiseId: null,
      active: true,
    },
    {
      username: 'superadmin',
      passwordHash: sharedHash,
      fullName: 'ASEL Super Admin',
      role: 'superadmin',
      franchiseId: null,
      active: true,
    },
    {
      username: 'manager',
      passwordHash: sharedHash,
      fullName: 'Operations Manager',
      role: 'manager',
      franchiseId: null,
      active: true,
    },
    {
      username: 'central',
      passwordHash: sharedHash,
      fullName: 'Central Supervisor',
      role: 'franchise',
      franchiseId: central._id,
      active: true,
    },
    {
      username: 'mourouj',
      passwordHash: sharedHash,
      fullName: 'Mourouj Manager',
      role: 'franchise',
      franchiseId: mourouj._id,
      active: true,
    },
    {
      username: 'soukra',
      passwordHash: sharedHash,
      fullName: 'Soukra Manager',
      role: 'franchise',
      franchiseId: soukra._id,
      active: true,
    },
    {
      username: 'seller_mourouj',
      passwordHash: sharedHash,
      fullName: 'Seller Mourouj',
      role: 'seller',
      franchiseId: mourouj._id,
      active: true,
    },
    {
      username: 'vendeur_soukra',
      passwordHash: sharedHash,
      fullName: 'Vendeur Soukra',
      role: 'vendeur',
      franchiseId: soukra._id,
      active: true,
    },
    {
      username: 'viewer_central',
      passwordHash: sharedHash,
      fullName: 'Viewer Central',
      role: 'viewer',
      franchiseId: central._id,
      active: true,
    },
  ]);
  const userByUsername = new Map(users.map((user) => [user.username, user]));

  const clients = await Client.insertMany([
    {
      firstName: 'Ahmed',
      lastName: 'Trabelsi',
      fullName: 'Ahmed Trabelsi',
      phone: '52111222',
      email: 'ahmed.trabelsi@example.com',
      clientType: 'walkin',
      franchiseId: mourouj._id,
      active: true,
    },
    {
      firstName: 'Sarra',
      lastName: 'Ben Ali',
      fullName: 'Sarra Ben Ali',
      phone: '53122334',
      email: 'sarra.benali@example.com',
      clientType: 'boutique',
      company: 'SB Telecom',
      taxId: 'MF-458998',
      franchiseId: mourouj._id,
      active: true,
    },
    {
      firstName: 'Nour',
      lastName: 'Hammami',
      fullName: 'Nour Hammami',
      phone: '54133445',
      clientType: 'passager',
      franchiseId: soukra._id,
      active: true,
    },
    {
      firstName: 'Youssef',
      lastName: 'Mansouri',
      fullName: 'Youssef Mansouri',
      phone: '55144556',
      clientType: 'wholesale',
      company: 'YM Distribution',
      franchiseId: central._id,
      active: true,
    },
  ]);
  const clientAhmed = must(clients[0], 'Client Ahmed missing');
  const clientSarra = must(clients[1], 'Client Sarra missing');
  const clientNour = must(clients[2], 'Client Nour missing');
  const clientYoussef = must(clients[3], 'Client Youssef missing');

  const services = await Service.insertMany([
    {
      name: 'Activation SIM',
      category: 'compte',
      price: 12,
      description: 'SIM card activation with identity verification',
      durationMinutes: 20,
      active: true,
    },
    {
      name: 'Data Transfer',
      category: 'technique',
      price: 35,
      description: 'Phone to phone full data transfer',
      durationMinutes: 45,
      active: true,
    },
    {
      name: 'Screen Protector Installation',
      category: 'autre',
      price: 8,
      description: 'Tempered glass installation',
      durationMinutes: 10,
      active: true,
    },
  ]);
  const serviceActivation = must(services[0], 'Activation service missing');
  const serviceDataTransfer = must(services[1], 'Data transfer service missing');

  const networkPoints = await NetworkPoint.insertMany([
    {
      name: 'Point Relais Bab Saadoun',
      type: 'recharge',
      status: 'actif',
      address: 'Bab Saadoun, Tunis',
      city: 'Tunis',
      governorate: 'Tunis',
      phone: '+216 20 100 200',
      responsible: 'Imed',
      gps: { lat: 36.8061, lng: 10.1659 },
      franchiseId: central._id,
      commissionPct: 4,
      active: true,
      createdBy: must(userByUsername.get('manager'), 'manager user missing')._id,
      contactDate: daysAgo(60),
      contractDate: daysAgo(52),
      activationDate: daysAgo(45),
    },
    {
      name: 'Boutique Menzah 6',
      type: 'activation_recharge',
      status: 'contrat_signe',
      address: 'Menzah 6',
      city: 'Ariana',
      governorate: 'Ariana',
      phone: '+216 20 100 201',
      responsible: 'Maha',
      gps: { lat: 36.8587, lng: 10.1622 },
      franchiseId: soukra._id,
      commissionPct: 5,
      active: true,
      createdBy: must(userByUsername.get('manager'), 'manager user missing')._id,
      contactDate: daysAgo(20),
      contractDate: daysAgo(12),
      activationDate: null,
    },
    {
      name: 'Prospect Ariana Centre',
      type: 'activation',
      status: 'prospect',
      address: 'Ariana Centre',
      city: 'Ariana',
      governorate: 'Ariana',
      phone: '+216 20 100 202',
      responsible: 'Hichem',
      gps: { lat: 36.8663, lng: 10.1952 },
      franchiseId: null,
      commissionPct: 0,
      active: true,
      createdBy: must(userByUsername.get('manager'), 'manager user missing')._id,
      contactDate: daysAgo(3),
      contractDate: null,
      activationDate: null,
    },
  ]);

  const stockSeed: Array<{ franchiseId: ObjectIdLike; productId: ObjectIdLike; quantity: number }> = [];
  for (const product of products) {
    stockSeed.push({ franchiseId: central._id, productId: product._id, quantity: 45 });
    stockSeed.push({ franchiseId: mourouj._id, productId: product._id, quantity: 10 });
    stockSeed.push({ franchiseId: soukra._id, productId: product._id, quantity: 8 });
  }
  await Stock.insertMany(stockSeed);

  const pCable = must(productByRef.get('BW-CBL-C-C-1M'), 'Cable product missing');
  const pLightning = must(productByRef.get('BW-CBL-C-L-1M'), 'Lightning cable missing');
  const pPd35 = must(productByRef.get('ASEL-PD35'), 'PD35 product missing');
  const pPowerBank = must(productByRef.get('KKS-PB10'), 'Powerbank product missing');
  const pRedmi = must(productByRef.get('XIA-REDMI13-6128'), 'Redmi product missing');
  const pA07 = must(productByRef.get('SMS-A07-464'), 'A07 product missing');
  const pNokia = must(productByRef.get('NOK-105-2024'), 'Nokia product missing');

  const sellerMourouj = must(userByUsername.get('seller_mourouj'), 'seller_mourouj missing');
  const vendeurSoukra = must(userByUsername.get('vendeur_soukra'), 'vendeur_soukra missing');
  const managerUser = must(userByUsername.get('manager'), 'manager user missing');
  const adminUser = must(userByUsername.get(env.SEED_ADMIN_USERNAME), 'admin user missing');

  const sale1 = await Sale.create({
    invoiceNumber: 'FAC-2026-0001',
    saleType: 'facture',
    franchiseId: mourouj._id,
    clientId: clientAhmed._id,
    userId: sellerMourouj._id,
    items: [
      { productId: pCable._id, quantity: 2, unitPrice: pCable.sellPrice, total: round2(2 * pCable.sellPrice) },
      { productId: pPd35._id, quantity: 1, unitPrice: pPd35.sellPrice, total: pPd35.sellPrice },
    ],
    subtotal: round2(2 * pCable.sellPrice + pPd35.sellPrice),
    discount: 4,
    total: round2(2 * pCable.sellPrice + pPd35.sellPrice - 4),
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    amountReceived: round2(2 * pCable.sellPrice + pPd35.sellPrice - 4),
    changeDue: 0,
    note: 'Counter sale with discount',
    createdAt: hoursAgo(20),
    updatedAt: hoursAgo(20),
  });

  const sale2 = await Sale.create({
    invoiceNumber: 'FAC-2026-0002',
    saleType: 'facture',
    franchiseId: soukra._id,
    clientId: clientNour._id,
    userId: vendeurSoukra._id,
    items: [{ productId: pPowerBank._id, quantity: 2, unitPrice: pPowerBank.sellPrice, total: round2(2 * pPowerBank.sellPrice) }],
    subtotal: round2(2 * pPowerBank.sellPrice),
    discount: 0,
    total: round2(2 * pPowerBank.sellPrice),
    paymentMethod: 'card',
    paymentStatus: 'paid',
    amountReceived: round2(2 * pPowerBank.sellPrice),
    changeDue: 0,
    note: 'Card payment sale',
    createdAt: hoursAgo(12),
    updatedAt: hoursAgo(12),
  });

  const installmentTotal = round2(pRedmi.sellPrice + pLightning.sellPrice);
  const upfront = 200;
  const remaining = round2(installmentTotal - upfront);
  const sale3 = await Sale.create({
    invoiceNumber: 'FAC-2026-0003',
    saleType: 'facture',
    franchiseId: mourouj._id,
    clientId: clientSarra._id,
    userId: sellerMourouj._id,
    items: [
      { productId: pRedmi._id, quantity: 1, unitPrice: pRedmi.sellPrice, total: pRedmi.sellPrice },
      { productId: pLightning._id, quantity: 1, unitPrice: pLightning.sellPrice, total: pLightning.sellPrice },
    ],
    subtotal: installmentTotal,
    discount: 0,
    total: installmentTotal,
    paymentMethod: 'installment',
    paymentStatus: 'partial',
    amountReceived: upfront,
    changeDue: 0,
    installmentPlan: {
      totalLots: 3,
      intervalDays: 30,
      upfrontAmount: upfront,
      remainingAmount: remaining,
      firstDueDate: daysFromNow(30),
      generatedLots: 3,
    },
    note: 'Installment plan sale',
    createdAt: hoursAgo(8),
    updatedAt: hoursAgo(8),
  });

  const sale4 = await Sale.create({
    invoiceNumber: 'TCK-2026-0101',
    saleType: 'ticket',
    franchiseId: central._id,
    clientId: clientYoussef._id,
    userId: must(userByUsername.get('central'), 'central user missing')._id,
    items: [{ productId: pA07._id, quantity: 1, unitPrice: pA07.sellPrice, total: pA07.sellPrice }],
    subtotal: pA07.sellPrice,
    discount: 0,
    total: pA07.sellPrice,
    paymentMethod: 'transfer',
    paymentStatus: 'paid',
    amountReceived: pA07.sellPrice,
    changeDue: 0,
    note: 'Wholesale phone ticket',
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(5),
  });

  const saleMovements = [
    { sale: sale1, franchiseId: mourouj._id, items: sale1.items, userId: sellerMourouj._id, at: hoursAgo(20) },
    { sale: sale2, franchiseId: soukra._id, items: sale2.items, userId: vendeurSoukra._id, at: hoursAgo(12) },
    { sale: sale3, franchiseId: mourouj._id, items: sale3.items, userId: sellerMourouj._id, at: hoursAgo(8) },
    { sale: sale4, franchiseId: central._id, items: sale4.items, userId: must(userByUsername.get('central'), 'central user missing')._id, at: hoursAgo(5) },
  ];

  for (const movementSet of saleMovements) {
    for (const item of movementSet.items) {
      await adjustStockAndMovement({
        franchiseId: movementSet.franchiseId,
        productId: item.productId,
        delta: -item.quantity,
        type: 'sale',
        userId: movementSet.userId,
        unitPrice: item.unitPrice,
        note: `Sale ${movementSet.sale.invoiceNumber || movementSet.sale._id.toString()}`,
        refId: movementSet.sale._id,
        at: movementSet.at,
      });
    }
  }

  const receptionValidatedLines = [
    receptionLine(pNokia._id, 8, pNokia.purchasePrice, 19),
    receptionLine(pPowerBank._id, 6, pPowerBank.purchasePrice, 19),
  ];
  const receptionValidatedTotalHt = round2(receptionValidatedLines.reduce((sum, line) => sum + line.totalHt, 0));
  const receptionValidatedTotalTtc = round2(receptionValidatedLines.reduce((sum, line) => sum + line.totalTtc, 0));

  const reception1 = await Reception.create({
    number: 'BR-20260424-1001',
    franchiseId: central._id,
    supplierId: must(supplierByName.get('Mokhtar Trading'), 'Supplier Mokhtar missing')._id,
    receptionDate: hoursAgo(18),
    totalHt: receptionValidatedTotalHt,
    vat: round2(receptionValidatedTotalTtc - receptionValidatedTotalHt),
    totalTtc: receptionValidatedTotalTtc,
    status: 'validated',
    sourceDocumentPath: 'reception-ocr/demo-br-1001.pdf',
    note: 'Central replenishment validated',
    userId: adminUser._id,
    validatedBy: adminUser._id,
    validatedAt: hoursAgo(18),
    lines: receptionValidatedLines,
    createdAt: hoursAgo(18),
    updatedAt: hoursAgo(18),
  });

  for (const line of receptionValidatedLines) {
    await adjustStockAndMovement({
      franchiseId: central._id,
      productId: line.productId,
      delta: line.quantity,
      type: 'stock_in',
      userId: adminUser._id,
      unitPrice: line.unitPriceTtc,
      note: `Reception ${reception1.number}`,
      refId: reception1._id,
      at: hoursAgo(18),
    });
  }

  const receptionDraftLines = [receptionLine(pA07._id, 2, pA07.purchasePrice, 19)];
  const receptionDraftTotalHt = round2(receptionDraftLines.reduce((sum, line) => sum + line.totalHt, 0));
  const receptionDraftTotalTtc = round2(receptionDraftLines.reduce((sum, line) => sum + line.totalTtc, 0));
  await Reception.create({
    number: 'BR-20260424-1002',
    franchiseId: soukra._id,
    supplierId: must(supplierByName.get('Infogenie'), 'Supplier Infogenie missing')._id,
    receptionDate: hoursAgo(2),
    totalHt: receptionDraftTotalHt,
    vat: round2(receptionDraftTotalTtc - receptionDraftTotalHt),
    totalTtc: receptionDraftTotalTtc,
    status: 'draft',
    sourceDocumentPath: 'reception-ocr/demo-br-1002.png',
    note: 'Pending validation after OCR check',
    userId: must(userByUsername.get('soukra'), 'soukra user missing')._id,
    lines: receptionDraftLines,
    createdAt: hoursAgo(2),
    updatedAt: hoursAgo(2),
  });

  const transferAccepted = await Transfer.create({
    sourceFranchiseId: central._id,
    destFranchiseId: soukra._id,
    productId: pNokia._id,
    quantity: 3,
    status: 'accepted',
    requestedBy: must(userByUsername.get('central'), 'central user missing')._id,
    resolvedBy: managerUser._id,
    note: 'Redistribution for local demand',
    resolvedAt: hoursAgo(10),
    createdAt: hoursAgo(11),
    updatedAt: hoursAgo(10),
  });
  await adjustStockAndMovement({
    franchiseId: central._id,
    productId: pNokia._id,
    delta: -3,
    type: 'transfer_out',
    userId: managerUser._id,
    unitPrice: pNokia.purchasePrice,
    note: `Transfer ${transferAccepted._id.toString()} out`,
    refId: transferAccepted._id,
    at: hoursAgo(10),
  });
  await adjustStockAndMovement({
    franchiseId: soukra._id,
    productId: pNokia._id,
    delta: 3,
    type: 'transfer_in',
    userId: managerUser._id,
    unitPrice: pNokia.purchasePrice,
    note: `Transfer ${transferAccepted._id.toString()} in`,
    refId: transferAccepted._id,
    at: hoursAgo(10),
  });

  await Transfer.create({
    sourceFranchiseId: soukra._id,
    destFranchiseId: mourouj._id,
    productId: pPowerBank._id,
    quantity: 2,
    status: 'pending',
    requestedBy: must(userByUsername.get('soukra'), 'soukra user missing')._id,
    note: 'Pending approval by manager',
    createdAt: hoursAgo(1),
    updatedAt: hoursAgo(1),
  });

  await Transfer.create({
    sourceFranchiseId: mourouj._id,
    destFranchiseId: central._id,
    productId: pCable._id,
    quantity: 1,
    status: 'rejected',
    requestedBy: must(userByUsername.get('mourouj'), 'mourouj user missing')._id,
    resolvedBy: managerUser._id,
    note: 'Rejected due to threshold risk',
    resolvedAt: hoursAgo(4),
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(4),
  });

  const return1 = await Return.create({
    franchiseId: mourouj._id,
    productId: pCable._id,
    quantity: 1,
    returnType: 'return',
    unitPrice: pCable.sellPrice,
    reason: 'Factory defect accepted',
    userId: sellerMourouj._id,
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(3),
  });
  await adjustStockAndMovement({
    franchiseId: mourouj._id,
    productId: pCable._id,
    delta: 1,
    type: 'return',
    userId: sellerMourouj._id,
    unitPrice: pCable.sellPrice,
    note: `Return ${return1._id.toString()}`,
    refId: return1._id,
    at: hoursAgo(3),
  });

  await Demand.insertMany([
    {
      franchiseId: soukra._id,
      sourceFranchiseId: central._id,
      productId: pA07._id,
      productName: pA07.name,
      quantity: 3,
      urgency: 'critical',
      note: 'Phone demand spike this weekend',
      status: 'pending',
      requestedBy: must(userByUsername.get('soukra'), 'soukra user missing')._id,
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(2),
    },
    {
      franchiseId: mourouj._id,
      sourceFranchiseId: central._id,
      productId: pPd35._id,
      productName: pPd35.name,
      quantity: 5,
      urgency: 'urgent',
      note: 'Approved and prepared',
      status: 'approved',
      requestedBy: must(userByUsername.get('mourouj'), 'mourouj user missing')._id,
      processedBy: managerUser._id,
      response: 'Approved. Dispatch planned end of day.',
      processedAt: hoursAgo(7),
      createdAt: hoursAgo(9),
      updatedAt: hoursAgo(7),
    },
    {
      franchiseId: mourouj._id,
      sourceFranchiseId: central._id,
      productId: pPowerBank._id,
      productName: pPowerBank.name,
      quantity: 2,
      urgency: 'normal',
      note: 'Delivered from central',
      status: 'delivered',
      requestedBy: must(userByUsername.get('mourouj'), 'mourouj user missing')._id,
      processedBy: managerUser._id,
      response: 'Delivered with transfer TR-accepted.',
      processedAt: hoursAgo(10),
      createdAt: hoursAgo(12),
      updatedAt: hoursAgo(10),
    },
  ]);

  await Prestation.insertMany([
    {
      serviceId: serviceActivation._id,
      franchiseId: mourouj._id,
      clientId: clientAhmed._id,
      saleId: sale1._id,
      billedPrice: 12,
      note: 'SIM registered and tested',
      userId: sellerMourouj._id,
      performedAt: hoursAgo(20),
      createdAt: hoursAgo(20),
      updatedAt: hoursAgo(20),
    },
    {
      serviceId: serviceDataTransfer._id,
      franchiseId: soukra._id,
      clientId: clientNour._id,
      saleId: null,
      billedPrice: 35,
      note: 'Data transfer from old Samsung phone',
      userId: vendeurSoukra._id,
      performedAt: hoursAgo(9),
      createdAt: hoursAgo(9),
      updatedAt: hoursAgo(9),
    },
  ]);

  await CashFlow.insertMany([
    {
      franchiseId: mourouj._id,
      type: 'encaissement',
      amount: sale1.total,
      reason: 'Ventes comptoir',
      reference: sale1.invoiceNumber || sale1._id.toString(),
      date: hoursAgo(20),
      userId: sellerMourouj._id,
    },
    {
      franchiseId: soukra._id,
      type: 'encaissement',
      amount: sale2.total,
      reason: 'Encaissement carte',
      reference: sale2.invoiceNumber || sale2._id.toString(),
      date: hoursAgo(12),
      userId: vendeurSoukra._id,
      attachmentPath: 'treasury-docs/card-slip-0002.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentOriginalName: 'card-slip-0002.pdf',
    },
    {
      franchiseId: mourouj._id,
      type: 'decaissement',
      amount: 180,
      reason: 'Small maintenance expense',
      reference: 'EXP-MOUR-001',
      date: hoursAgo(6),
      userId: must(userByUsername.get('mourouj'), 'mourouj user missing')._id,
      attachmentPath: 'treasury-docs/expense-maintenance-001.jpg',
      attachmentMimeType: 'image/jpeg',
      attachmentOriginalName: 'expense-maintenance-001.jpg',
    },
    {
      franchiseId: central._id,
      type: 'decaissement',
      amount: 420,
      reason: 'Regional logistics fuel',
      reference: 'EXP-CENT-002',
      date: hoursAgo(15),
      userId: must(userByUsername.get('central'), 'central user missing')._id,
    },
  ]);

  await Installment.insertMany([
    {
      saleId: sale3._id,
      franchiseId: mourouj._id,
      clientId: clientSarra._id,
      amount: round2(remaining / 3),
      dueDate: daysAgo(15),
      status: 'paid',
      paidAt: daysAgo(12),
      paymentMethod: 'cash',
      note: 'Lot 1 paid',
      userId: sellerMourouj._id,
      remind7dSent: true,
      remind3dSent: true,
      createdAt: daysAgo(20),
      updatedAt: daysAgo(12),
    },
    {
      saleId: sale3._id,
      franchiseId: mourouj._id,
      clientId: clientSarra._id,
      amount: round2(remaining / 3),
      dueDate: daysAgo(2),
      status: 'late',
      paidAt: null,
      paymentMethod: null,
      note: 'Lot 2 late',
      userId: sellerMourouj._id,
      remind7dSent: true,
      remind3dSent: true,
      createdAt: daysAgo(20),
      updatedAt: daysAgo(1),
    },
    {
      saleId: sale3._id,
      franchiseId: mourouj._id,
      clientId: clientSarra._id,
      amount: round2(remaining - 2 * round2(remaining / 3)),
      dueDate: daysFromNow(28),
      status: 'pending',
      paidAt: null,
      paymentMethod: null,
      note: 'Lot 3 pending',
      userId: sellerMourouj._id,
      createdAt: daysAgo(20),
      updatedAt: daysAgo(20),
    },
  ]);

  const yesterday = daysAgo(1);
  yesterday.setHours(0, 0, 0, 0);

  await Closing.insertMany([
    {
      franchiseId: mourouj._id,
      closingDate: yesterday,
      declaredSalesTotal: round2(sale1.total + sale3.total),
      declaredItemsTotal: 4,
      systemSalesTotal: round2(sale1.total + sale3.total),
      systemItemsTotal: 4,
      comment: 'Closing reconciled with system',
      validated: true,
      submittedBy: must(userByUsername.get('mourouj'), 'mourouj user missing')._id,
      validatedBy: managerUser._id,
      validatedAt: hoursAgo(14),
      createdAt: hoursAgo(16),
      updatedAt: hoursAgo(14),
    },
    {
      franchiseId: soukra._id,
      closingDate: yesterday,
      declaredSalesTotal: round2(sale2.total - 10),
      declaredItemsTotal: 2,
      systemSalesTotal: sale2.total,
      systemItemsTotal: 2,
      comment: 'Difference pending review',
      validated: false,
      submittedBy: must(userByUsername.get('soukra'), 'soukra user missing')._id,
      validatedBy: null,
      validatedAt: null,
      createdAt: hoursAgo(15),
      updatedAt: hoursAgo(15),
    },
  ]);

  const trackedInventoryProducts = new Set([idOf(pCable._id), idOf(pPd35._id), idOf(pRedmi._id)]);
  const mouroujStock = await Stock.find({ franchiseId: mourouj._id }).lean();
  const stockByProduct = new Map(
    mouroujStock
      .filter((stock) => trackedInventoryProducts.has(idOf(stock.productId as ObjectIdLike)))
      .map((stock) => [idOf(stock.productId as ObjectIdLike), stock.quantity]),
  );
  const month = new Date().toISOString().slice(0, 7);

  const monthlyLines = [
    {
      productId: pCable._id,
      systemQuantity: stockByProduct.get(idOf(pCable._id)) ?? 0,
      countedQuantity: stockByProduct.get(idOf(pCable._id)) ?? 0,
      variance: 0,
      note: 'Counted exact',
    },
    {
      productId: pPd35._id,
      systemQuantity: stockByProduct.get(idOf(pPd35._id)) ?? 0,
      countedQuantity: Math.max(0, (stockByProduct.get(idOf(pPd35._id)) ?? 0) - 1),
      variance: -1,
      note: 'One item missing after recount',
    },
    {
      productId: pRedmi._id,
      systemQuantity: stockByProduct.get(idOf(pRedmi._id)) ?? 0,
      countedQuantity: stockByProduct.get(idOf(pRedmi._id)) ?? 0,
      variance: 0,
      note: 'Phone stock accurate',
    },
  ];

  await MonthlyInventory.insertMany([
    {
      franchiseId: mourouj._id,
      month,
      status: 'draft',
      totalSystemQuantity: monthlyLines.reduce((sum, line) => sum + line.systemQuantity, 0),
      totalCountedQuantity: monthlyLines.reduce((sum, line) => sum + line.countedQuantity, 0),
      totalVariance: monthlyLines.reduce((sum, line) => sum + line.variance, 0),
      appliedAdjustments: false,
      note: 'Draft inventory before adjustment confirmation',
      createdBy: must(userByUsername.get('mourouj'), 'mourouj user missing')._id,
      lines: monthlyLines,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    },
    {
      franchiseId: central._id,
      month,
      status: 'finalized',
      totalSystemQuantity: 30,
      totalCountedQuantity: 30,
      totalVariance: 0,
      appliedAdjustments: true,
      note: 'Central monthly inventory finalized',
      createdBy: must(userByUsername.get('central'), 'central user missing')._id,
      finalizedBy: managerUser._id,
      finalizedAt: daysAgo(1),
      lines: [
        { productId: pNokia._id, systemQuantity: 10, countedQuantity: 10, variance: 0, note: 'OK' },
        { productId: pA07._id, systemQuantity: 10, countedQuantity: 10, variance: 0, note: 'OK' },
        { productId: pPowerBank._id, systemQuantity: 10, countedQuantity: 10, variance: 0, note: 'OK' },
      ],
      createdAt: daysAgo(3),
      updatedAt: daysAgo(1),
    },
  ]);

  await TimeLog.insertMany([
    {
      franchiseId: mourouj._id,
      userId: sellerMourouj._id,
      type: 'entree',
      timestamp: hoursAgo(9),
      gps: { lat: 36.7342, lng: 10.2133, address: 'Mourouj Shop Entrance' },
      device: 'android',
      note: 'Shift started',
    },
    {
      franchiseId: mourouj._id,
      userId: sellerMourouj._id,
      type: 'pause_debut',
      timestamp: hoursAgo(6),
      gps: { lat: 36.7342, lng: 10.2133, address: 'Mourouj Shop' },
      device: 'android',
      note: 'Lunch break',
    },
    {
      franchiseId: mourouj._id,
      userId: sellerMourouj._id,
      type: 'pause_fin',
      timestamp: hoursAgo(5.5),
      gps: { lat: 36.7342, lng: 10.2133, address: 'Mourouj Shop' },
      device: 'android',
      note: 'Back from break',
    },
    {
      franchiseId: mourouj._id,
      userId: sellerMourouj._id,
      type: 'sortie',
      timestamp: hoursAgo(1),
      gps: { lat: 36.7342, lng: 10.2133, address: 'Mourouj Shop Exit' },
      device: 'android',
      note: 'Shift ended',
    },
    {
      franchiseId: soukra._id,
      userId: vendeurSoukra._id,
      type: 'entree',
      timestamp: hoursAgo(8),
      gps: { lat: 36.878, lng: 10.272, address: 'Soukra Branch' },
      device: 'ios',
      note: 'Morning check-in',
    },
  ]);

  await Notification.insertMany([
    {
      roleTarget: 'franchise',
      title: 'Daily closing reminder',
      message: 'Submit your daily closing before 20:00.',
      type: 'warning',
      link: '/closings',
      franchiseId: null,
      userId: null,
      createdAt: hoursAgo(4),
      updatedAt: hoursAgo(4),
    },
    {
      userId: sellerMourouj._id,
      franchiseId: mourouj._id,
      title: 'Installment overdue',
      message: 'Client Sarra Ben Ali has one overdue installment.',
      type: 'danger',
      link: '/installments',
      roleTarget: null,
      dedupeKey: 'installment-overdue-sarra',
      createdAt: hoursAgo(2),
      updatedAt: hoursAgo(2),
    },
    {
      franchiseId: soukra._id,
      roleTarget: null,
      userId: null,
      title: 'Reception draft pending',
      message: 'Reception BR-20260424-1002 is still in draft status.',
      type: 'info',
      link: '/receptions',
      createdAt: hoursAgo(1),
      updatedAt: hoursAgo(1),
    },
    {
      roleTarget: 'all',
      title: 'Platform seed complete',
      message: 'Demo platform seeded with full business dataset.',
      type: 'success',
      link: '/',
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  await AuditLog.insertMany([
    {
      userId: adminUser._id,
      username: adminUser.username,
      action: 'seed.bootstrap',
      entity: 'System',
      entityId: null,
      details: { mode: noReset ? 'no-reset' : 'reset' },
      ip: '127.0.0.1',
      userAgent: 'seed-script',
      createdAt: new Date(),
    },
    {
      userId: managerUser._id,
      username: managerUser.username,
      action: 'transfer.accept',
      entity: 'Transfer',
      entityId: transferAccepted._id.toString(),
      franchiseId: soukra._id,
      details: { quantity: 3, productRef: pNokia.reference },
      ip: '127.0.0.1',
      userAgent: 'seed-script',
      createdAt: hoursAgo(10),
    },
    {
      userId: sellerMourouj._id,
      username: sellerMourouj.username,
      action: 'sale.create',
      entity: 'Sale',
      entityId: sale1._id.toString(),
      franchiseId: mourouj._id,
      details: { total: sale1.total, paymentMethod: sale1.paymentMethod },
      ip: '127.0.0.1',
      userAgent: 'seed-script',
      createdAt: hoursAgo(20),
    },
    {
      userId: vendeurSoukra._id,
      username: vendeurSoukra.username,
      action: 'cashflow.create',
      entity: 'CashFlow',
      entityId: null,
      franchiseId: soukra._id,
      details: { reason: 'Encaissement carte' },
      ip: '127.0.0.1',
      userAgent: 'seed-script',
      createdAt: hoursAgo(12),
    },
  ]);

  const [franchiseCount, userCount, productCount, stockCount, saleCount, transferCount, receptionCount, installmentCount, demandCount] =
    await Promise.all([
      Franchise.countDocuments({}),
      User.countDocuments({}),
      Product.countDocuments({}),
      Stock.countDocuments({}),
      Sale.countDocuments({}),
      Transfer.countDocuments({}),
      Reception.countDocuments({}),
      Installment.countDocuments({}),
      Demand.countDocuments({}),
    ]);

  logger.info(
    {
      franchises: franchiseCount,
      users: userCount,
      products: productCount,
      stocks: stockCount,
      sales: saleCount,
      transfers: transferCount,
      receptions: receptionCount,
      installments: installmentCount,
      demands: demandCount,
      services: services.length,
      networkPoints: networkPoints.length,
    },
    'Full seed complete.',
  );

  logger.info({ username: env.SEED_ADMIN_USERNAME }, 'Admin seed user created. Password sourced from environment.');
  logger.info('Shared seeded user password sourced from environment.');

  await disconnectDb();
}

seed().catch(async (error) => {
  logger.error({ err: error }, 'Seed failed');
  await disconnectDb();
  process.exit(1);
});
