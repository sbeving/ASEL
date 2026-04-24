import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from './db/connect.js';
import { logger } from './utils/logger.js';
import { env } from './config/env.js';
import { Category } from './models/Category.js';
import { Supplier } from './models/Supplier.js';
import { Franchise } from './models/Franchise.js';
import { Product } from './models/Product.js';
import { User } from './models/User.js';
import { Stock } from './models/Stock.js';
import { Sale } from './models/Sale.js';
import { Transfer } from './models/Transfer.js';
import { Reception } from './models/Reception.js';
import { AuditLog } from './models/AuditLog.js';
import { Client } from './models/Client.js';
import { Closing } from './models/Closing.js';
import { Installment } from './models/Installment.js';
import { Movement } from './models/Movement.js';
import { CashFlow } from './models/CashFlow.js';
import { TimeLog } from './models/TimeLog.js';
import { Notification } from './models/Notification.js';
import { NetworkPoint } from './models/NetworkPoint.js';
import { Service } from './models/Service.js';
import { Prestation } from './models/Prestation.js';
import { Demand } from './models/Demand.js';

type LegacyRow = Record<string, unknown>;

function splitTuples(valuesBlock: string): string[] {
  const tuples: string[] = [];
  let cur = '';
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = 0; i < valuesBlock.length; i += 1) {
    const ch = valuesBlock[i]!;
    cur += ch;

    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '\'') inStr = false;
      continue;
    }

    if (ch === '\'') inStr = true;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        tuples.push(cur.trim());
        cur = '';
        while (i + 1 < valuesBlock.length && /[\s,]/.test(valuesBlock[i + 1]!)) i += 1;
      }
    }
  }

  return tuples;
}

function splitRowValues(tuple: string): string[] {
  const s = tuple.trim().replace(/^\(/, '').replace(/\)$/, '');
  const out: string[] = [];
  let cur = '';
  let inStr = false;
  let esc = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (inStr) {
      cur += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '\'') inStr = false;
      continue;
    }

    if (ch === '\'') {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur.trim());
  return out;
}

function parseSqlValue(raw: string): unknown {
  const v = raw.trim();
  if (v.toUpperCase() === 'NULL') return null;
  if (v.startsWith('\'') && v.endsWith('\'')) {
    return v
      .slice(1, -1)
      .replace(/\\'/g, '\'')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
  }
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return Number.parseFloat(v);
  return v;
}

