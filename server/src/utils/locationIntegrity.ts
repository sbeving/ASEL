import { z } from 'zod';
import { badRequest } from './AppError.js';

export const deviceIntegritySchema = z
  .object({
    platform: z.string().trim().max(40).optional().nullable(),
    appId: z.string().trim().max(160).optional().nullable(),
    appVersion: z.string().trim().max(80).optional().nullable(),
    buildVersion: z.string().trim().max(80).optional().nullable(),
    deviceName: z.string().trim().max(160).optional().nullable(),
    brand: z.string().trim().max(80).optional().nullable(),
    modelName: z.string().trim().max(120).optional().nullable(),
    osName: z.string().trim().max(80).optional().nullable(),
    osVersion: z.string().trim().max(80).optional().nullable(),
    isDevice: z.boolean().optional().nullable(),
    networkType: z.string().trim().max(80).optional().nullable(),
    isInternetReachable: z.boolean().optional().nullable(),
    suspicious: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    blocked: z.boolean().default(false),
  })
  .optional();

export type DeviceIntegrityInput = z.infer<typeof deviceIntegritySchema>;

export interface GpsIntegrityInput {
  accuracy?: number | null;
  mocked?: boolean | null;
  speed?: number | null;
}

const blockingReasons = new Set([
  'mocked_location',
  'android_emulator',
  'low_accuracy',
  'unrealistic_speed',
  'vpn_or_proxy_network',
  'blocked_integrity',
]);

function uniq(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function reasonsFromGps(gps?: GpsIntegrityInput | null) {
  const reasons: string[] = [];
  if (!gps) return reasons;
  if (gps.mocked === true) reasons.push('mocked_location');
  if (typeof gps.accuracy === 'number' && gps.accuracy > 300) reasons.push('low_accuracy');
  if (typeof gps.speed === 'number' && gps.speed > 55) reasons.push('unrealistic_speed');
  return reasons;
}

export function assessLocationIntegrity(gps?: GpsIntegrityInput | null, integrity?: DeviceIntegrityInput) {
  const clientReasons = uniq(integrity?.suspicious ?? []);
  const suspicious = uniq([...clientReasons, ...reasonsFromGps(gps)]);
  if (integrity?.blocked === true && suspicious.length === 0) suspicious.push('blocked_integrity');
  const rejectedReasons = suspicious.filter((reason) => blockingReasons.has(reason));
  const blocked = integrity?.blocked === true || rejectedReasons.length > 0;

  return {
    rejectedReasons: blocked && rejectedReasons.length === 0 ? ['blocked_integrity'] : rejectedReasons,
    integrity: integrity
      ? {
          platform: integrity.platform ?? null,
          appId: integrity.appId ?? null,
          appVersion: integrity.appVersion ?? null,
          buildVersion: integrity.buildVersion ?? null,
          deviceName: integrity.deviceName ?? null,
          brand: integrity.brand ?? null,
          modelName: integrity.modelName ?? null,
          osName: integrity.osName ?? null,
          osVersion: integrity.osVersion ?? null,
          isDevice: integrity.isDevice ?? null,
          networkType: integrity.networkType ?? null,
          isInternetReachable: integrity.isInternetReachable ?? null,
          suspicious,
          blocked,
        }
      : undefined,
  };
}

export function assertLocationIntegrity(gps?: GpsIntegrityInput | null, integrity?: DeviceIntegrityInput) {
  const assessment = assessLocationIntegrity(gps, integrity);
  if (assessment.rejectedReasons.length > 0) {
    throw badRequest('GPS rejected by integrity checks', { reasons: assessment.rejectedReasons });
  }
  return assessment;
}
