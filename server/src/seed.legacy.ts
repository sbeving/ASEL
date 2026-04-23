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
      else if (ch === "'") inStr = false;
      continue;
    }

    if (ch === "'") inStr = true;
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
      else if (ch === "'") inStr = false;
      continue;
    }

    if (ch === "'") {
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
  if (v.startsWith("'") && v.endsWith("'")) {
    return v
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
  }
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return Number.parseFloat(v);
  return v;
}

function extractRows(sql: string, table: string): Record<string, unknown>[] {
  const rx = new RegExp(`INSERT\\s+INTO\\s+\`${table}\`\\s*\\(([^)]*)\\)\\s*VALUES\\s*([\\s\\S]*?);`, 'gi');
  const rows: Record<string, unknown>[] = [];

  let m: RegExpExecArray | null;
  while ((m = rx.exec(sql)) !== null) {
    const cols = m[1]!
      .split(',')
      .map((c) => c.trim().replace(/`/g, ''));
    const tuples = splitTuples(m[2]!);
    for (const t of tuples) {
      const vals = splitRowValues(t).map(parseSqlValue);
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        row[c] = vals[i];
      });
      rows.push(row);
    }
  }

  return rows;
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
  const v = String(mode ?? '').toLowerCase();
  if (v.includes('espe') || v.includes('cash')) return 'cash';
  if (v.includes('carte') || v.includes('card')) return 'card';
  if (v.includes('virement') || v.includes('transfer')) return 'transfer';
  if (v.includes('eche') || v.includes('lot') || v.includes('trait')) return 'installment';
  return 'other';
}

function transferStatusToNew(status: unknown): 'pending' | 'accepted' | 'rejected' | 'cancelled' {
  const v = String(status ?? '').toLowerCase().trim();
  if (v.includes('accepte')) return 'accepted';
  if (v.includes('rejete')) return 'rejected';
  if (v.includes('annule') || v.includes('cancel')) return 'cancelled';
  if (v.includes('en cours')) return 'pending';
  return 'pending';
}

function receptionStatusToNew(status: unknown): 'draft' | 'validated' | 'cancelled' {
  const v = String(status ?? '').toLowerCase().trim();
  if (v.includes('valide')) return 'validated';
  if (v.includes('annule')) return 'cancelled';
  return 'draft';
}

function installmentStatusToNew(status: unknown): 'pending' | 'paid' | 'late' {
  const v = String(status ?? '').toLowerCase().trim();
  if (v.includes('payee') || v.includes('paid')) return 'paid';
  if (v.includes('retard') || v.includes('late')) return 'late';
  return 'pending';
}

function paymentMethodToNew(method: unknown): 'cash' | 'card' | 'transfer' | 'installment' | 'other' {
  const v = String(method ?? '').toLowerCase().trim();
  if (v.includes('espe') || v.includes('cash')) return 'cash';
  if (v.includes('carte') || v.includes('card')) return 'card';
  if (v.includes('virement') || v.includes('transfer')) return 'transfer';
  if (v.includes('eche') || v.includes('lot') || v.includes('trait')) return 'installment';
  return 'other';
}

function parseDateLike(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
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
      Category.deleteMany({}), Supplier.deleteMany({}), Franchise.deleteMany({}), Product.deleteMany({}),
      User.deleteMany({}), Stock.deleteMany({}), Sale.deleteMany({}), Transfer.deleteMany({}),
      Reception.deleteMany({}), AuditLog.deleteMany({}), Client.deleteMany({}), Closing.deleteMany({}), Installment.deleteMany({}),
    ]);
    logger.info('Cleared existing collections (append mode OFF)');
  }

  const categoriesOld = extractRows(sql, 'categories');
  const suppliersOld = extractRows(sql, 'fournisseurs');
  const franchisesOld = extractRows(sql, 'franchises');
  const productsOld = extractRows(sql, 'produits');
  const usersOld = extractRows(sql, 'utilisateurs');
  const stockOld = extractRows(sql, 'stock');
  const clientsOld = extractRows(sql, 'clients');
  const facturesOld = extractRows(sql, 'factures');
  const factureLignesOld = extractRows(sql, 'facture_lignes');
  const transfersOld = extractRows(sql, 'transferts');
  const receptionsOld = extractRows(sql, 'bons_reception');
  const receptionLignesOld = extractRows(sql, 'bon_reception_lignes');
  const auditOld = extractRows(sql, 'audit_logs');
  const closingsOld = extractRows(sql, 'clotures');
  const echeancesOld = extractRows(sql, 'echeances');

  const catMap = new Map<number, string>();
  for (const c of categoriesOld) {
    const created = await Category.create({ name: String(c.nom || 'Sans catégorie'), description: c.description ? String(c.description) : undefined });
    catMap.set(Number(c.id), created._id.toString());
  }

  const supMap = new Map<number, string>();
  for (const s of suppliersOld) {
    const created = await Supplier.create({
      name: String(s.nom || 'Fournisseur'),
      phone: s.telephone ? String(s.telephone) : undefined,
      email: s.email ? String(s.email) : undefined,
      address: s.adresse ? String(s.adresse) : undefined,
      active: Number(s.actif ?? 1) !== 0,
    });
    supMap.set(Number(s.id), created._id.toString());
  }

  const frMap = new Map<number, string>();
  for (const f of franchisesOld) {
    const created = await Franchise.create({
      name: String(f.nom || 'Franchise'),
      address: f.adresse ? String(f.adresse) : undefined,
      phone: f.telephone ? String(f.telephone) : undefined,
      manager: f.responsable ? String(f.responsable) : undefined,
      active: Number(f.actif ?? 1) !== 0,
      createdAt: parseDateLike(f.date_creation),
      updatedAt: parseDateLike(f.date_creation),
    });
    frMap.set(Number(f.id), created._id.toString());
  }

  const productMap = new Map<number, string>();
  for (const p of productsOld) {
    const categoryId = catMap.get(Number(p.categorie_id));
    if (!categoryId) continue;
    const created = await Product.create({
      name: String(p.nom || 'Produit'),
      categoryId,
      supplierId: p.fournisseur_id ? supMap.get(Number(p.fournisseur_id)) || null : null,
      brand: p.marque ? String(p.marque) : undefined,
      reference: p.reference ? String(p.reference) : undefined,
      barcode: p.code_barre ? String(p.code_barre) : undefined,
      description: p.description ? String(p.description) : undefined,
      purchasePrice: Number(p.prix_achat_ttc ?? p.prix_achat ?? 0),
      sellPrice: Number(p.prix_vente_ttc ?? p.prix_vente ?? 0),
      lowStockThreshold: Number(p.seuil_alerte ?? 3),
      active: Number(p.actif ?? 1) !== 0,
      createdAt: parseDateLike(p.date_creation),
      updatedAt: parseDateLike(p.date_creation),
    });
    productMap.set(Number(p.id), created._id.toString());
  }

  const userMap = new Map<number, string>();
  const defaultHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, env.BCRYPT_ROUNDS);
  for (const u of usersOld) {
    const role = roleToNewRole(String(u.role || 'admin'));
    const franchiseId = u.franchise_id ? frMap.get(Number(u.franchise_id)) || null : null;
    const created = await User.create({
      username: String(u.nom_utilisateur || `user${u.id}`),
      passwordHash: defaultHash,
      fullName: String(u.nom_complet || u.nom_utilisateur || `User ${u.id}`),
      role,
      franchiseId,
      active: Number(u.actif ?? 1) !== 0,
      createdAt: parseDateLike(u.date_creation),
      updatedAt: parseDateLike(u.date_creation),
    });
    userMap.set(Number(u.id), created._id.toString());
  }

  const clientMap = new Map<number, string>();
  for (const c of clientsOld) {
    const fullName = [c.prenom, c.nom].filter(Boolean).map(String).join(' ').trim() || String(c.nom || 'Client');
    const created = await Client.create({
      firstName: c.prenom ? String(c.prenom) : undefined,
      lastName: c.nom ? String(c.nom) : undefined,
      fullName,
      phone: c.telephone ? String(c.telephone) : undefined,
      phone2: c.telephone2 ? String(c.telephone2) : undefined,
      email: c.email ? String(c.email) : undefined,
      address: c.adresse ? String(c.adresse) : undefined,
      clientType: c.type_client ? String(c.type_client).toLowerCase() : 'walkin',
      company: c.entreprise ? String(c.entreprise) : undefined,
      taxId: c.matricule_fiscal ? String(c.matricule_fiscal) : undefined,
      cin: c.cin ? String(c.cin) : undefined,
      notes: c.notes ? String(c.notes) : undefined,
      franchiseId: c.franchise_id ? frMap.get(Number(c.franchise_id)) || null : null,
      active: Number(c.actif ?? 1) !== 0,
      createdAt: parseDateLike(c.date_creation),
      updatedAt: parseDateLike(c.date_creation),
    });
    clientMap.set(Number(c.id), created._id.toString());
  }

  const stockDocs = stockOld
    .map((s) => ({
      franchiseId: frMap.get(Number(s.franchise_id)) || null,
      productId: productMap.get(Number(s.produit_id)) || null,
      quantity: Number(s.quantite ?? 0),
      createdAt: parseDateLike(s.derniere_maj),
      updatedAt: parseDateLike(s.derniere_maj),
    }))
    .filter((s) => s.franchiseId && s.productId);
  if (stockDocs.length) await Stock.insertMany(stockDocs);

  const factureLinesById = new Map<number, Record<string, unknown>[]>();
  for (const l of factureLignesOld) {
    const key = Number(l.facture_id);
    if (!factureLinesById.has(key)) factureLinesById.set(key, []);
    factureLinesById.get(key)!.push(l);
  }

  const factureToSale = new Map<number, string>();
  for (const f of facturesOld) {
    const fid = Number(f.id);
    const franchiseId = frMap.get(Number(f.franchise_id));
    if (!franchiseId) continue;
    const lines = factureLinesById.get(fid) || [];
    const items = lines
      .map((l) => ({
        productId: productMap.get(Number(l.produit_id)) || null,
        quantity: Number(l.quantite ?? 0),
        unitPrice: Number(l.prix_unitaire ?? 0),
        total: Number(l.total ?? 0),
      }))
      .filter((l) => l.productId && l.quantity > 0);
    if (items.length === 0) continue;

    const fallbackUserId = [...userMap.values()][0];
    if (!fallbackUserId) throw new Error('No users available to seed sales');

    const created = await Sale.create({
      franchiseId,
      userId: userMap.get(Number(f.utilisateur_id)) || fallbackUserId,
      items,
      subtotal: Number(f.sous_total ?? f.total_ht ?? f.total_ttc ?? 0),
      discount: Number(f.remise_totale ?? 0),
      total: Number(f.total_ttc ?? 0),
      paymentMethod: pmToNew(f.mode_paiement),
      note: f.note ? String(f.note) : undefined,
      createdAt: parseDateLike(f.date_facture ?? f.date_creation),
      updatedAt: parseDateLike(f.date_facture ?? f.date_creation),
    });
    factureToSale.set(fid, created._id.toString());
  }

  const fallbackUserId = [...userMap.values()][0];
  if (!fallbackUserId) throw new Error('No users available to seed linked entities');

  const transferDocs = transfersOld
    .map((t) => ({
      sourceFranchiseId: frMap.get(Number(t.franchise_source)) || null,
      destFranchiseId: frMap.get(Number(t.franchise_dest)) || null,
      productId: productMap.get(Number(t.produit_id)) || null,
      quantity: Number(t.quantite ?? 0),
      status: transferStatusToNew(t.statut),
      requestedBy: userMap.get(Number(t.demandeur_id)) || fallbackUserId,
      resolvedBy: t.validateur_id ? userMap.get(Number(t.validateur_id)) || null : null,
      note: t.note ? String(t.note) : undefined,
      createdAt: parseDateLike(t.date_demande),
      updatedAt: parseDateLike(t.date_validation ?? t.date_demande),
      resolvedAt: parseDateLike(t.date_validation),
    }))
    .filter((t) => t.sourceFranchiseId && t.destFranchiseId && t.productId && t.quantity > 0);
  if (transferDocs.length) await Transfer.insertMany(transferDocs);

  const receptionDocs = receptionsOld
    .map((r) => {
      const lines = receptionLignesOld
        .filter((l) => Number(l.bon_id) === Number(r.id))
        .map((l) => ({
          productId: productMap.get(Number(l.produit_id)) || null,
          quantity: Number(l.quantite ?? 0),
          unitPrice: Number(l.prix_unitaire_ht ?? 0),
          unitPriceTtc: Number(l.prix_unitaire_ttc ?? 0),
          vatRate: Number(l.tva_rate ?? 19),
          lineTotalHt: Number(l.total_ht ?? 0),
          lineTotalTtc: Number(l.total_ttc ?? 0),
        }))
        .filter((l) => l.productId && l.quantity > 0);

      return {
        number: String(r.numero || `BR-${r.id}`),
        franchiseId: frMap.get(Number(r.franchise_id)) || null,
        supplierId: r.fournisseur_id ? supMap.get(Number(r.fournisseur_id)) || null : null,
        receptionDate: parseDateLike(r.date_reception),
        totalHt: Number(r.total_ht ?? 0),
        vat: Number(r.tva ?? 0),
        totalTtc: Number(r.total_ttc ?? 0),
        status: receptionStatusToNew(r.statut),
        note: r.note ? String(r.note) : undefined,
        userId: r.utilisateur_id ? userMap.get(Number(r.utilisateur_id)) || fallbackUserId : fallbackUserId,
        lines,
        createdAt: parseDateLike(r.date_creation),
        updatedAt: parseDateLike(r.date_creation),
      };
    })
    .filter((r) => r.franchiseId && r.number && r.lines.length > 0);
  if (receptionDocs.length) await Reception.insertMany(receptionDocs);

  const closingDocs = closingsOld
    .map((c) => ({
      franchiseId: frMap.get(Number(c.franchise_id)) || null,
      closingDate: parseDateLike(c.date_cloture),
      declaredSalesTotal: Number(c.total_ventes_declare ?? 0),
      declaredItemsTotal: Number(c.total_articles_declare ?? 0),
      systemSalesTotal: Number(c.total_ventes_systeme ?? 0),
      systemItemsTotal: Number(c.total_articles_systeme ?? 0),
      comment: c.commentaire ? String(c.commentaire) : undefined,
      validated: Number(c.valide ?? 0) === 1,
      submittedBy: userMap.get(Number(c.utilisateur_id)) || fallbackUserId,
      validatedBy: c.validateur_id ? userMap.get(Number(c.validateur_id)) || null : null,
      validatedAt: parseDateLike(c.date_creation),
      createdAt: parseDateLike(c.date_creation),
      updatedAt: parseDateLike(c.date_creation),
    }))
    .filter((c) => c.franchiseId && c.closingDate);
  if (closingDocs.length) await Closing.insertMany(closingDocs);

  const installmentDocs = echeancesOld
    .map((e) => ({
      saleId: factureToSale.get(Number(e.facture_id)) || null,
      franchiseId: frMap.get(Number(e.franchise_id)) || null,
      clientId: e.client_id ? clientMap.get(Number(e.client_id)) || null : null,
      amount: Number(e.montant ?? 0),
      dueDate: parseDateLike(e.date_echeance),
      status: installmentStatusToNew(e.statut),
      paidAt: parseDateLike(e.date_paiement),
      paymentMethod: paymentMethodToNew(e.mode_paiement),
      note: e.note ? String(e.note) : undefined,
      remind7dSent: Number(e.rappel_7j_envoye ?? 0) === 1,
      remind3dSent: Number(e.rappel_3j_envoye ?? 0) === 1,
      userId: userMap.get(Number(e.utilisateur_id)) || fallbackUserId,
      createdAt: parseDateLike(e.date_creation),
      updatedAt: parseDateLike(e.date_creation),
    }))
    .filter((e) => e.saleId && e.franchiseId && e.dueDate);
  if (installmentDocs.length) await Installment.insertMany(installmentDocs);

  const auditDocs = auditOld
    .map((a) => ({
      userId: a.utilisateur_id ? userMap.get(Number(a.utilisateur_id)) || null : null,
      username: a.utilisateur_nom ? String(a.utilisateur_nom) : null,
      action: String(a.action || 'legacy.action').slice(0, 64),
      entity: a.cible ? String(a.cible).slice(0, 64) : undefined,
      entityId: a.cible_id ? String(a.cible_id) : null,
      franchiseId: a.franchise_id ? frMap.get(Number(a.franchise_id)) || null : null,
      details: a.details ? String(a.details) : undefined,
      ip: a.ip_address ? String(a.ip_address) : undefined,
      userAgent: a.user_agent ? String(a.user_agent).slice(0, 255) : undefined,
      createdAt: parseDateLike(a.date_creation),
    }))
    .filter((a) => a.action);
  if (auditDocs.length) await AuditLog.insertMany(auditDocs);

  logger.info({
    categories: categoriesOld.length,
    suppliers: suppliersOld.length,
    franchises: franchisesOld.length,
    products: productsOld.length,
    users: usersOld.length,
    clients: clientsOld.length,
    stock: stockDocs.length,
    sales: factureToSale.size,
    transfers: transferDocs.length,
    receptions: receptionDocs.length,
    closings: closingDocs.length,
    installments: installmentDocs.length,
    auditLogs: auditDocs.length,
  }, 'Legacy SQL import complete');

  logger.info(`Imported users default password is: ${env.SEED_ADMIN_PASSWORD}`);
  await disconnectDb();
}

seedLegacy().catch(async (err) => {
  logger.error({ err }, 'Legacy seed failed');
  await disconnectDb();
  process.exit(1);
});
