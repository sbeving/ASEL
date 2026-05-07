import { createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { Router } from 'express';
import { z } from 'zod';
import mongoose, { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission, requireRole, type JwtPayload } from '../middleware/auth.js';
import { networkPointDocumentUpload, toUploadPath } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withMongoTransaction } from '../db/transaction.js';
import { NetworkPoint } from '../models/NetworkPoint.js';
import { NetworkPointAllocation } from '../models/NetworkPointAllocation.js';
import { CommercialZone } from '../models/CommercialZone.js';
import { Franchise } from '../models/Franchise.js';
import { User } from '../models/User.js';
import { Product } from '../models/Product.js';
import { audit } from '../services/audit.service.js';
import { applyStockDelta } from '../services/stock.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { ensureUploadDir, uploadRoot } from '../config/uploads.js';
import { isGlobalRole } from '../utils/roles.js';
import { assertLocationIntegrity, deviceIntegritySchema } from '../utils/locationIntegrity.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });
const pointType = z.enum(['franchise', 'activation', 'recharge', 'activation_recharge']);
const pointStatus = z.enum([
  'prospect',
  'contact',
  'contrat_non_signe',
  'contrat_signe',
  'actif',
  'suspendu',
  'resilie',
]);
const leadStatus = z.enum(['lead', 'contacted', 'qualified', 'contract_given', 'won', 'lost']);

interface GeoPoint {
  lat: number;
  lng: number;
}

type SignaturePoint = {
  x: number;
  y: number;
};

type SignatureTrace = SignaturePoint[][];

function pointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects =
      pi.lng > point.lng !== pj.lng > point.lng &&
      point.lat < ((pj.lat - pi.lat) * (point.lng - pi.lng)) / ((pj.lng - pi.lng) || Number.EPSILON) + pi.lat;
    if (intersects) inside = !inside;
  }
  return inside;
}

async function accessFilter(user: JwtPayload | undefined): Promise<Record<string, unknown>> {
  if (!user) return { _neverMatch: true };
  if (isGlobalRole(user.role)) return {};
  if (user.role === 'commercial') {
    const zoneIds = await CommercialZone.distinct('_id', {
      active: true,
      assignedCommercialIds: user.sub,
    });
    const access: Record<string, unknown>[] = [{ commercialId: user.sub }];
    if (user.franchiseId) access.push({ franchiseId: user.franchiseId });
    if (zoneIds.length > 0) access.push({ zoneId: mongoose.trusted({ $in: zoneIds }) });
    return { $or: access };
  }
  if (user.franchiseId) return { franchiseId: user.franchiseId };
  return { _neverMatch: true };
}

function mergeFilter(base: Record<string, unknown>, access: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(access).length === 0) return base;
  return { $and: [base, access] };
}

function canEditPoint(user: JwtPayload, point: { commercialId?: unknown; franchiseId?: unknown }) {
  if (isGlobalRole(user.role)) return true;
  if (user.role === 'commercial') {
    const commercialId = point.commercialId?.toString?.();
    return commercialId === user.sub;
  }
  if (user.franchiseId && point.franchiseId?.toString?.() === user.franchiseId) return true;
  return false;
}

function uploadedFieldFile(req: Express.Request, field: string) {
  const files = req.files;
  if (!files || Array.isArray(files)) return undefined;
  return files[field]?.[0];
}

function pointDocumentPath(file: Express.Multer.File | undefined) {
  return file ? toUploadPath('network-point-docs', file.filename) : null;
}

function decodeSignatureDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match?.[1] || !match[2]) throw badRequest('Signature electronique invalide');

  const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (buffer.length === 0) throw badRequest('Signature electronique vide');
  if (buffer.length > 5 * 1024 * 1024) throw badRequest('Signature electronique trop volumineuse');
  return { buffer, extension: `.${extension}` };
}

async function saveSignature(dataUrl: string) {
  const { buffer, extension } = decodeSignatureDataUrl(dataUrl);
  const filename = `${Date.now()}-${crypto.randomUUID()}-signature${extension}`;
  await fs.writeFile(path.join(ensureUploadDir('network-point-docs'), filename), buffer);
  return toUploadPath('network-point-docs', filename);
}

function parseSignatureTrace(raw?: string | null): SignatureTrace | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest('Trace de signature invalide');
  }
  if (!Array.isArray(parsed)) throw badRequest('Trace de signature invalide');
  const trace = parsed
    .map((stroke) => {
      if (!Array.isArray(stroke)) return [];
      return stroke
        .map((point) => {
          const x = Number((point as SignaturePoint).x);
          const y = Number((point as SignaturePoint).y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          return {
            x: Math.max(0, Math.min(1, x)),
            y: Math.max(0, Math.min(1, y)),
          };
        })
        .filter(Boolean) as SignaturePoint[];
    })
    .filter((stroke) => stroke.length > 0);
  if (trace.length === 0) throw badRequest('Signature electronique vide');
  if (trace.reduce((sum, stroke) => sum + stroke.length, 0) > 5000) {
    throw badRequest('Signature electronique trop volumineuse');
  }
  return trace;
}

