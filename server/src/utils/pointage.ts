import { env } from '../config/env.js';
import { SystemSetting } from '../models/SystemSetting.js';
import type { Role } from './roles.js';

export const WORKER_ROLES: readonly Role[] = [
  'franchise',
  'seller',
  'vendeur',
  'commercial',
  'commercial_director',
  'stock_central_maintainer',
  'cash_central_maintainer',
  'hr_admin',
  'siege_employee',
];

export const SIEGE_POINTAGE_ROLES: readonly Role[] = [
  'commercial_director',
  'stock_central_maintainer',
  'cash_central_maintainer',
  'hr_admin',
  'siege_employee',
];

export function isSiegePointageRole(role?: Role | string | null): role is Role {
  return SIEGE_POINTAGE_ROLES.includes(role as Role);
}

export interface SiegePointageZone {
  _id: 'siege';
  name: string;
  gps: {
    lat: number;
    lng: number;
  };
  radiusMeters: number;
}

export const SIEGE_ZONE_SETTING_KEY = 'pointage.siege_zone';

export function defaultSiegePointageZone(): SiegePointageZone {
  return {
    _id: 'siege',
    name: env.SIEGE_NAME,
    gps: {
      lat: env.SIEGE_LAT,
      lng: env.SIEGE_LNG,
    },
    radiusMeters: env.SIEGE_RADIUS_METERS,
  };
}

function normalizeSiegeZone(value: unknown): SiegePointageZone {
  const fallback = defaultSiegePointageZone();
  if (!value || typeof value !== 'object') return fallback;
  const row = value as {
    name?: unknown;
    gps?: { lat?: unknown; lng?: unknown };
    radiusMeters?: unknown;
  };
  const lat = Number(row.gps?.lat);
  const lng = Number(row.gps?.lng);
  const radiusMeters = Number(row.radiusMeters);
  return {
    _id: 'siege',
    name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : fallback.name,
    gps: {
      lat: Number.isFinite(lat) ? lat : fallback.gps.lat,
      lng: Number.isFinite(lng) ? lng : fallback.gps.lng,
    },
    radiusMeters: Number.isFinite(radiusMeters) ? Math.round(radiusMeters) : fallback.radiusMeters,
  };
}

export async function getSiegePointageZone(): Promise<SiegePointageZone> {
  const setting = await SystemSetting.findOne({ key: SIEGE_ZONE_SETTING_KEY }).lean();
  return normalizeSiegeZone(setting?.value);
}

export async function saveSiegePointageZone(input: {
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  updatedBy?: string;
}) {
  const zone: SiegePointageZone = {
    _id: 'siege',
    name: input.name.trim(),
    gps: { lat: input.lat, lng: input.lng },
    radiusMeters: Math.round(input.radiusMeters),
  };
  await SystemSetting.findOneAndUpdate(
    { key: SIEGE_ZONE_SETTING_KEY },
    { key: SIEGE_ZONE_SETTING_KEY, value: zone, updatedBy: input.updatedBy ?? null },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return zone;
}
