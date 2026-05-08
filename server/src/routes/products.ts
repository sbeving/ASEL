import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import multer from 'multer';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { Supplier } from '../models/Supplier.js';
import { Franchise } from '../models/Franchise.js';
import { Stock } from '../models/Stock.js';
import { Movement } from '../models/Movement.js';
import { Sale } from '../models/Sale.js';
import { audit } from '../services/audit.service.js';
import { attachProductListMetrics, getProductOverview } from '../services/productInsights.service.js';
import { badRequest, notFound } from '../utils/AppError.js';
import { productImageUpload, toUploadPath } from '../middleware/upload.js';
import { applyStockDelta } from '../services/stock.service.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });
const PRODUCT_TYPES = ['standard', 'asel_recharge', 'asel_forfait'] as const;
const PRICE_MODES = ['fixed', 'variable'] as const;
type ProductType = (typeof PRODUCT_TYPES)[number];
type PriceMode = (typeof PRICE_MODES)[number];
const HIGH_PRODUCT_DELETE_ROLES = new Set(['ceo', 'admin', 'superadmin', 'manager']);
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const PRODUCT_IMPORT_COLUMNS = [
  'name',
  'category',
  'supplier',
  'brand',
  'reference',
  'barcode',
  'description',
  'purchasePriceTtc',
  'purchaseTaxRate',
  'sellPriceTtc',
  'sellTaxRate',
  'productType',
  'priceMode',
  'stockManaged',
  'commissionRate',
  'lowStockThreshold',
  'franchise',
  'initialQuantity',
] as const;

function csvCell(value: string | number | null | undefined): string {
  const raw = String(value ?? '');
  return /[",\n\r;]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function parseDelimitedRows(input: string): string[][] {
  const sample = input.split(/\r?\n/, 1)[0] ?? '';
  const delimiters = [',', ';', '\t'];
  const delimiter = delimiters
    .map((candidate) => ({ candidate, count: sample.split(candidate).length }))
    .sort((left, right) => right.count - left.count)[0]?.candidate ?? ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? '';
    const next = input[index + 1] ?? '';
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n') {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function rowValue(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value) return value;
  }
  return '';
}

function parseNumber(value: string, fallback = 0): number {
  if (!value.trim()) return fallback;
  const parsed = Number(value.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function roundMoney(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function normalizeTaxRate(value: unknown, fallback = 19): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, roundMoney(number)));
}

function normalizeRate(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, roundMoney(number)));
}

function normalizeProductType(value: unknown, fallback: ProductType = 'standard'): ProductType {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'recharge' || normalized === 'asel_recharge') return 'asel_recharge';
  if (normalized === 'forfait' || normalized === 'asel_forfait' || normalized === 'package') return 'asel_forfait';
  if (normalized === 'standard') return 'standard';
  return fallback;
}

function normalizePriceMode(value: unknown, fallback: PriceMode = 'fixed'): PriceMode {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'variable' || normalized === 'libre') return 'variable';
  if (normalized === 'fixed' || normalized === 'fixe') return 'fixed';
  return fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'oui', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'non', 'n'].includes(normalized)) return false;
  }
  return fallback;
}

function priceHtFromTtc(ttc: number, taxRate: number): number {
  return roundMoney(taxRate > 0 ? ttc / (1 + taxRate / 100) : ttc);
}

function priceTtcFromHt(ht: number, taxRate: number): number {
  return roundMoney(ht * (1 + taxRate / 100));
}

function normalizePriceBlock(
  input: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  prefix: 'purchase' | 'sell',
) {
  const legacyKey = prefix === 'purchase' ? 'purchasePrice' : 'sellPrice';
  const htKey = `${prefix}PriceHt`;
  const taxKey = `${prefix}TaxRate`;
  const ttcKey = `${prefix}PriceTtc`;
  const previousTax = normalizeTaxRate(existing?.[taxKey], 19);
  const taxRate = normalizeTaxRate(input[taxKey], previousTax);
  const previousTtc = roundMoney(Number(existing?.[ttcKey] ?? existing?.[legacyKey] ?? 0) || 0);
  const previousHt = roundMoney(Number(existing?.[htKey] ?? priceHtFromTtc(previousTtc, taxRate)) || 0);
  const hasTtc = input[ttcKey] !== undefined || input[legacyKey] !== undefined;
  const hasHt = input[htKey] !== undefined;
  const rawTtc = Number(input[ttcKey] ?? input[legacyKey]);
  const rawHt = Number(input[htKey]);

  const priceTtc = hasTtc && Number.isFinite(rawTtc)
    ? roundMoney(rawTtc)
    : hasHt && Number.isFinite(rawHt)
      ? priceTtcFromHt(rawHt, taxRate)
      : previousTtc;
  const priceHt = hasHt && Number.isFinite(rawHt)
    ? roundMoney(rawHt)
    : hasTtc && Number.isFinite(rawTtc)
      ? priceHtFromTtc(priceTtc, taxRate)
      : previousHt;

  return {
    [legacyKey]: priceTtc,
    [htKey]: priceHt,
    [taxKey]: taxRate,
    [ttcKey]: priceTtc,
  };
}