function escapeSvg(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function saveSignatureTrace(trace: SignatureTrace, signatureText?: string | null) {
  const filename = `${Date.now()}-${crypto.randomUUID()}-signature.svg`;
  const width = 640;
  const height = 220;
  const polylines = trace
    .map((stroke) => {
      const points = stroke
        .map((point) => `${Math.round(point.x * width)},${Math.round(point.y * height)}`)
        .join(' ');
      return `<polyline points="${points}" fill="none" stroke="#0f172a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join('\n');
  const label = signatureText
    ? `<text x="24" y="${height - 20}" font-family="Arial, sans-serif" font-size="18" fill="#64748b">${escapeSvg(signatureText)}</text>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" rx="16" fill="#ffffff"/>
${polylines}
${label}
</svg>`;
  await fs.writeFile(path.join(ensureUploadDir('network-point-docs'), filename), svg, 'utf8');
  return toUploadPath('network-point-docs', filename);
}

function resolveStoredUploadPath(uploadPath: string) {
  const resolved = path.resolve(uploadRoot, uploadPath);
  if (!resolved.startsWith(path.resolve(uploadRoot))) {
    throw badRequest('Invalid stored document path');
  }
  return resolved;
}

type PointDocuments = {
  cinImagePath?: string | null;
  shopImagePath?: string | null;
  signaturePath?: string | null;
  signatureText?: string | null;
  infoSheetPdfPath?: string | null;
  signedAt?: Date | string | null;
  generatedAt?: Date | string | null;
};

type PointSnapshot = {
  _id?: unknown;
  name?: string;
  type?: string;
  status?: string;
  address?: string;
  city?: string;
  governorate?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  responsible?: string;
  responsibleFirstName?: string;
  responsibleLastName?: string;
  cin?: string;
  schedule?: string;
  gps?: { lat?: number | null; lng?: number | null };
  internalNotes?: string;
  documents?: PointDocuments;
};

type AllocationProduct = {
  _id: mongoose.Types.ObjectId;
  active: boolean;
  purchasePrice?: number | null;
};

function pdfField(doc: PDFKit.PDFDocument, label: string, value?: string | number | null) {
  doc.fontSize(9).fillColor('#64748b').text(label, { continued: false });
  doc.fontSize(11).fillColor('#0f172a').text(value == null || value === '' ? '-' : String(value));
  doc.moveDown(0.35);
}

function pdfImage(doc: PDFKit.PDFDocument, label: string, uploadPath?: string | null) {
  if (!uploadPath) return;
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#0f172a').text(label);
  const ext = path.extname(uploadPath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
    doc.fontSize(9).fillColor('#64748b').text(uploadPath);
    return;
  }
  try {
    const absolutePath = resolveStoredUploadPath(uploadPath);
    if (existsSync(absolutePath)) doc.image(absolutePath, { fit: [230, 150] });
    else doc.fontSize(9).fillColor('#64748b').text(uploadPath);
  } catch {
    doc.fontSize(9).fillColor('#64748b').text(uploadPath);
  }
}

function pdfSignatureTrace(doc: PDFKit.PDFDocument, trace?: SignatureTrace | null, signatureText?: string | null) {
  if (!trace?.length && !signatureText) return;
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#0f172a').text('Signature electronique');
  const left = doc.x;
  const top = doc.y + 4;
  const width = 230;
  const height = 82;
  doc.roundedRect(left, top, width, height, 6).strokeColor('#cbd5e1').lineWidth(1).stroke();
  doc.strokeColor('#0f172a').lineWidth(1.6);
  if (trace?.length) {
    for (const stroke of trace) {
      stroke.forEach((point, index) => {
        const x = left + point.x * width;
        const y = top + point.y * height;
        if (index === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      });
      doc.stroke();
    }
  }
  if (signatureText) {
    doc.fontSize(8).fillColor('#64748b').text(signatureText, left + 8, top + height - 16, { width: width - 16 });
  }
  doc.y = top + height + 8;
}

async function generateNetworkPointPdf(
  point: PointSnapshot,
  documents: PointDocuments,
  signatureTrace?: SignatureTrace | null,
) {
  const filename = `${Date.now()}-${crypto.randomUUID()}-fiche-point-reseau.pdf`;
  const absolutePath = path.join(ensureUploadDir('network-point-docs'), filename);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const stream = createWriteStream(absolutePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    doc.fontSize(18).fillColor('#0f172a').text('Fiche de renseignement point reseau');
    doc.fontSize(9).fillColor('#64748b').text(`Generee le ${new Date().toLocaleString('fr-TN')}`);
    doc.moveDown();

    pdfField(doc, 'Point', point.name);
    pdfField(doc, 'Type', point.type);
    pdfField(doc, 'Statut', point.status);
    pdfField(doc, 'Responsable', point.responsible);
    pdfField(doc, 'Prenom responsable', point.responsibleFirstName);
    pdfField(doc, 'Nom responsable', point.responsibleLastName);
    pdfField(doc, 'CIN', point.cin);
    pdfField(doc, 'Telephone 1', point.phone);
    pdfField(doc, 'Telephone 2', point.phone2);
    pdfField(doc, 'Email', point.email);
    pdfField(doc, 'Adresse', [point.address, point.city, point.governorate].filter(Boolean).join(', '));
    pdfField(
      doc,
      'GPS',
      point.gps?.lat != null && point.gps?.lng != null ? `${point.gps.lat}, ${point.gps.lng}` : '',
    );
    pdfField(doc, 'Horaires', point.schedule);
    pdfField(doc, 'Notes', point.internalNotes);
    pdfField(doc, 'Signature le', documents.signedAt ? new Date(documents.signedAt).toLocaleString('fr-TN') : '');

    pdfImage(doc, 'Preuve CIN', documents.cinImagePath);
    pdfImage(doc, 'Image boutique', documents.shopImagePath);
    if (signatureTrace?.length || documents.signatureText) {
      pdfSignatureTrace(doc, signatureTrace, documents.signatureText);
    } else {
      pdfImage(doc, 'Signature electronique', documents.signaturePath);
    }

    doc.end();
  });

  return toUploadPath('network-point-docs', filename);
}

async function accessibleZones(user: JwtPayload, activeOnly = true) {
  const filter: Record<string, unknown> = activeOnly ? { active: true } : {};
  if (isGlobalRole(user.role)) {
    // global view
  } else if (user.role === 'commercial') {
    filter.assignedCommercialIds = user.sub;
  } else if (user.franchiseId) {
    filter.franchiseId = user.franchiseId;
  } else {
    filter._neverMatch = true;
  }

  return CommercialZone.find(filter)
    .sort({ name: 1 })
    .populate('franchiseId', 'name')
    .populate('assignedCommercialIds', 'fullName username role')
    .lean();
}

async function resolveZoneForPoint(user: JwtPayload, gps?: GeoPoint | null, requestedZoneId?: string | null) {
  if (!gps || typeof gps.lat !== 'number' || typeof gps.lng !== 'number') {
    if (user.role === 'commercial') throw badRequest('GPS is required for commercial points');
    return null;
  }

  const zones = await accessibleZones(user, true);
  const matchingZone = requestedZoneId
    ? zones.find((zone) => zone._id.toString() === requestedZoneId && pointInPolygon(gps, zone.polygon as GeoPoint[]))
    : zones.find((zone) => pointInPolygon(gps, zone.polygon as GeoPoint[]));

  if (requestedZoneId && !matchingZone) throw badRequest('Selected zone does not contain this GPS point');
  if (user.role === 'commercial' && !matchingZone) {
    if (zones.length === 0) throw badRequest('Commercial must be linked to an active zone before creating points');
    throw badRequest('Commercial point is outside assigned zone');
  }

  return matchingZone?._id ?? null;
}

async function assertAssignableCommercials(commercialIds: string[]) {
  if (commercialIds.length === 0) return;

  const users = await User.find({
    _id: mongoose.trusted({ $in: commercialIds }),
    role: 'commercial',
    active: true,
  })
    .select('franchiseId')
    .lean();

  if (users.length !== commercialIds.length) {
    throw badRequest('All assigned users must be active commercials');
  }

}

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  type: pointType.optional(),
  status: pointStatus.optional(),
  commercialId: objectId.optional(),
  zoneId: objectId.optional(),
  city: z.string().trim().max(100).optional(),
  onlyMapped: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(300).default(40),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

function buildPointFilter(input: z.infer<typeof listQuery>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (input.type) filter.type = input.type;
  if (input.status) filter.status = input.status;
  if (input.commercialId) filter.commercialId = input.commercialId;
  if (input.zoneId) filter.zoneId = input.zoneId;
  if (input.city) {
    const escaped = input.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.city = mongoose.trusted({ $regex: escaped, $options: 'i' });
  }
  if (input.active !== undefined) filter.active = input.active;
  else filter.active = true;
  if (input.onlyMapped) {
    filter['gps.lat'] = mongoose.trusted({ $ne: null });
    filter['gps.lng'] = mongoose.trusted({ $ne: null });
  }
  if (input.q) {
    const escaped = input.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    filter.$or = [{ name: rx }, { address: rx }, { city: rx }, { responsible: rx }, { internalNotes: rx }];
  }
  return filter;
}

router.get(
  '/',
  requireAuth,
  requirePermission('map.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const input = req.query as unknown as z.infer<typeof listQuery>;
    const pageSize = input.pageSize;
    const page = input.page;
    const skip = (page - 1) * pageSize;
    const filter = mergeFilter(buildPointFilter(input), await accessFilter(req.user));

    const [total, points, countsByType, countsByStatus, mappedCount] = await Promise.all([
      NetworkPoint.countDocuments(filter),
      NetworkPoint.find(filter)
        .sort({ type: 1, name: 1 })
        .skip(skip)
        .limit(pageSize)
        .populate('franchiseId', 'name')
        .populate('commercialId', 'fullName username role')
        .populate('zoneId', 'name color')
        .populate('createdBy', 'fullName username'),
      NetworkPoint.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      NetworkPoint.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      NetworkPoint.countDocuments({
        ...filter,
        'gps.lat': mongoose.trusted({ $ne: null }),
        'gps.lng': mongoose.trusted({ $ne: null }),
      }),
    ]);

    const byType = countsByType.reduce<Record<string, number>>((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});
    const byStatus = countsByStatus.reduce<Record<string, number>>((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});

    res.json({
      points,
      summary: {
        total,
        mapped: mappedCount,
        byType,
        byStatus,
      },
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  }),
);

const mapQuery = z.object({
  type: pointType.optional(),
  status: pointStatus.optional(),
  fallbackFranchises: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

router.get(
  '/map',
  requireAuth,
  requirePermission('map.view'),
  validate(mapQuery, 'query'),
  asyncHandler(async (req, res) => {
    const input = req.query as unknown as z.infer<typeof mapQuery>;
    const pointFilter: Record<string, unknown> = {
      active: true,
      'gps.lat': mongoose.trusted({ $ne: null }),
      'gps.lng': mongoose.trusted({ $ne: null }),
    };
    if (input.type) pointFilter.type = input.type;
    if (input.status) pointFilter.status = input.status;
    const filter = mergeFilter(pointFilter, await accessFilter(req.user));

    const [points, zones] = await Promise.all([
      NetworkPoint.find(filter)
      .sort({ type: 1, name: 1 })
        .populate('franchiseId', 'name')
        .populate('commercialId', 'fullName username role')
        .populate('zoneId', 'name color'),
      accessibleZones(req.user!, true),
    ]);

    if (points.length > 0 || !input.fallbackFranchises || !isGlobalRole(req.user!.role)) {
      return res.json({ points, zones, source: 'network_points' });
    }

    const franchises = await Franchise.find({
      active: true,
      'gps.lat': mongoose.trusted({ $ne: null }),
      'gps.lng': mongoose.trusted({ $ne: null }),
    })
      .sort({ name: 1 })
      .select('name address phone manager gps');

    const fallbackPoints = franchises.map((franchise) => ({
      _id: `franchise-${franchise._id.toString()}`,
      name: franchise.name,
      type: 'franchise',
      status: 'actif',
      address: franchise.address ?? '',
      city: '',
      governorate: '',
      phone: franchise.phone ?? '',
      phone2: '',
      email: '',
      responsible: franchise.manager ?? '',
      schedule: '',
      gps: franchise.gps ?? { lat: null, lng: null },
      internalNotes: '',
      franchiseId: franchise,
      commissionPct: 0,
      active: true,
      createdAt: franchise.createdAt,
      updatedAt: franchise.updatedAt,
    }));

    res.json({ points: fallbackPoints, zones, source: 'franchises' });
  }),
);

const zonePayload = z.object({
  name: z.string().trim().min(1).max(140),
  color: z.string().trim().max(20).default('#2563eb'),
  franchiseId: objectId.nullable().optional(),
  assignedCommercialIds: z.array(objectId).max(200).default([]),
  polygon: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).min(3),
  note: z.string().trim().max(1000).optional(),
  active: z.boolean().optional(),
});

function assertZoneOwner(input: { franchiseId?: string | null; assignedCommercialIds?: string[] }) {
  if (!input.franchiseId && (input.assignedCommercialIds?.length ?? 0) === 0) {
    throw badRequest('A zone must be linked to at least one commercial or franchise');
  }
}

router.get(
  '/zones',
  requireAuth,
  requirePermission('map.view', 'timelogs.view.all'),
  asyncHandler(async (req, res) => {
    const zones = await accessibleZones(req.user!, false);
    res.json({ zones });
  }),
);

router.post(
  '/zones',
  requireAuth,
  requireRole('admin', 'manager', 'commercial_director'),
  requirePermission('map.zones.manage'),
  validate(zonePayload),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof zonePayload>;
    assertZoneOwner(input);
    if (input.franchiseId && !(await Franchise.exists({ _id: input.franchiseId }))) {
      throw badRequest('franchiseId does not exist');
    }
    await assertAssignableCommercials(input.assignedCommercialIds);

    const zone = await CommercialZone.create({
      ...input,
      franchiseId: input.franchiseId ?? null,
      note: input.note ?? '',
      active: input.active ?? true,
      createdBy: req.user!.sub,
    });
    await audit(req, {
      action: 'commercial_zone.create',
      entity: 'CommercialZone',
      entityId: zone._id.toString(),
      details: { name: zone.name, points: zone.polygon.length },
    });
    const row = await CommercialZone.findById(zone._id)
      .populate('franchiseId', 'name')
      .populate('assignedCommercialIds', 'fullName username role');
    res.status(201).json({ zone: row });
  }),
);

router.patch(
  '/zones/:id',
  requireAuth,
  requireRole('admin', 'manager', 'commercial_director'),
  requirePermission('map.zones.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(zonePayload.partial()),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as Partial<z.infer<typeof zonePayload>>;
    const zone = await CommercialZone.findById(id);
    if (!zone) throw notFound('Commercial zone not found');
    if (input.franchiseId && !(await Franchise.exists({ _id: input.franchiseId }))) {
      throw badRequest('franchiseId does not exist');
    }
    if (input.assignedCommercialIds) {
      await assertAssignableCommercials(input.assignedCommercialIds);
    }
    assertZoneOwner({
      franchiseId: input.franchiseId !== undefined ? input.franchiseId : (zone.franchiseId?.toString?.() ?? null),
      assignedCommercialIds:
        input.assignedCommercialIds ??
        (zone.assignedCommercialIds ?? []).map((id) => id.toString()),
    });

    Object.assign(zone, {
      ...input,
      ...(input.franchiseId !== undefined ? { franchiseId: input.franchiseId ?? null } : {}),
      ...(input.note !== undefined ? { note: input.note ?? '' } : {}),
    });
    await zone.save();
    await audit(req, { action: 'commercial_zone.update', entity: 'CommercialZone', entityId: id });
    const row = await CommercialZone.findById(zone._id)
      .populate('franchiseId', 'name')
      .populate('assignedCommercialIds', 'fullName username role');
    res.json({ zone: row });
  }),
);

router.delete(
  '/zones/:id',
  requireAuth,
  requireRole('admin', 'manager', 'commercial_director'),
  requirePermission('map.zones.manage'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const zone = await CommercialZone.findById(id);
    if (!zone) throw notFound('Commercial zone not found');
    zone.active = false;
    await zone.save();
    await audit(req, { action: 'commercial_zone.archive', entity: 'CommercialZone', entityId: id });
    res.json({ zone });
  }),
);

const allocationPayload = z.object({
  franchiseId: objectId.optional(),
  productId: objectId.optional(),
  kind: z.enum(['sim', 'recharge', 'other']).default('sim'),
  quantity: z.coerce.number().int().min(0).default(0),
  amount: z.coerce.number().min(0).optional(),
  barcodes: z.array(z.string().trim().min(1).max(120)).max(500).default([]),
  note: z.string().trim().max(1000).optional(),
});

function uniqueBarcodes(barcodes: string[]) {
  return [...new Set(barcodes.map((barcode) => barcode.trim()).filter(Boolean))];
}

function resolveAllocationFranchise(user: JwtPayload, point: { franchiseId?: unknown }, requested?: string) {
  if (isGlobalRole(user.role)) {
    const pointFranchiseId = point.franchiseId?.toString?.() ?? '';
    const fid = requested || pointFranchiseId;
    if (!fid) throw badRequest('franchiseId is required for this allocation');
    return fid;
  }
  if (!user.franchiseId) throw forbidden('No franchise assigned');
  if (requested && requested !== user.franchiseId) throw forbidden();
  return user.franchiseId;
}

router.get(
  '/:id/allocations',
  requireAuth,
  requirePermission('map.view'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const point = await NetworkPoint.findOne(mergeFilter({ _id: id }, await accessFilter(req.user)));
    if (!point) throw notFound('Network point not found');

    const allocations = await NetworkPointAllocation.find({ networkPointId: id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('franchiseId', 'name')
      .populate('productId', 'name reference barcode')
      .populate('commercialId', 'fullName username')
      .populate('createdBy', 'fullName username');

    res.json({ allocations });
  }),
);

function summarizeAllocations(rows: Array<{ _id: string; quantity: number; amount: number; barcodeCount: number }>) {
  return rows.reduce(
    (acc, row) => {
      acc.quantity += row.quantity;
      acc.amount += row.amount;
      acc.barcodeCount += row.barcodeCount;
      acc.byKind[row._id] = {
        quantity: row.quantity,
        amount: row.amount,
        barcodeCount: row.barcodeCount,
      };
      return acc;
    },
    {
      quantity: 0,
      amount: 0,
      barcodeCount: 0,
      byKind: {} as Record<string, { quantity: number; amount: number; barcodeCount: number }>,
    },
  );
}

router.get(
  '/:id/overview',
  requireAuth,
  requirePermission('map.view'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const point = await NetworkPoint.findOne(mergeFilter({ _id: id }, await accessFilter(req.user)))
      .populate('franchiseId', 'name')
      .populate('commercialId', 'fullName username role')
      .populate('zoneId', 'name color')
      .populate('createdBy', 'fullName username');
    if (!point) throw notFound('Network point not found');

    const pointId = new mongoose.Types.ObjectId(id);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const aggregatePipeline = (fromDate?: Date) => [
      {
        $match: {
          networkPointId: pointId,
          ...(fromDate ? { createdAt: mongoose.trusted({ $gte: fromDate }) } : {}),
        },
      },
      {
        $group: {
          _id: '$kind',
          quantity: { $sum: '$quantity' },
          amount: { $sum: '$amount' },
          barcodeCount: { $sum: { $size: { $ifNull: ['$barcodes', []] } } },
        },
      },
    ];

    const [allocations, monthlyRows, totalRows] = await Promise.all([
      NetworkPointAllocation.find({ networkPointId: id })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate('franchiseId', 'name')
        .populate('productId', 'name reference barcode')
        .populate('commercialId', 'fullName username')
        .populate('createdBy', 'fullName username'),
      NetworkPointAllocation.aggregate<{ _id: string; quantity: number; amount: number; barcodeCount: number }>(
        aggregatePipeline(monthStart),
      ),
      NetworkPointAllocation.aggregate<{ _id: string; quantity: number; amount: number; barcodeCount: number }>(
        aggregatePipeline(),
      ),
    ]);

    res.json({
      point,
      allocations,
      monthly: summarizeAllocations(monthlyRows),
      totals: summarizeAllocations(totalRows),
    });
  }),
);

router.post(
  '/:id/allocations',
  requireAuth,
  requireRole('admin', 'manager', 'commercial_director', 'franchise', 'commercial'),
  requirePermission('map.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(allocationPayload),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof allocationPayload>;
    const point = await NetworkPoint.findOne(mergeFilter({ _id: id }, await accessFilter(req.user)));
    if (!point) throw notFound('Network point not found');
    if (!canEditPoint(req.user!, point)) throw forbidden();

    const barcodes = uniqueBarcodes(input.barcodes);
    const fid = resolveAllocationFranchise(req.user!, point, input.franchiseId);
    const allocationId = new mongoose.Types.ObjectId();

    let product: AllocationProduct | null = null;
    let quantity = input.quantity;
    let amount = input.amount ?? 0;

    const allocation = await withMongoTransaction(async (session) => {
      if (input.kind === 'sim') {
        if (!input.productId) throw badRequest('Produit SIM requis');
        quantity = barcodes.length;
        amount = 0;
        if (quantity === 0) throw badRequest('SIM allocation requires scanned barcodes');

        const duplicateAllocation = await NetworkPointAllocation.exists({
          barcodes: mongoose.trusted({ $in: barcodes }),
        }).session(session ?? null);
        if (duplicateAllocation) {
          throw badRequest('One or more SIM barcodes are already allocated to a network point');
        }

        product = await Product.findById(input.productId)
          .select('active purchasePrice')
          .session(session ?? null)
          .lean<AllocationProduct>();
        if (!product || !product.active) throw badRequest('Product not found or inactive');

        await applyStockDelta({
          franchiseId: fid,
          productId: product._id,
          delta: -quantity,
          type: 'network_point_allocation',
          userId: req.user!.sub,
          unitPrice: product.purchasePrice ?? 0,
          note: `Dotation SIM - ${point.name}`,
          refId: allocationId,
          session,
        });
      } else if (input.kind === 'recharge') {
        quantity = 0;
        if (!amount || amount <= 0) throw badRequest('Montant solde requis');
      } else {
        quantity = input.quantity || 0;
        amount = input.amount ?? 0;
      }

      const [createdAllocation] = await NetworkPointAllocation.create(
        [
          {
            _id: allocationId,
            networkPointId: point._id,
            franchiseId: fid,
            productId: product?._id ?? null,
            kind: input.kind,
            quantity,
            amount,
            barcodes: input.kind === 'sim' ? barcodes : [],
            note: input.note ?? '',
            commercialId: point.commercialId ?? (req.user!.role === 'commercial' ? req.user!.sub : null),
            createdBy: req.user!.sub,
          },
        ],
        { session },
      );
      if (!createdAllocation) throw badRequest('Allocation could not be created');
      return createdAllocation;
    });
    if (!allocation) throw badRequest('Allocation could not be created');

    await audit(req, {
      action: 'network_point.allocation.create',
      entity: 'NetworkPointAllocation',
      entityId: allocation._id.toString(),
      franchiseId: fid,
      details: {
        networkPointId: id,
        productId: input.kind === 'sim' ? input.productId ?? null : null,
        kind: input.kind,
        quantity,
        amount,
      },
    });

    const row = await NetworkPointAllocation.findById(allocation._id)
      .populate('franchiseId', 'name')
      .populate('productId', 'name reference barcode')
      .populate('commercialId', 'fullName username')
      .populate('createdBy', 'fullName username');

    res.status(201).json({ allocation: row });
  }),
);

const documentPayload = z.object({
  responsible: z.string().trim().max(150).optional(),
  responsibleFirstName: z.string().trim().max(80).optional(),
  responsibleLastName: z.string().trim().max(80).optional(),
  cin: z.string().trim().max(40).optional(),
  signatureDataUrl: z.string().trim().max(7_000_000).optional(),
  signatureTrace: z.string().trim().max(2_000_000).optional(),
  signatureText: z.string().trim().max(150).optional(),
});

router.post(
  '/:id/documents',
  requireAuth,
  requireRole('admin', 'manager', 'commercial_director', 'franchise', 'commercial'),
  requirePermission('map.manage'),
  validate(z.object({ id: objectId }), 'params'),
  networkPointDocumentUpload.fields([
    { name: 'cinImage', maxCount: 1 },
    { name: 'shopImage', maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const parsed = documentPayload.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid point document payload', parsed.error.flatten());
    const input = parsed.data;
    const point = await NetworkPoint.findOne(mergeFilter({ _id: id }, await accessFilter(req.user)));
    if (!point) throw notFound('Network point not found');
    if (!canEditPoint(req.user!, point)) throw forbidden();

    const cinImagePath = pointDocumentPath(uploadedFieldFile(req, 'cinImage'));
    const shopImagePath = pointDocumentPath(uploadedFieldFile(req, 'shopImage'));
    const signatureTrace = parseSignatureTrace(input.signatureTrace);
    const signatureText = input.signatureText ?? input.responsible ?? '';
    const signaturePath = input.signatureDataUrl
      ? await saveSignature(input.signatureDataUrl)
      : signatureTrace
        ? await saveSignatureTrace(signatureTrace, signatureText)
        : null;
    const existingDocuments = point.documents ?? {};
    const nextSignedAt = signaturePath ? new Date() : existingDocuments.signedAt ?? null;
    const documents: PointDocuments = {
      cinImagePath: cinImagePath ?? existingDocuments.cinImagePath ?? null,
      shopImagePath: shopImagePath ?? existingDocuments.shopImagePath ?? null,
      signaturePath: signaturePath ?? existingDocuments.signaturePath ?? null,
      signatureText: signatureText || existingDocuments.signatureText || null,
      infoSheetPdfPath: existingDocuments.infoSheetPdfPath ?? null,
      signedAt: nextSignedAt,
      generatedAt: new Date(),
    };

    if (!documents.signaturePath) throw badRequest('Signature electronique requise pour generer la fiche');

    const responsibleFirstName = input.responsibleFirstName ?? point.responsibleFirstName ?? '';
    const responsibleLastName = input.responsibleLastName ?? point.responsibleLastName ?? '';
    const responsible =
      input.responsible ??
      [responsibleFirstName, responsibleLastName].filter(Boolean).join(' ') ??
      point.responsible ??
      '';

    point.set({
      responsible,
      responsibleFirstName,
      responsibleLastName,
      cin: input.cin ?? point.cin ?? '',
      documents,
    });

    const infoSheetPdfPath = await generateNetworkPointPdf(point.toObject() as PointSnapshot, documents, signatureTrace);
    point.set('documents.infoSheetPdfPath', infoSheetPdfPath);
    point.set('documents.generatedAt', new Date());
    await point.save();

    await audit(req, {
      action: 'network_point.documents.update',
      entity: 'NetworkPoint',
      entityId: point._id.toString(),
      details: {
        cinImage: Boolean(cinImagePath),
        shopImage: Boolean(shopImagePath),
        signature: Boolean(signaturePath),
        signatureTrace: Boolean(signatureTrace),
        infoSheetPdfPath,
      },
    });

    const row = await NetworkPoint.findById(point._id)
      .populate('franchiseId', 'name')
      .populate('commercialId', 'fullName username role')
      .populate('zoneId', 'name color')
      .populate('createdBy', 'fullName username');

    res.json({ point: row });
  }),
);

const payloadBase = z.object({
    name: z.string().trim().min(1).max(200),
    type: pointType.default('activation_recharge'),
    status: pointStatus.default('prospect'),
    address: z.string().trim().max(255).optional(),
    city: z.string().trim().max(100).optional(),
    governorate: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(50).optional(),
    phone2: z.string().trim().max(50).optional(),
    email: z.string().trim().email().max(150).optional().or(z.literal('')),
    responsible: z.string().trim().max(150).optional(),
    responsibleFirstName: z.string().trim().max(80).optional(),
    responsibleLastName: z.string().trim().max(80).optional(),
    cin: z.string().trim().max(40).optional(),
    schedule: z.string().trim().max(255).optional(),
    gps: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).optional().nullable(),
        mocked: z.boolean().optional().nullable(),
      })
      .nullable()
      .optional(),
    integrity: deviceIntegritySchema,
    internalNotes: z.string().trim().max(3000).optional(),
    franchiseId: objectId.nullable().optional(),
    commercialId: objectId.nullable().optional(),
    zoneId: objectId.nullable().optional(),
    leadStatus: leadStatus.optional(),
    contractGiven: z.boolean().optional(),
    contactDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    lastContactedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    contractDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    activationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    commissionPct: z.number().min(0).max(100).optional(),
    active: z.boolean().optional(),
  });

const createPayload = payloadBase.refine((value) => {
    if (value.type !== 'franchise') return true;
    return !!value.franchiseId;
  }, {
    path: ['franchiseId'],
    message: 'franchiseId is required when type=franchise',
  });

const updatePayload = payloadBase.partial();

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager', 'commercial_director', 'franchise', 'commercial'),
  requirePermission('map.manage'),
  validate(createPayload),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createPayload>;
    if (input.franchiseId && !(await Franchise.exists({ _id: input.franchiseId }))) {
      throw badRequest('franchiseId does not exist');
    }
    if (req.user!.role === 'commercial') {
      input.commercialId = req.user!.sub;
      input.franchiseId = req.user!.franchiseId ?? null;
    } else if (input.commercialId && !(await User.exists({ _id: input.commercialId, role: 'commercial' }))) {
      throw badRequest('commercialId does not exist');
    }
    if (input.type === 'franchise' && !input.franchiseId) {
      throw badRequest('franchiseId is required when type=franchise');
    }
    const integrityAssessment = assertLocationIntegrity(input.gps ?? null, input.integrity);
    const zoneId = await resolveZoneForPoint(req.user!, input.gps ?? null, input.zoneId ?? null);

    const point = await NetworkPoint.create({
      ...input,
      email: input.email || '',
      address: input.address ?? '',
      city: input.city ?? '',
      governorate: input.governorate ?? '',
      phone: input.phone ?? '',
      phone2: input.phone2 ?? '',
      responsible: input.responsible ?? '',
      responsibleFirstName: input.responsibleFirstName ?? '',
      responsibleLastName: input.responsibleLastName ?? '',
      cin: input.cin ?? '',
      schedule: input.schedule ?? 'Lun-Sam: 09:00-19:00',
      internalNotes: input.internalNotes ?? '',
      commercialId: input.commercialId ?? null,
      zoneId,
      leadStatus: input.contractGiven ? 'contract_given' : input.leadStatus ?? 'lead',
      contractGiven: input.contractGiven ?? false,
      contractGivenAt: input.contractGiven ? new Date() : null,
      contactDate: input.contactDate ? new Date(`${input.contactDate}T00:00:00.000Z`) : null,
      lastContactedAt: input.lastContactedAt ? new Date(`${input.lastContactedAt}T00:00:00.000Z`) : null,
      contractDate: input.contractDate ? new Date(`${input.contractDate}T00:00:00.000Z`) : null,
      activationDate: input.activationDate ? new Date(`${input.activationDate}T00:00:00.000Z`) : null,
      commissionPct: input.commissionPct ?? 0,
      active: input.active ?? true,
      createdBy: req.user!.sub,
      gps: input.gps ?? { lat: null, lng: null },
      integrity: integrityAssessment.integrity,
    });

    await audit(req, {
      action: 'network_point.create',
      entity: 'NetworkPoint',
      entityId: point._id.toString(),
      details: { type: point.type, status: point.status },
    });

    const row = await NetworkPoint.findById(point._id)
      .populate('franchiseId', 'name')
      .populate('commercialId', 'fullName username role')
      .populate('zoneId', 'name color')
      .populate('createdBy', 'fullName username');
    res.status(201).json({ point: row });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'commercial_director', 'franchise', 'commercial'),
  requirePermission('map.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(updatePayload),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof updatePayload>;
    const point = await NetworkPoint.findById(id);
    if (!point) throw notFound('Network point not found');
    if (!canEditPoint(req.user!, point)) throw forbidden();

    if (input.franchiseId && !(await Franchise.exists({ _id: input.franchiseId }))) {
      throw badRequest('franchiseId does not exist');
    }
    if (req.user!.role === 'commercial') {
      input.commercialId = req.user!.sub;
      input.franchiseId = req.user!.franchiseId ?? null;
    } else if (input.commercialId && !(await User.exists({ _id: input.commercialId, role: 'commercial' }))) {
      throw badRequest('commercialId does not exist');
    }
    const nextType = input.type ?? point.type;
    const nextFranchiseId = input.franchiseId !== undefined ? input.franchiseId : point.franchiseId;
    if (nextType === 'franchise' && !nextFranchiseId) {
      throw badRequest('franchiseId is required when type=franchise');
    }
    const nextGps = input.gps !== undefined ? input.gps : point.gps;
    const integrityAssessment =
      input.gps !== undefined || input.integrity
        ? assertLocationIntegrity(nextGps, input.integrity)
        : null;
    const zoneId = await resolveZoneForPoint(req.user!, nextGps as GeoPoint | null, input.zoneId ?? point.zoneId?.toString?.() ?? null);

    Object.assign(point, {
      ...input,
      ...(input.email !== undefined ? { email: input.email || '' } : {}),
      ...(input.contactDate !== undefined
        ? { contactDate: input.contactDate ? new Date(`${input.contactDate}T00:00:00.000Z`) : null }
        : {}),
      ...(input.contractDate !== undefined
        ? { contractDate: input.contractDate ? new Date(`${input.contractDate}T00:00:00.000Z`) : null }
        : {}),
      ...(input.activationDate !== undefined
        ? { activationDate: input.activationDate ? new Date(`${input.activationDate}T00:00:00.000Z`) : null }
        : {}),
      ...(input.lastContactedAt !== undefined
        ? { lastContactedAt: input.lastContactedAt ? new Date(`${input.lastContactedAt}T00:00:00.000Z`) : null }
        : {}),
      ...(input.gps !== undefined ? { gps: input.gps ?? { lat: null, lng: null } } : {}),
      ...(integrityAssessment?.integrity ? { integrity: integrityAssessment.integrity } : {}),
      ...(zoneId !== null ? { zoneId } : {}),
      ...(input.contractGiven !== undefined
        ? { contractGivenAt: input.contractGiven ? point.contractGivenAt ?? new Date() : null }
        : {}),
    });
    await point.save();

    await audit(req, {
      action: 'network_point.update',
      entity: 'NetworkPoint',
      entityId: point._id.toString(),
      details: { type: point.type, status: point.status, active: point.active },
    });

    const row = await NetworkPoint.findById(point._id)
      .populate('franchiseId', 'name')
      .populate('commercialId', 'fullName username role')
      .populate('zoneId', 'name color')
      .populate('createdBy', 'fullName username');
    res.json({ point: row });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager', 'commercial_director', 'franchise', 'commercial'),
  requirePermission('map.manage'),
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const point = await NetworkPoint.findById(id);
    if (!point) throw notFound('Network point not found');
    if (!canEditPoint(req.user!, point)) throw forbidden();
    point.active = false;
    await point.save();

    await audit(req, {
      action: 'network_point.archive',
      entity: 'NetworkPoint',
      entityId: point._id.toString(),
      details: { name: point.name },
    });
    res.json({ point });
  }),
);

export default router;
