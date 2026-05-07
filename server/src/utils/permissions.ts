import type { Role } from './roles.js';

export const PERMISSIONS = [
  'dashboard.view',
  'stock.view',
  'stock.entry',
  'stock.adjust',
  'stock.movements.view',
  'sales.view',
  'sales.create',
  'sales.price.override',
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
  'leave_requests.view.self',
  'leave_requests.view.all',
  'leave_requests.create',
  'leave_requests.manage',
  'hr.view',
  'hr.manage',
  'cashflows.view',
  'cashflows.manage',
  'notifications.view',
  'franchises.view',
  'franchises.manage',
  'map.manage',
  'map.zones.manage',
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
  'sales.price.override',
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
  'leave_requests.view.self',
  'leave_requests.view.all',
  'leave_requests.create',
  'leave_requests.manage',
  'hr.view',
  'cashflows.view',
  'cashflows.manage',
  'notifications.view',
  'franchises.view',
  'map.manage',
  'map.zones.manage',
  'map.view',
  'users.manage',
];

const franchisePermissions: readonly Permission[] = [
  'dashboard.view',
  'stock.view',
  'stock.entry',
  'stock.movements.view',
  'sales.view',
  'sales.create',
  'sales.price.override',
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
  'leave_requests.view.self',
  'leave_requests.view.all',
  'leave_requests.create',
  'leave_requests.manage',
  'hr.view',
  'cashflows.view',
  'cashflows.manage',
  'notifications.view',
  'franchises.view',
  'franchises.manage',
  'map.view',
  'map.manage',
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
  'demands.create',
  'services.view',
  'services.record',
  'returns.view',
  'returns.create',
  'timelogs.view.self',
  'timelogs.create',
  'leave_requests.view.self',
  'leave_requests.create',
  'notifications.view',
  'franchises.view',
];

const commercialPermissions: readonly Permission[] = [
  'dashboard.view',
  'timelogs.view.self',
  'timelogs.create',
  'leave_requests.view.self',
  'leave_requests.create',
  'products.view',
  'franchises.view',
  'map.view',
  'map.manage',
  'notifications.view',
];

const commercialDirectorPermissions: readonly Permission[] = [
  'dashboard.view',
  'timelogs.view.self',
  'timelogs.view.all',
  'timelogs.create',
  'timelogs.export',
  'leave_requests.view.self',
  'leave_requests.view.all',
  'leave_requests.create',
  'leave_requests.manage',
  'hr.view',
  'products.view',
  'franchises.view',
  'map.view',
  'map.manage',
  'map.zones.manage',
  'notifications.view',
];

const stockCentralMaintainerPermissions: readonly Permission[] = [
  'dashboard.view',
  'stock.view',
  'stock.entry',
  'stock.adjust',
  'stock.movements.view',
  'products.view',
  'products.manage',
  'categories.manage',
  'suppliers.manage',
  'transfers.view',
  'transfers.manage',
  'receptions.view',
  'receptions.manage',
  'monthly_inventory.view',
  'monthly_inventory.manage',
  'notifications.view',
  'franchises.view',
];

const cashCentralMaintainerPermissions: readonly Permission[] = [
  'dashboard.view',
  'cashflows.view',
  'cashflows.manage',
  'closings.view',
  'closings.validate',
  'installments.view',
  'installments.manage',
  'notifications.view',
  'franchises.view',
];

const siegeEmployeePermissions: readonly Permission[] = [
  'dashboard.view',
  'timelogs.view.self',
  'timelogs.create',
  'leave_requests.view.self',
  'leave_requests.create',
  'notifications.view',
];

const hrAdminPermissions: readonly Permission[] = [
  'dashboard.view',
  'timelogs.view.self',
  'timelogs.view.all',
  'timelogs.create',
  'timelogs.export',
  'leave_requests.view.self',
  'leave_requests.view.all',
  'leave_requests.create',
  'leave_requests.manage',
  'hr.view',
  'hr.manage',
  'users.manage',
  'franchises.view',
  'notifications.view',
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
  'notifications.view',
  'franchises.view',
];

const ROLE_PERMISSION_MAP: Record<Role, ReadonlySet<Permission> | 'all'> = {
  superadmin: 'all',
  admin: 'all',
  ceo: 'all',
  manager: new Set(managerPermissions),
  commercial_director: new Set(commercialDirectorPermissions),
  stock_central_maintainer: new Set(stockCentralMaintainerPermissions),
  cash_central_maintainer: new Set(cashCentralMaintainerPermissions),
  hr_admin: new Set(hrAdminPermissions),
  franchise: new Set(franchisePermissions),
  seller: new Set(sellerPermissions),
  vendeur: new Set(sellerPermissions),
  commercial: new Set(commercialPermissions),
  siege_employee: new Set(siegeEmployeePermissions),
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