function normalizeProductPayload(input: Record<string, unknown>, existing: Record<string, unknown> | null = null) {
  const existingType = normalizeProductType(existing?.productType, 'standard');
  const productType = normalizeProductType(input.productType, existingType);
  const isAselProduct = productType === 'asel_recharge' || productType === 'asel_forfait';
  const defaultStockManaged = isAselProduct ? false : normalizeBoolean(existing?.stockManaged, true);
  const stockManaged = normalizeBoolean(input.stockManaged, defaultStockManaged);
  const existingPriceMode = normalizePriceMode(existing?.priceMode, 'fixed');
  const priceMode = productType === 'asel_recharge'
    ? 'variable'
    : normalizePriceMode(input.priceMode, productType === 'asel_forfait' ? 'fixed' : existingPriceMode);
  const commissionRate = normalizeRate(input.commissionRate, isAselProduct ? 10 : normalizeRate(existing?.commissionRate, 0));
  const companyShareRate = normalizeRate(input.companyShareRate, isAselProduct ? 90 : normalizeRate(existing?.companyShareRate, 100));
  const franchiseManagerShareRate = normalizeRate(
    input.franchiseManagerShareRate,
    isAselProduct ? 10 : normalizeRate(existing?.franchiseManagerShareRate, 0),
  );

  return {
    ...input,
    ...normalizePriceBlock(input, existing, 'purchase'),
    ...normalizePriceBlock(input, existing, 'sell'),
    productType,
    priceMode,
    stockManaged,
    commissionRate,
    companyShareRate,
    franchiseManagerShareRate,
  };
}

function exactNameRegex(name: string) {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

const upsertSchema = z.object({
  name: z.string().min(1).max(150).trim(),
  categoryId: objectId,
  supplierId: objectId.nullable().optional(),
  brand: z.string().max(80).trim().optional(),
  reference: z.string().max(80).trim().optional(),
  barcode: z.string().max(80).trim().optional(),
  description: z.string().max(1000).trim().optional(),
  purchasePrice: z.number().min(0).optional(),
  purchasePriceHt: z.number().min(0).optional(),
  purchaseTaxRate: z.number().min(0).max(100).optional(),
  purchasePriceTtc: z.number().min(0).optional(),
  sellPrice: z.number().min(0).optional(),
  sellPriceHt: z.number().min(0).optional(),
  sellTaxRate: z.number().min(0).max(100).optional(),
  sellPriceTtc: z.number().min(0).optional(),
  productType: z.enum(PRODUCT_TYPES).optional(),
  priceMode: z.enum(PRICE_MODES).optional(),
  stockManaged: z.boolean().optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  companyShareRate: z.number().min(0).max(100).optional(),
  franchiseManagerShareRate: z.number().min(0).max(100).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const listQuery = z.object({
  q: z.string().max(100).optional(),
  categoryId: objectId.optional(),
  productType: z.enum(PRODUCT_TYPES).optional(),
  stockManaged: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get(
  '/',
  requireAuth,
  requirePermission('products.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { q, categoryId, productType, stockManaged, active, page, pageSize, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const effectivePageSize = limit ?? pageSize;
    const skip = (page - 1) * effectivePageSize;
    const filter: Record<string, unknown> = {};
    if (categoryId) filter.categoryId = categoryId;
    if (productType) filter.productType = productType;
    if (stockManaged !== undefined) filter.stockManaged = stockManaged;
    if (active !== undefined) filter.active = active;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { barcode: q },
        { reference: q },
        { name: rx },
        { reference: rx },
        { barcode: rx },
        { brand: rx },
      ];
    }

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort({ name: 1 }).skip(skip).limit(effectivePageSize).lean(),
    ]);
    const scopedFranchiseId = req.user?.franchiseId ?? null;
    const items = await attachProductListMetrics(products, scopedFranchiseId);

    res.json({
      products: items,
      meta: {
        page,
        pageSize: effectivePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / effectivePageSize)),
      },
    });
  }),
);

