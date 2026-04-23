import type { Role } from './roles.js';

export const PERMISSIONS = [
  'dashboard.view',
  'stock.view',
  'stock.entry',
  'stock.adjust',
  'stock.movements.view',
  'sales.view',
  'sales.create',
  'clients.view',
  'clients.manage',
  'products.view',
  'products.manage',
  'categories.manage',
  'suppliers.manage',
  'transfers.view',
  'transfers.manage',
  'demands.view',
  'demands.create',
  'demands.process',
  'services.view',
  'services.manage',
  'services.record',
  'returns.view',
  'returns.create',
  'receptions.view',
  'receptions.manage',
  'closings.view',
  'closings.submit',
  'closings.validate',
  'installments.view',
  'installments.manage',
  'monthly_inventory.view',
  'monthly_inventory.manage',
  'timelogs.view.self',
  'timelogs.view.all',
  'timelogs.create',
  'timelogs.export',
  'cashflows.view',
  'cashflows.manage',
  'franchises.view',
  'franchises.manage',
  'map.manage',
  'users.manage',
  'audit.view',
  'map.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(PERMISSIONS);

export interface CustomPermissionOverrides {
  grants: Permission[];
  revokes: Permission[];
}

const managerPermissions: readonly Permission[] = [
  'dashboard.view',
  'stock.view',
  'stock.entry',
  'stock.adjust',
  'stock.movements.view',
  'sales.view',
  'sales.create',
  'clients.view',
  'clients.manage',
  'products.view',
  'products.manage',
  'categories.manage',
  'suppliers.manage',
  'transfers.view',
  'transfers.manage',
  'demands.view',
  'demands.create',
  'demands.process',
  'services.view',
  'services.manage',
  'services.record',
  'returns.view',
  'returns.create',
  'receptions.view',
  'receptions.manage',
  'closings.view',
  'closings.submit',
  'closings.validate',
  'installments.view',
  'installments.manage',
  'monthly_inventory.view',
  'monthly_inventory.manage',
  'timelogs.view.self',
  'timelogs.view.all',
  'timelogs.create',
  'timelogs.export',
  'cashflows.view',
  'cashflows.manage',
  'franchises.view',
  'map.manage',
  'map.view',
];

const franchisePermissions: readonly Permission[] = [
  'dashboard.view',
  'stock.view',
  'stock.entry',
  'stock.movements.view',
  'sales.view',
  'sales.create',
  'clients.view',
  'clients.manage',
  'products.view',
  'transfers.view',
  'transfers.manage',
  'demands.view',
  'demands.create',
  'services.view',
  'services.record',
  'returns.view',
  'returns.create',
  'receptions.view',
  'receptions.manage',
  'closings.view',
  'closings.submit',
  'installments.view',
  'installments.manage',
  'monthly_inventory.view',
  'monthly_inventory.manage',
  'timelogs.view.self',
  'timelogs.view.all',
  'timelogs.create',
  'timelogs.export',
  'cashflows.view',
  'cashflows.manage',
  'franchises.view',
];

const sellerPermissions: readonly Permission[] = [
  'dashboard.view',
  'stock.view',
  'stock.movements.view',
  'sales.view',
  'sales.create',
  'clients.view',
  'clients.manage',
  'products.view',
  'demands.view',
  'services.view',
  'services.record',
  'returns.view',
  'returns.create',
  'timelogs.view.self',
  'timelogs.create',
  'franchises.view',
];

const viewerPermissions: readonly Permission[] = [
  'dashboard.view',
  'stock.view',
  'stock.movements.view',
  'sales.view',
  'clients.view',
  'products.view',
  'returns.view',
  'services.view',
  'franchises.view',
];

const ROLE_PERMISSION_MAP: Record<Role, ReadonlySet<Permission> | 'all'> = {
  superadmin: 'all',
  admin: 'all',
  manager: new Set(managerPermissions),
  franchise: new Set(franchisePermissions),
  seller: new Set(sellerPermissions),
  vendeur: new Set(sellerPermissions),
  viewer: new Set(viewerPermissions),
};

export function isKnownPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

export function normalizeCustomPermissionOverrides(input: unknown): CustomPermissionOverrides {
  const src = (input ?? {}) as { grants?: unknown; revokes?: unknown };
  const grants = Array.isArray(src.grants) ? src.grants : [];
  const revokes = Array.isArray(src.revokes) ? src.revokes : [];

  const normalizedGrants = [...new Set(grants.filter((value): value is Permission => typeof value === 'string' && isKnownPermission(value)))];
  const normalizedRevokes = [...new Set(revokes.filter((value): value is Permission => typeof value === 'string' && isKnownPermission(value)))];

  // Revokes always win if both are present.
  const revokeSet = new Set(normalizedRevokes);
  return {
    grants: normalizedGrants.filter((permission) => !revokeSet.has(permission)),
    revokes: normalizedRevokes,
  };
}

export function hasRolePermission(role: Role, permission: Permission): boolean {
  const allowed = ROLE_PERMISSION_MAP[role];
  if (allowed === 'all') return true;
  return allowed.has(permission);
}

export function isPermissionGranted(
  role: Role,
  permission: Permission,
  overrides?: CustomPermissionOverrides,
): boolean {
  if (overrides?.revokes.includes(permission)) return false;
  if (overrides?.grants.includes(permission)) return true;
  return hasRolePermission(role, permission);
}