function extractRows(sql: string, table: string): LegacyRow[] {
  const rx = new RegExp(`INSERT\\s+INTO\\s+\`${table}\`\\s*\\(([^)]*)\\)\\s*VALUES\\s*([\\s\\S]*?);`, 'gi');
  const rows: LegacyRow[] = [];

  let m: RegExpExecArray | null;
  while ((m = rx.exec(sql)) !== null) {
    const cols = m[1]!
      .split(',')
      .map((c) => c.trim().replace(/`/g, ''));
    const tuples = splitTuples(m[2]!);
    for (const t of tuples) {
      const vals = splitRowValues(t).map(parseSqlValue);
      const row: LegacyRow = {};
      cols.forEach((c, i) => {
        row[c] = vals[i];
      });
      rows.push(row);
    }
  }

  return rows;
}

function parseDateLike(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function toBool(value: unknown, defaultValue = true): boolean {
  if (value == null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const v = String(value).toLowerCase().trim();
  if (v === '0' || v === 'false' || v === 'non' || v === 'no') return false;
  return true;
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function str(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  return String(value);
}

function filled(value: unknown, fallback: string): string {
  const v = str(value).trim();
  return v.length > 0 ? v : fallback;
}

function roleToNewRole(role: string): 'admin' | 'superadmin' | 'manager' | 'franchise' | 'seller' | 'vendeur' | 'viewer' {
  const r = (role || '').toLowerCase();
  if (r === 'superadmin') return 'superadmin';
  if (r === 'manager' || r === 'gestionnaire') return 'manager';
  if (r === 'franchise') return 'franchise';
  if (r === 'seller' || r === 'vendeur') return 'vendeur';
  if (r === 'viewer' || r === 'lecteur') return 'viewer';
  return 'admin';
}

function pmToNew(mode: unknown): 'cash' | 'card' | 'transfer' | 'installment' | 'other' {
  const v = str(mode).toLowerCase();
  if (v.includes('espe') || v.includes('cash')) return 'cash';
  if (v.includes('carte') || v.includes('card')) return 'card';
  if (v.includes('virement') || v.includes('transfer')) return 'transfer';
  if (v.includes('eche') || v.includes('lot') || v.includes('trait')) return 'installment';
  return 'other';
}

function transferStatusToNew(status: unknown): 'pending' | 'accepted' | 'rejected' | 'cancelled' {
  const v = str(status).toLowerCase().trim();
  if (v.includes('accepte')) return 'accepted';
  if (v.includes('rejete')) return 'rejected';
  if (v.includes('annule') || v.includes('cancel')) return 'cancelled';
  if (v.includes('en cours')) return 'pending';
  return 'pending';
}

function receptionStatusToNew(status: unknown): 'draft' | 'validated' | 'cancelled' {
  const v = str(status).toLowerCase().trim();
  if (v.includes('valide')) return 'validated';
  if (v.includes('annule')) return 'cancelled';
  return 'draft';
}

function installmentStatusToNew(status: unknown): 'pending' | 'paid' | 'late' {
  const v = str(status).toLowerCase().trim();
  if (v.includes('payee') || v.includes('paid')) return 'paid';
  if (v.includes('retard') || v.includes('late')) return 'late';
  return 'pending';
}

function paymentMethodToNew(method: unknown): 'cash' | 'card' | 'transfer' | 'installment' | 'other' {
  return pmToNew(method);
}

function saleTypeToNew(value: unknown): 'ticket' | 'facture' | 'devis' {
  const v = str(value).toLowerCase().trim();
  if (v === 'facture') return 'facture';
  if (v === 'devis') return 'devis';
  return 'ticket';
}

function saleStatusToPaymentStatus(value: unknown, amountReceived: number, total: number): 'paid' | 'partial' | 'pending' {
  const v = str(value).toLowerCase().trim();
  if (v.includes('annule')) return 'pending';
  if (v.includes('attente')) return amountReceived > 0 ? 'partial' : 'pending';
  if (amountReceived >= total) return 'paid';
  if (amountReceived > 0) return 'partial';
  return 'pending';
}

function mapClientType(value: unknown): 'walkin' | 'boutique' | 'wholesale' | 'passager' | 'other' {
  const v = str(value).toLowerCase().trim();
  if (v === 'boutique') return 'boutique';
  if (v === 'entreprise' || v === 'wholesale') return 'wholesale';
  if (v === 'passager') return 'passager';
  if (v === 'walkin') return 'walkin';
  return 'other';
}

function mapServiceCategory(value: unknown): 'technique' | 'compte' | 'autre' {
  const v = str(value).toLowerCase().trim();
  if (v === 'compte') return 'compte';
  if (v === 'autre') return 'autre';
  return 'technique';
}

function mapNotificationType(value: unknown): 'info' | 'warning' | 'danger' | 'success' {
  const v = str(value).toLowerCase().trim();
  if (v === 'warning') return 'warning';
  if (v === 'danger') return 'danger';
  if (v === 'success') return 'success';
  return 'info';
}

function mapRoleTarget(value: unknown): 'admin' | 'superadmin' | 'manager' | 'franchise' | 'seller' | 'vendeur' | 'viewer' | 'all' | null {
  const v = str(value).toLowerCase().trim();
  if (v === '') return null;
  if (v === 'all' || v === 'tous') return 'all';
  if (v === 'admin') return 'admin';
  if (v === 'superadmin') return 'superadmin';
  if (v === 'manager' || v === 'gestionnaire') return 'manager';
  if (v === 'franchise') return 'franchise';
  if (v === 'seller') return 'seller';
  if (v === 'vendeur') return 'vendeur';
  if (v === 'viewer' || v === 'lecteur') return 'viewer';
  return null;
}

function mapMovementType(value: unknown): 'stock_in' | 'sale' | 'transfer_out' | 'transfer_in' | 'adjustment' | 'return' {
  const v = str(value).toLowerCase().trim();
  if (v.includes('retour')) return 'return';
  if (v.includes('transfer_in') || v.includes('transfert_entree') || v.includes('reception_transfert')) return 'transfer_in';
  if (v.includes('transfer_out') || v.includes('transfert_sortie') || v.includes('dispatch')) return 'transfer_out';
  if (v.includes('vente') || v.includes('sortie') || v.includes('consommation')) return 'sale';
  if (v.includes('ajust') || v.includes('inventaire') || v.includes('correction')) return 'adjustment';
  return 'stock_in';
}

function signedDelta(type: 'stock_in' | 'sale' | 'transfer_out' | 'transfer_in' | 'adjustment' | 'return', quantity: number): number {
  if (type === 'sale' || type === 'transfer_out') return -Math.abs(quantity);
  return quantity;
}

function mapDemandUrgency(value: unknown): 'normal' | 'urgent' | 'critical' {
  const v = str(value).toLowerCase().trim();
  if (v === 'urgent') return 'urgent';
  if (v === 'critique' || v === 'critical') return 'critical';
  return 'normal';
}

function mapDemandStatus(value: unknown): 'pending' | 'approved' | 'rejected' | 'delivered' {
  const v = str(value).toLowerCase().trim();
  if (v === 'livre' || v === 'delivered') return 'delivered';
  if (v === 'rejete' || v === 'rejected') return 'rejected';
  if (v === 'en_cours' || v === 'approved') return 'approved';
  return 'pending';
}

function mapAccessTypeToNetwork(value: unknown): 'franchise' | 'activation' | 'recharge' | 'activation_recharge' {
  const v = str(value).toLowerCase().trim();
  if (v.includes('recharge')) return 'recharge';
  if (v.includes('point_vente') || v.includes('franchise')) return 'franchise';
  if (v.includes('acces')) return 'activation';
  return 'activation_recharge';
}

function mapActiveToNetworkStatus(active: unknown): 'prospect' | 'contact' | 'contrat_non_signe' | 'contrat_signe' | 'actif' | 'suspendu' | 'resilie' {
  return toBool(active, true) ? 'actif' : 'suspendu';
}

async function seedLegacy() {
  const doReset = !process.argv.includes('--append');
  const sqlPathArg = process.argv.find((a) => a.startsWith('--sql='));
  const sqlPath = sqlPathArg
    ? path.resolve(process.cwd(), sqlPathArg.replace('--sql=', ''))
    : path.resolve(process.cwd(), '../old/db.sql');

  if (!fs.existsSync(sqlPath)) throw new Error(`Legacy SQL not found at ${sqlPath}`);

  const sql = fs.readFileSync(sqlPath, 'utf8');
  logger.info({ sqlPath, size: sql.length }, 'Loading legacy SQL');

  await connectDb();

  if (doReset) {
    await Promise.all([
      Category.deleteMany({}),
      Supplier.deleteMany({}),
      Franchise.deleteMany({}),
      Product.deleteMany({}),
      User.deleteMany({}),
      Stock.deleteMany({}),
      Sale.deleteMany({}),
      Transfer.deleteMany({}),
      Reception.deleteMany({}),
      AuditLog.deleteMany({}),
      Client.deleteMany({}),
      Closing.deleteMany({}),
      Installment.deleteMany({}),
      Movement.deleteMany({}),
      CashFlow.deleteMany({}),
      TimeLog.deleteMany({}),
      Notification.deleteMany({}),
      NetworkPoint.deleteMany({}),
      Service.deleteMany({}),
      Prestation.deleteMany({}),
      Demand.deleteMany({}),
    ]);
    logger.info('Cleared existing collections (append mode OFF)');
  }

  const categoriesOld = extractRows(sql, 'categories');
  const famillesOld = extractRows(sql, 'familles');
  const suppliersOld = extractRows(sql, 'fournisseurs');
  const franchisesOld = extractRows(sql, 'franchises');
  const productsOld = extractRows(sql, 'produits');
  const aselProductsOld = extractRows(sql, 'produits_asel');
  const productSuppliersOld = extractRows(sql, 'produit_fournisseurs');
  const usersOld = extractRows(sql, 'utilisateurs');
  const stockOld = extractRows(sql, 'stock');
  const clientsOld = extractRows(sql, 'clients');
  const facturesOld = extractRows(sql, 'factures');
  const factureLignesOld = extractRows(sql, 'facture_lignes');
  const ventesOld = extractRows(sql, 'ventes');
  const ventesAselOld = extractRows(sql, 'ventes_asel');
  const transfersOld = extractRows(sql, 'transferts');
  const receptionsOld = extractRows(sql, 'bons_reception');
  const receptionLignesOld = extractRows(sql, 'bon_reception_lignes');
  const auditOld = extractRows(sql, 'audit_logs');
  const closingsOld = extractRows(sql, 'clotures');
  const echeancesOld = extractRows(sql, 'echeances');
  const mouvementsOld = extractRows(sql, 'mouvements');
  const tresorerieOld = extractRows(sql, 'tresorerie');
  const pointagesOld = extractRows(sql, 'pointages');
  const notificationsOld = extractRows(sql, 'notifications');
  const pointsReseauOld = extractRows(sql, 'points_reseau');
  const pointsAccesOld = extractRows(sql, 'points_acces');
  const servicesOld = extractRows(sql, 'services');
  const prestationsOld = extractRows(sql, 'prestations');
  const demandsOld = extractRows(sql, 'demandes_produits');

  const familyById = new Map<number, { name: string; description?: string }>();
  for (const f of famillesOld) {
    familyById.set(num(f.id), {
      name: str(f.nom, 'Famille'),
      description: f.description ? str(f.description) : undefined,
    });
  }

  const catMap = new Map<number, string>();
  for (const c of categoriesOld) {
    const family = c.famille_id ? familyById.get(num(c.famille_id)) : undefined;
    const familySuffix = family ? ` [Famille: ${family.name}]` : '';
    const description = [str(c.description, '').trim(), family?.description || '']
      .filter(Boolean)
      .join(' | ')
      .slice(0, 450);
    const created = await Category.create({
      name: filled(c.nom, `Categorie ${num(c.id) || catMap.size + 1}`),
      description: `${description}${familySuffix}`.trim().slice(0, 500) || undefined,
      createdAt: parseDateLike(c.date_creation),
      updatedAt: parseDateLike(c.date_creation),
    });
    catMap.set(num(c.id), created._id.toString());
  }

  const supMap = new Map<number, string>();
  for (const s of suppliersOld) {
    const created = await Supplier.create({
      name: filled(s.nom, `Fournisseur ${num(s.id) || supMap.size + 1}`),
      phone: s.telephone ? str(s.telephone) : undefined,
      email: s.email ? str(s.email) : undefined,
      address: s.adresse ? str(s.adresse) : undefined,
      active: toBool(s.actif, true),
      createdAt: parseDateLike(s.date_creation),
      updatedAt: parseDateLike(s.date_creation),
    });
    supMap.set(num(s.id), created._id.toString());
  }

  const frMap = new Map<number, string>();
  for (const f of franchisesOld) {
    const created = await Franchise.create({
      name: filled(f.nom, `Franchise ${num(f.id) || frMap.size + 1}`),
      address: f.adresse ? str(f.adresse) : undefined,
      phone: f.telephone ? str(f.telephone) : undefined,
      manager: f.responsable ? str(f.responsable) : undefined,
      schedule: f.horaires ? str(f.horaires) : undefined,
      gps: {
        lat: Number.isFinite(num(f.latitude, Number.NaN)) ? num(f.latitude) : undefined,
        lng: Number.isFinite(num(f.longitude, Number.NaN)) ? num(f.longitude) : undefined,
      },
      active: toBool(f.actif, true),
      commercialStatus: f.statut_commercial ? str(f.statut_commercial) : undefined,
      createdAt: parseDateLike(f.date_creation),
      updatedAt: parseDateLike(f.date_creation),
    });
    frMap.set(num(f.id), created._id.toString());
  }

  let aselCategoryId = '';
  const aselCategory = await Category.findOne({ name: 'Produits ASEL (Legacy)' }).select('_id');
  if (aselCategory) {
    aselCategoryId = aselCategory._id.toString();
  } else {
    const created = await Category.create({
      name: 'Produits ASEL (Legacy)',
      description: 'Produits importes depuis la table legacy produits_asel',
    });
    aselCategoryId = created._id.toString();
  }

  const productMap = new Map<number, string>();
  for (const p of productsOld) {
    const categoryId = catMap.get(num(p.categorie_id));
    if (!categoryId) continue;
    const created = await Product.create({
      name: filled(p.nom, `Produit ${num(p.id) || productMap.size + 1}`),
      categoryId,
      supplierId: p.fournisseur_id ? (supMap.get(num(p.fournisseur_id)) || null) : null,
      brand: p.marque ? str(p.marque) : undefined,
      reference: p.reference ? str(p.reference) : undefined,
      barcode: p.code_barre ? str(p.code_barre) : undefined,
      description: p.description ? str(p.description) : undefined,
      purchasePrice: num(p.prix_achat_ttc, num(p.prix_achat, 0)),
      sellPrice: num(p.prix_vente_ttc, num(p.prix_vente, 0)),
      lowStockThreshold: num(p.seuil_alerte, 3),
      active: toBool(p.actif, true),
      createdAt: parseDateLike(p.date_creation),
      updatedAt: parseDateLike(p.date_creation),
    });
    productMap.set(num(p.id), created._id.toString());
  }

  const aselProductMap = new Map<number, string>();
  for (const p of aselProductsOld) {
    const created = await Product.create({
      name: filled(p.nom, `Produit ASEL ${num(p.id) || aselProductMap.size + 1}`),
      categoryId: aselCategoryId,
      brand: p.operateur ? str(p.operateur) : 'ASEL',
      reference: `ASEL-${num(p.id)}`,
      description: `Type: ${str(p.type_produit, 'autre')} | Commission: ${num(p.commission, 0)}`,
      purchasePrice: Math.max(0, num(p.prix_vente, 0) - num(p.commission, 0)),
      sellPrice: num(p.prix_vente, 0),
      lowStockThreshold: 0,
      active: toBool(p.actif, true),
      createdAt: parseDateLike(p.date_creation),
      updatedAt: parseDateLike(p.date_creation),
    });
    aselProductMap.set(num(p.id), created._id.toString());
  }

  for (const row of productSuppliersOld) {
    const productId = productMap.get(num(row.produit_id));
    const supplierId = supMap.get(num(row.fournisseur_id));
    if (!productId || !supplierId) continue;
    if (toBool(row.is_default, false)) {
      await Product.updateOne(
        { _id: productId },
        {
          $set: {
            supplierId,
            purchasePrice: num(row.prix_achat_ttc, num(row.prix_achat_ht, 0)),
          },
        },
      );
    }
  }

  const userMap = new Map<number, string>();
  const userFranchiseMap = new Map<number, string | null>();
  const defaultHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, env.BCRYPT_ROUNDS);
  for (const u of usersOld) {
    const role = roleToNewRole(str(u.role, 'admin'));
    const franchiseId = u.franchise_id ? (frMap.get(num(u.franchise_id)) || null) : null;
    const created = await User.create({
      username: filled(u.nom_utilisateur, `user${num(u.id) || userMap.size + 1}`),
      passwordHash: defaultHash,
      fullName: filled(u.nom_complet, filled(u.nom_utilisateur, `User ${num(u.id) || userMap.size + 1}`)),
      firstName: u.prenom ? str(u.prenom) : undefined,
      cin: u.cin ? str(u.cin) : undefined,
      phone: u.telephone ? str(u.telephone) : undefined,
      role,
      franchiseId,
      active: toBool(u.actif, true),
      createdAt: parseDateLike(u.date_creation),
      updatedAt: parseDateLike(u.date_creation),
    });
    userMap.set(num(u.id), created._id.toString());
    userFranchiseMap.set(num(u.id), franchiseId);
  }

  const clientMap = new Map<number, string>();
  for (const c of clientsOld) {
    const fullName = [c.prenom, c.nom].filter(Boolean).map((v) => str(v)).join(' ').trim() || str(c.nom, 'Client');
    const created = await Client.create({
      firstName: c.prenom ? str(c.prenom) : undefined,
      lastName: c.nom ? str(c.nom) : undefined,
      fullName,
      phone: c.telephone ? str(c.telephone) : undefined,
      phone2: c.telephone2 ? str(c.telephone2) : undefined,
      email: c.email ? str(c.email) : undefined,
      address: c.adresse ? str(c.adresse) : undefined,
      clientType: mapClientType(c.type_client),
      company: c.entreprise ? str(c.entreprise) : undefined,
      taxId: c.matricule_fiscal ? str(c.matricule_fiscal) : undefined,
      cin: c.cin ? str(c.cin) : undefined,
      notes: c.notes ? str(c.notes) : undefined,
      franchiseId: c.franchise_id ? (frMap.get(num(c.franchise_id)) || null) : null,
      active: toBool(c.actif, true),
      createdAt: parseDateLike(c.date_creation),
      updatedAt: parseDateLike(c.date_creation),
    });
    clientMap.set(num(c.id), created._id.toString());
  }

  const stockDocs = stockOld
    .map((s) => ({
      franchiseId: frMap.get(num(s.franchise_id)) || null,
      productId: productMap.get(num(s.produit_id)) || null,
      quantity: Math.max(0, num(s.quantite, 0)),
      createdAt: parseDateLike(s.derniere_maj),
      updatedAt: parseDateLike(s.derniere_maj),
    }))
    .filter((s) => s.franchiseId && s.productId);
  if (stockDocs.length) await Stock.insertMany(stockDocs);

  const fallbackUserId = [...userMap.values()][0];
  if (!fallbackUserId) throw new Error('No users available to seed linked entities');
  const fallbackFranchiseId = [...frMap.values()][0] || null;

  const factureLinesById = new Map<number, LegacyRow[]>();
  for (const l of factureLignesOld) {
    const key = num(l.facture_id);
    if (!factureLinesById.has(key)) factureLinesById.set(key, []);
    factureLinesById.get(key)!.push(l);
  }

  const factureToSale = new Map<number, string>();
  for (const f of facturesOld) {
    const factureId = num(f.id);
    const franchiseId = frMap.get(num(f.franchise_id));
    if (!franchiseId) continue;
    const lines = factureLinesById.get(factureId) || [];
    const items = lines
      .map((l) => ({
        productId: productMap.get(num(l.produit_id)) || null,
        quantity: num(l.quantite, 0),
        unitPrice: num(l.prix_unitaire, 0),
        total: num(l.total, 0),
      }))
      .filter((l) => l.productId && l.quantity > 0);
    if (items.length === 0) continue;

    const total = num(f.total_ttc, items.reduce((sum, item) => sum + item.total, 0));
    const amountReceived = num(f.montant_recu, total);
    const sale = await Sale.create({
      invoiceNumber: str(f.numero, `FAC-${factureId}`),
      saleType: saleTypeToNew(f.type_facture),
      franchiseId,
      clientId: f.client_id ? (clientMap.get(num(f.client_id)) || null) : null,
      userId: userMap.get(num(f.utilisateur_id)) || fallbackUserId,
      items,
      subtotal: num(f.sous_total, total),
      discount: num(f.remise_totale, 0),
      total,
      paymentMethod: pmToNew(f.mode_paiement),
      paymentStatus: saleStatusToPaymentStatus(f.statut, amountReceived, total),
      amountReceived,
      changeDue: num(f.monnaie, 0),
      note: f.note ? str(f.note) : undefined,
      createdAt: parseDateLike(f.date_facture ?? f.date_creation),
      updatedAt: parseDateLike(f.date_facture ?? f.date_creation),
    });
    factureToSale.set(factureId, sale._id.toString());
  }

  let ventesInserted = 0;
  for (const v of ventesOld) {
    const linkedFactureId = v.facture_id ? num(v.facture_id, 0) : 0;
    if (linkedFactureId && factureToSale.has(linkedFactureId)) continue;
    const productId = productMap.get(num(v.produit_id));
    const franchiseId = frMap.get(num(v.franchise_id));
    if (!productId || !franchiseId) continue;
    const qty = Math.max(1, num(v.quantite, 1));
    const unitPrice = num(v.prix_unitaire, 0);
    const total = num(v.prix_total, unitPrice * qty);
    const amountReceived = num(v.montant_recu, total);
    await Sale.create({
      invoiceNumber: `VNT-${num(v.id)}`,
      saleType: 'ticket',
      franchiseId,
      clientId: v.client_id ? (clientMap.get(num(v.client_id)) || null) : null,
      userId: userMap.get(num(v.utilisateur_id)) || fallbackUserId,
      items: [{ productId, quantity: qty, unitPrice, total }],
      subtotal: total,
      discount: num(v.remise, 0),
      total: Math.max(0, total - num(v.remise, 0)),
      paymentMethod: pmToNew(v.mode_paiement),
      paymentStatus: saleStatusToPaymentStatus('payee', amountReceived, total),
      amountReceived,
      changeDue: num(v.monnaie, 0),
      note: v.note ? str(v.note) : undefined,
      createdAt: parseDateLike(v.date_vente ?? v.date_creation),
      updatedAt: parseDateLike(v.date_vente ?? v.date_creation),
    });
    ventesInserted += 1;
  }

  let ventesAselInserted = 0;
  for (const v of ventesAselOld) {
    const linkedFactureId = v.facture_id ? num(v.facture_id, 0) : 0;
    if (linkedFactureId && factureToSale.has(linkedFactureId)) continue;
    const productId = aselProductMap.get(num(v.produit_asel_id));
    const franchiseId = frMap.get(num(v.franchise_id));
    if (!productId || !franchiseId) continue;
    const total = num(v.prix_vente, 0);
    await Sale.create({
      invoiceNumber: `ASEL-${num(v.id)}`,
      saleType: 'ticket',
      franchiseId,
      clientId: v.client_id ? (clientMap.get(num(v.client_id)) || null) : null,
      userId: userMap.get(num(v.utilisateur_id)) || fallbackUserId,
      items: [{ productId, quantity: 1, unitPrice: total, total }],
      subtotal: total,
      discount: 0,
      total,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      amountReceived: total,
      changeDue: 0,
      note: [v.numero_telephone ? `MSISDN: ${str(v.numero_telephone)}` : '', v.note ? str(v.note) : '']
        .filter(Boolean)
        .join(' | ') || undefined,
      createdAt: parseDateLike(v.date_vente),
      updatedAt: parseDateLike(v.date_vente),
    });
    ventesAselInserted += 1;
  }

  const transferDocs = transfersOld
    .map((t) => ({
      sourceFranchiseId: frMap.get(num(t.franchise_source)) || null,
      destFranchiseId: frMap.get(num(t.franchise_dest)) || null,
      productId: productMap.get(num(t.produit_id)) || null,
      quantity: Math.max(1, num(t.quantite, 1)),
      status: transferStatusToNew(t.statut),
      requestedBy: userMap.get(num(t.demandeur_id)) || fallbackUserId,
      resolvedBy: t.validateur_id ? (userMap.get(num(t.validateur_id)) || null) : null,
      note: t.note ? str(t.note) : undefined,
      createdAt: parseDateLike(t.date_demande),
      updatedAt: parseDateLike(t.date_validation ?? t.date_demande),
      resolvedAt: parseDateLike(t.date_validation),
    }))
    .filter((t) => t.sourceFranchiseId && t.destFranchiseId && t.productId);
  if (transferDocs.length) await Transfer.insertMany(transferDocs);

  const receptionDocs = receptionsOld
    .map((r) => {
      const lines = receptionLignesOld
        .filter((l) => num(l.bon_id) === num(r.id))
        .map((l) => ({
          productId: productMap.get(num(l.produit_id)) || null,
          quantity: Math.max(1, num(l.quantite, 1)),
          unitPriceHt: num(l.prix_unitaire_ht, 0),
          unitPriceTtc: num(l.prix_unitaire_ttc, 0),
          vatRate: num(l.tva_rate, 19),
          totalHt: num(l.total_ht, 0),
          totalTtc: num(l.total_ttc, 0),
        }))
        .filter((l) => l.productId);

      const status = receptionStatusToNew(r.statut);
      const createdAt = parseDateLike(r.date_creation);
      const userId = r.utilisateur_id ? (userMap.get(num(r.utilisateur_id)) || fallbackUserId) : fallbackUserId;
      return {
      number: filled(r.numero, `BR-${num(r.id) || 1}`),
        franchiseId: frMap.get(num(r.franchise_id)) || null,
        supplierId: r.fournisseur_id ? (supMap.get(num(r.fournisseur_id)) || null) : null,
        receptionDate: parseDateLike(r.date_reception),
        totalHt: num(r.total_ht, 0),
        vat: num(r.tva, 0),
        totalTtc: num(r.total_ttc, 0),
        status,
        note: r.note ? str(r.note) : undefined,
        userId,
        validatedBy: status === 'validated' ? userId : null,
        validatedAt: status === 'validated' ? createdAt || new Date() : null,
        lines,
        createdAt,
        updatedAt: createdAt,
      };
    })
    .filter((r) => r.franchiseId && r.lines.length > 0);
  if (receptionDocs.length) await Reception.insertMany(receptionDocs);

  const closingDocs = closingsOld
    .map((c) => ({
      franchiseId: frMap.get(num(c.franchise_id)) || null,
      closingDate: parseDateLike(c.date_cloture),
      declaredSalesTotal: num(c.total_ventes_declare, 0),
      declaredItemsTotal: num(c.total_articles_declare, 0),
      systemSalesTotal: num(c.total_ventes_systeme, 0),
      systemItemsTotal: num(c.total_articles_systeme, 0),
      comment: c.commentaire ? str(c.commentaire) : undefined,
      validated: toBool(c.valide, false),
      submittedBy: userMap.get(num(c.utilisateur_id)) || fallbackUserId,
      validatedBy: c.validateur_id ? (userMap.get(num(c.validateur_id)) || null) : null,
      validatedAt: parseDateLike(c.date_creation),
      createdAt: parseDateLike(c.date_creation),
      updatedAt: parseDateLike(c.date_creation),
    }))
    .filter((c) => c.franchiseId && c.closingDate);
  if (closingDocs.length) await Closing.insertMany(closingDocs);

  const installmentDocs = echeancesOld
    .map((e) => ({
      saleId: factureToSale.get(num(e.facture_id)) || null,
      franchiseId: frMap.get(num(e.franchise_id)) || null,
      clientId: e.client_id ? (clientMap.get(num(e.client_id)) || null) : null,
      amount: num(e.montant, 0),
      dueDate: parseDateLike(e.date_echeance),
      status: installmentStatusToNew(e.statut),
      paidAt: parseDateLike(e.date_paiement),
      paymentMethod: paymentMethodToNew(e.mode_paiement),
      note: e.note ? str(e.note) : undefined,
      remind7dSent: toBool(e.rappel_7j_envoye, false),
      remind3dSent: toBool(e.rappel_3j_envoye, false),
      userId: userMap.get(num(e.utilisateur_id)) || fallbackUserId,
      createdAt: parseDateLike(e.date_creation),
      updatedAt: parseDateLike(e.date_creation),
    }))
    .filter((e) => e.saleId && e.franchiseId && e.dueDate);
  if (installmentDocs.length) await Installment.insertMany(installmentDocs);

  const movementDocs = mouvementsOld
    .map((m) => {
      const type = mapMovementType(m.type_mouvement);
      const quantity = Math.max(0, num(m.quantite, 0));
      return {
        franchiseId: frMap.get(num(m.franchise_id)) || null,
        productId: productMap.get(num(m.produit_id)) || null,
        type,
        delta: signedDelta(type, quantity),
        unitPrice: num(m.prix_unitaire, 0),
        note: m.note ? str(m.note) : undefined,
        userId: m.utilisateur_id ? (userMap.get(num(m.utilisateur_id)) || fallbackUserId) : fallbackUserId,
        createdAt: parseDateLike(m.date_mouvement),
        updatedAt: parseDateLike(m.date_mouvement),
      };
    })
    .filter((m) => m.franchiseId && m.productId && m.delta !== 0);
  if (movementDocs.length) await Movement.insertMany(movementDocs);

  const cashFlowDocs = tresorerieOld
    .map((t) => ({
      franchiseId: frMap.get(num(t.franchise_id)) || null,
      type: str(t.type_mouvement).toLowerCase() === 'decaissement' ? 'decaissement' : 'encaissement',
      amount: Math.abs(num(t.montant, 0)),
      reason: str(t.motif, 'Import legacy tresorerie').slice(0, 255),
      reference: t.reference ? str(t.reference) : undefined,
      date: parseDateLike(t.date_mouvement ?? t.date_creation) || new Date(),
      userId: t.utilisateur_id ? (userMap.get(num(t.utilisateur_id)) || fallbackUserId) : fallbackUserId,
      createdAt: parseDateLike(t.date_creation),
      updatedAt: parseDateLike(t.date_creation),
    }))
    .filter((t) => t.franchiseId && t.amount > 0);
  if (cashFlowDocs.length) await CashFlow.insertMany(cashFlowDocs);

  const timeLogDocs = pointagesOld
    .map((p) => {
      const mappedFranchiseId = p.franchise_id
        ? (frMap.get(num(p.franchise_id)) || null)
        : (userFranchiseMap.get(num(p.utilisateur_id)) || fallbackFranchiseId);
      return {
        userId: userMap.get(num(p.utilisateur_id)) || fallbackUserId,
        franchiseId: mappedFranchiseId,
        type: str(p.type_pointage, 'entree'),
        timestamp: parseDateLike(p.heure) || new Date(),
        gps: {
          lat: p.latitude == null ? undefined : num(p.latitude),
          lng: p.longitude == null ? undefined : num(p.longitude),
          address: p.adresse ? str(p.adresse) : undefined,
        },
        device: p.device_info ? str(p.device_info) : undefined,
        note: p.note ? str(p.note) : undefined,
      };
    })
    .filter((p) => p.userId && p.franchiseId);
  if (timeLogDocs.length) await TimeLog.insertMany(timeLogDocs);

  const notificationDocs = notificationsOld
    .map((n) => {
      const createdAt = parseDateLike(n.date_creation) || new Date();
      return {
        userId: n.utilisateur_id ? (userMap.get(num(n.utilisateur_id)) || null) : null,
        franchiseId: n.franchise_id ? (frMap.get(num(n.franchise_id)) || null) : null,
        roleTarget: mapRoleTarget(n.role_cible),
        title: filled(n.titre, `Notification ${num(n.id) || 1}`),
        message: n.message ? str(n.message) : '',
        type: mapNotificationType(n.type_notif),
        link: n.lien ? str(n.lien) : '',
        readAt: toBool(n.lu, false) ? createdAt : null,
        createdAt,
        updatedAt: createdAt,
      };
    })
    .filter((n) => n.title.trim().length > 0);
  if (notificationDocs.length) await Notification.insertMany(notificationDocs);

  const networkPointDocs = [
    ...pointsReseauOld.map((p) => ({
      name: filled(p.nom, `Point reseau ${num(p.id) || 1}`),
      type: ['franchise', 'activation', 'recharge', 'activation_recharge'].includes(str(p.type_point))
        ? (str(p.type_point) as 'franchise' | 'activation' | 'recharge' | 'activation_recharge')
        : 'activation_recharge',
      status: ['prospect', 'contact', 'contrat_non_signe', 'contrat_signe', 'actif', 'suspendu', 'resilie'].includes(str(p.statut))
        ? (str(p.statut) as 'prospect' | 'contact' | 'contrat_non_signe' | 'contrat_signe' | 'actif' | 'suspendu' | 'resilie')
        : mapActiveToNetworkStatus(p.actif),
      address: p.adresse ? str(p.adresse) : '',
      city: p.ville ? str(p.ville) : '',
      governorate: p.gouvernorat ? str(p.gouvernorat) : '',
      phone: p.telephone ? str(p.telephone) : '',
      phone2: p.telephone2 ? str(p.telephone2) : '',
      email: p.email ? str(p.email) : '',
      responsible: p.responsable ? str(p.responsable) : '',
      schedule: p.horaires ? str(p.horaires) : 'Lun-Sam: 09:00-19:00',
      gps: {
        lat: p.latitude == null ? null : num(p.latitude),
        lng: p.longitude == null ? null : num(p.longitude),
      },
      internalNotes: p.notes_internes ? str(p.notes_internes) : '',
      franchiseId: p.franchise_id ? (frMap.get(num(p.franchise_id)) || null) : null,
      contactDate: parseDateLike(p.date_contact),
      contractDate: parseDateLike(p.date_contrat),
      activationDate: parseDateLike(p.date_activation),
      commissionPct: num(p.commission_pct, 0),
      active: toBool(p.actif, true),
      createdBy: p.cree_par ? (userMap.get(num(p.cree_par)) || null) : null,
      createdAt: parseDateLike(p.date_creation),
      updatedAt: parseDateLike(p.date_modification ?? p.date_creation),
    })),
    ...pointsAccesOld.map((p) => ({
      name: filled(p.nom, `Point acces ${num(p.id) || 1}`),
      type: mapAccessTypeToNetwork(p.type_point),
      status: mapActiveToNetworkStatus(p.actif),
      address: p.adresse ? str(p.adresse) : '',
      city: p.ville ? str(p.ville) : '',
      governorate: '',
      phone: p.telephone ? str(p.telephone) : '',
      phone2: '',
      email: p.email ? str(p.email) : '',
      responsible: p.responsable ? str(p.responsable) : '',
      schedule: p.horaires ? str(p.horaires) : 'Lun-Sam: 09:00-19:00',
      gps: {
        lat: p.latitude == null ? null : num(p.latitude),
        lng: p.longitude == null ? null : num(p.longitude),
      },
      internalNotes: [p.note ? str(p.note) : '', p.services_disponibles ? `Services: ${str(p.services_disponibles)}` : '', p.type_local ? `Type local: ${str(p.type_local)}` : '']
        .filter(Boolean)
        .join(' | '),
      franchiseId: p.franchise_id ? (frMap.get(num(p.franchise_id)) || null) : null,
      contactDate: null,
      contractDate: null,
      activationDate: null,
      commissionPct: 0,
      active: toBool(p.actif, true),
      createdBy: null,
      createdAt: parseDateLike(p.date_creation),
      updatedAt: parseDateLike(p.date_creation),
    })),
  ];
  if (networkPointDocs.length) await NetworkPoint.insertMany(networkPointDocs);

  const serviceMap = new Map<number, string>();
  for (const s of servicesOld) {
    const service = await Service.create({
      name: filled(s.nom, `Service ${num(s.id) || 1}`),
      category: mapServiceCategory(s.categorie_service),
      price: num(s.prix, 0),
      description: s.description ? str(s.description) : '',
      durationMinutes: Math.max(1, num(s.duree_minutes, 15)),
      active: toBool(s.actif, true),
      createdAt: parseDateLike(s.date_creation),
      updatedAt: parseDateLike(s.date_creation),
    });
    serviceMap.set(num(s.id), service._id.toString());
  }

  const prestationDocs = prestationsOld
    .map((p) => ({
      serviceId: serviceMap.get(num(p.service_id)) || null,
      franchiseId: frMap.get(num(p.franchise_id)) || null,
      clientId: p.client_id ? (clientMap.get(num(p.client_id)) || null) : null,
      saleId: null,
      billedPrice: num(p.prix_facture, 0),
      note: p.note ? str(p.note) : '',
      userId: p.utilisateur_id ? (userMap.get(num(p.utilisateur_id)) || fallbackUserId) : fallbackUserId,
      performedAt: parseDateLike(p.date_prestation) || new Date(),
      createdAt: parseDateLike(p.date_prestation),
      updatedAt: parseDateLike(p.date_prestation),
    }))
    .filter((p) => p.serviceId && p.franchiseId);
  if (prestationDocs.length) await Prestation.insertMany(prestationDocs);

  const demandDocs = demandsOld
    .map((d) => ({
      franchiseId: frMap.get(num(d.franchise_id)) || null,
      productId: d.produit_id ? (productMap.get(num(d.produit_id)) || null) : null,
      productName: d.nom_produit ? str(d.nom_produit) : '',
      quantity: Math.max(1, num(d.quantite, 1)),
      urgency: mapDemandUrgency(d.urgence),
      note: d.note ? str(d.note) : '',
      status: mapDemandStatus(d.statut),
      requestedBy: d.demandeur_id ? (userMap.get(num(d.demandeur_id)) || fallbackUserId) : fallbackUserId,
      processedBy: d.gestionnaire_id ? (userMap.get(num(d.gestionnaire_id)) || null) : null,
      response: d.reponse ? str(d.reponse) : '',
      processedAt: parseDateLike(d.date_traitement),
      sourceFranchiseId: null,
      createdAt: parseDateLike(d.date_demande),
      updatedAt: parseDateLike(d.date_traitement ?? d.date_demande),
    }))
    .filter((d) => d.franchiseId);
  if (demandDocs.length) await Demand.insertMany(demandDocs);

  const auditDocs = auditOld
    .map((a) => ({
      userId: a.utilisateur_id ? (userMap.get(num(a.utilisateur_id)) || null) : null,
      username: a.utilisateur_nom ? str(a.utilisateur_nom) : null,
      action: str(a.action, 'legacy.action').slice(0, 64),
      entity: a.cible ? str(a.cible).slice(0, 64) : undefined,
      entityId: a.cible_id ? str(a.cible_id) : null,
      franchiseId: a.franchise_id ? (frMap.get(num(a.franchise_id)) || null) : null,
      details: a.details ? str(a.details) : undefined,
      ip: a.ip_address ? str(a.ip_address) : undefined,
      userAgent: a.user_agent ? str(a.user_agent).slice(0, 255) : undefined,
      createdAt: parseDateLike(a.date_creation),
    }))
    .filter((a) => a.action);
  if (auditDocs.length) await AuditLog.insertMany(auditDocs);

  logger.info(
    {
      categories: categoriesOld.length,
      familles: famillesOld.length,
      suppliers: suppliersOld.length,
      franchises: franchisesOld.length,
      products: productsOld.length,
      productsAsel: aselProductsOld.length,
      productSuppliers: productSuppliersOld.length,
      users: usersOld.length,
      clients: clientsOld.length,
      stock: stockDocs.length,
      salesFactures: factureToSale.size,
      salesVentes: ventesInserted,
      salesVentesAsel: ventesAselInserted,
      transfers: transferDocs.length,
      receptions: receptionDocs.length,
      closings: closingDocs.length,
      installments: installmentDocs.length,
      movements: movementDocs.length,
      cashFlows: cashFlowDocs.length,
      timeLogs: timeLogDocs.length,
      notifications: notificationDocs.length,
      networkPoints: networkPointDocs.length,
      services: servicesOld.length,
      prestations: prestationDocs.length,
      demands: demandDocs.length,
      auditLogs: auditDocs.length,
    },
    'Legacy SQL import complete',
  );

  logger.info(`Imported users default password is: ${env.SEED_ADMIN_PASSWORD}`);
  await disconnectDb();
}

seedLegacy().catch(async (err) => {
  logger.error({ err }, 'Legacy seed failed');
  await disconnectDb();
  process.exit(1);
});