router.get(
  '/import/template',
  requireAuth,
  requireRole('admin', 'manager', 'stock_central_maintainer'),
  requirePermission('products.manage'),
  asyncHandler(async (_req, res) => {
    const rows = [
      PRODUCT_IMPORT_COLUMNS,
      [
        'Samsung A15 128Go',
        'Smartphones',
        'Fournisseur exemple',
        'Samsung',
        'A15-128',
        '8800000000000',
        'Couleur noir',
        '450',
        '19',
        '599',
        '19',
        'standard',
        'fixed',
        'true',
        '0',
        '3',
        'Franchise Centre',
        '10',
      ],
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="asel_products_import_template.csv"');
    res.send(`\uFEFF${csv}`);
  }),
);

router.post(
  '/import',
  requireAuth,
  requireRole('admin', 'manager', 'stock_central_maintainer'),
  requirePermission('products.manage'),
  importUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('file is required');
    const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const rows = parseDelimitedRows(text);
    if (rows.length < 2) throw badRequest('Import file must contain a header and at least one product row');

    const headers = rows[0] ?? [];
    const imported: Array<{ row: number; productId: string; name: string; action: 'created' | 'updated'; stockAdded: number }> = [];
    const errors: Array<{ row: number; message: string }> = [];

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const rowNumber = rowIndex + 1;
      const row: Record<string, string> = {};
      headers.forEach((header, columnIndex) => {
        row[normalizeHeader(header)] = rows[rowIndex]?.[columnIndex]?.trim() ?? '';
      });

      try {
        const name = rowValue(row, ['name', 'nom', 'produit']);
        const categoryName = rowValue(row, ['category', 'categorie']);
        const supplierName = rowValue(row, ['supplier', 'fournisseur']);
        const brand = rowValue(row, ['brand', 'marque']);
        const reference = rowValue(row, ['reference', 'ref']);
        const barcode = rowValue(row, ['barcode', 'codebarres', 'code barre']);
        const description = rowValue(row, ['description']);
        const franchiseName = rowValue(row, ['franchise', 'boutique']);
        const purchasePriceTtc = parseNumber(rowValue(row, ['purchasePriceTtc', 'purchasePrice', 'prix achat ttc', 'prix achat', 'prixachat']), 0);
        const purchaseTaxRate = parseNumber(rowValue(row, ['purchaseTaxRate', 'tva achat', 'tax achat']), 19);
        const sellPriceTtc = parseNumber(rowValue(row, ['sellPriceTtc', 'sellPrice', 'prix vente ttc', 'prix vente', 'prixvente']), 0);
        const sellTaxRate = parseNumber(rowValue(row, ['sellTaxRate', 'tva vente', 'tax vente']), 19);
        const productType = normalizeProductType(rowValue(row, ['productType', 'type produit', 'type']), 'standard');
        const priceMode = normalizePriceMode(rowValue(row, ['priceMode', 'mode prix', 'prix mode']), productType === 'asel_recharge' ? 'variable' : 'fixed');
        const stockManaged = normalizeBoolean(rowValue(row, ['stockManaged', 'gestion stock', 'stock gere']), productType === 'standard');
        const commissionRate = normalizeRate(rowValue(row, ['commissionRate', 'commission', 'taux commission']), productType === 'standard' ? 0 : 10);
        const lowStockThreshold = Math.max(0, Math.round(parseNumber(rowValue(row, ['lowStockThreshold', 'seuil', 'seuilalerte']), 3)));
        const initialQuantity = Math.max(0, Math.round(parseNumber(rowValue(row, ['initialQuantity', 'quantite', 'stock']), 0)));

        if (!name) throw new Error('name is required');
        if (!categoryName) throw new Error('category is required');
        if (
          !Number.isFinite(purchasePriceTtc) ||
          !Number.isFinite(purchaseTaxRate) ||
          !Number.isFinite(sellPriceTtc) ||
          !Number.isFinite(sellTaxRate) ||
          !Number.isFinite(initialQuantity)
        ) {
          throw new Error('numeric fields are invalid');
        }

        const category = await Category.findOneAndUpdate(
          { name: exactNameRegex(categoryName) },
          { $setOnInsert: { name: categoryName } },
          { upsert: true, new: true },
        );
        const supplier = supplierName
          ? await Supplier.findOneAndUpdate(
              { name: exactNameRegex(supplierName) },
              { $setOnInsert: { name: supplierName, active: true } },
              { upsert: true, new: true },
            )
          : null;

        const productFilter = barcode
          ? { barcode }
          : reference
            ? { reference }
            : { name: exactNameRegex(name) };
        const existing = await Product.findOne(productFilter);
        const productPayload = normalizeProductPayload({
          name,
          categoryId: category._id,
          supplierId: supplier?._id ?? null,
          brand,
          reference,
          barcode,
          description,
          purchasePriceTtc,
          purchaseTaxRate,
          sellPriceTtc,
          sellTaxRate,
          productType,
          priceMode,
          stockManaged,
          commissionRate,
          companyShareRate: productType === 'standard' ? 100 : 90,
          franchiseManagerShareRate: productType === 'standard' ? 0 : 10,
          lowStockThreshold,
          active: true,
        });
        const product = existing
          ? await Product.findByIdAndUpdate(existing._id, productPayload, { new: true, runValidators: true })
          : await Product.create(productPayload);
        if (!product) throw new Error('product could not be saved');

        let stockAdded = 0;
        if (initialQuantity > 0 && product.stockManaged !== false) {
          if (!franchiseName) throw new Error('franchise is required when initialQuantity is positive');
          const franchise = await Franchise.findOne({ name: exactNameRegex(franchiseName), active: true });
          if (!franchise) throw new Error(`franchise not found: ${franchiseName}`);
          await applyStockDelta({
            franchiseId: franchise._id.toString(),
            productId: product._id.toString(),
            delta: initialQuantity,
            type: 'stock_in',
            userId: req.user!.sub,
            unitPrice: product.purchasePrice,
            note: `Import produits ligne ${rowNumber}`,
          });
          stockAdded = initialQuantity;
        } else if (initialQuantity > 0) {
          throw new Error('initialQuantity is not allowed for products without stock management');
        }

        imported.push({
          row: rowNumber,
          productId: product._id.toString(),
          name: product.name,
          action: existing ? 'updated' : 'created',
          stockAdded,
        });
      } catch (error) {
        errors.push({ row: rowNumber, message: error instanceof Error ? error.message : 'Import error' });
      }
    }

    await audit(req, {
      action: 'product.import',
      entity: 'Product',
      details: { imported: imported.length, errors: errors.length },
    });

    res.status(errors.length > 0 && imported.length === 0 ? 400 : 200).json({
      importedCount: imported.length,
      errorCount: errors.length,
      imported,
      errors,
    });
  }),
);

router.get(
  '/:id/overview',
  requireAuth,
  requirePermission('products.view'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const overview = await getProductOverview(id, req.user?.franchiseId ?? null);
    if (!overview) throw notFound('Product not found');
    res.json(overview);
  }),
);

router.get(
  '/:id',
  requireAuth,
  requirePermission('products.view'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) throw notFound('Product not found');
    res.json({ product });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'stock_central_maintainer'),
  requirePermission('products.manage'),
  validate(upsertSchema),
  asyncHandler(async (req, res) => {
    const product = await Product.create(normalizeProductPayload(req.body));
    await audit(req, { action: 'product.create', entity: 'Product', entityId: product._id.toString() });
    res.status(201).json({ product });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'stock_central_maintainer'),
  requirePermission('products.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(upsertSchema.partial()),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const existing = await Product.findById(id);
    if (!existing) throw notFound('Product not found');
    const payload = normalizeProductPayload(req.body, existing.toObject() as Record<string, unknown>);
    Object.assign(existing, payload);
    const product = await existing.save();
    await audit(req, { action: 'product.update', entity: 'Product', entityId: id });
    res.json({ product });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'stock_central_maintainer'),
  requirePermission('products.manage'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const product = await Product.findById(id);
    if (!product) throw notFound('Product not found');

    const canHardDelete = HIGH_PRODUCT_DELETE_ROLES.has(req.user!.role);
    const [stockRef, movementRef, saleRef] = await Promise.all([
      Stock.exists({ productId: id }),
      Movement.exists({ productId: id }),
      Sale.exists({ 'items.productId': id }),
    ]);
    const hasHistory = Boolean(stockRef || movementRef || saleRef);

    if (canHardDelete && !hasHistory) {
      await Product.deleteOne({ _id: id });
      await audit(req, {
        action: 'product.delete',
        entity: 'Product',
        entityId: id,
        details: { name: product.name },
      });
      res.json({ product, deleted: true });
      return;
    }

    product.active = false;
    await product.save();

    await audit(req, {
      action: 'product.archive',
      entity: 'Product',
      entityId: id,
      details: { name: product.name, hasHistory },
    });

    res.json({ product, deleted: false, archived: true, hasHistory });
  }),
);

router.post(
  '/:id/image',
  requireAuth,
  requireRole('admin', 'manager', 'stock_central_maintainer'),
  requirePermission('products.manage'),
  validate(z.object({ id: objectId }), 'params'),
  productImageUpload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('image file is required');
    const { id } = req.params as { id: string };
    const product = await Product.findById(id);
    if (!product) throw notFound('Product not found');

    product.imagePath = toUploadPath('product-images', req.file.filename);
    await product.save();

    await audit(req, {
      action: 'product.image.upload',
      entity: 'Product',
      entityId: id,
    });
    res.json({ product });
  }),
);

export default router;
