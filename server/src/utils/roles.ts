export const ROLES = [
  'ceo',
  'admin',
  'superadmin',
  'manager',
  'commercial_director',
  'stock_central_maintainer',
  'cash_central_maintainer',
  'hr_admin',
  'franchise',
  'seller',
  'vendeur',
  'commercial',
  'siege_employee',
  'viewer',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles that are not bound to a specific franchise (see all data). */
export const GLOBAL_ROLES: ReadonlySet<Role> = new Set([
  'ceo',
  'admin',
  'superadmin',
  'manager',
  'commercial_director',
  'stock_central_maintainer',
  'cash_central_maintainer',
  'hr_admin',
]);

/** Roles that must be bound to exactly one franchise. */
export const FRANCHISE_SCOPED_ROLES: ReadonlySet<Role> = new Set([
  'franchise',
  'seller',
  'vendeur',
  'commercial',
  'viewer',
]);

export const isGlobalRole = (role: Role) => GLOBAL_ROLES.has(role);
export const isFranchiseScoped = (role: Role) => FRANCHISE_SCOPED_ROLES.has(role);

const ROLE_MANAGER_COMPATIBILITY: Record<Role, ReadonlySet<Role> | 'none' | 'any-superior'> = {
  superadmin: 'none',
  ceo: new Set(['superadmin']),
  admin: new Set(['superadmin', 'ceo']),
  manager: new Set(['superadmin', 'ceo', 'admin']),
  commercial_director: new Set(['superadmin', 'ceo', 'admin', 'manager']),
  stock_central_maintainer: new Set(['superadmin', 'ceo', 'admin', 'manager']),
  cash_central_maintainer: new Set(['superadmin', 'ceo', 'admin', 'manager']),
  hr_admin: new Set(['superadmin', 'ceo', 'admin', 'manager']),
  franchise: new Set(['superadmin', 'ceo', 'admin', 'manager']),
  seller: new Set(['franchise']),
  vendeur: new Set(['franchise']),
  commercial: new Set(['commercial_director']),
  siege_employee: new Set(['hr_admin', 'manager', 'admin', 'ceo', 'superadmin']),
  viewer: 'any-superior',
};

const SUPERIOR_ROLES: ReadonlySet<Role> = new Set([
  'superadmin',
  'ceo',
  'admin',
  'manager',
  'commercial_director',
  'stock_central_maintainer',
  'cash_central_maintainer',
  'hr_admin',
  'franchise',
]);

export function isCompatibleManagerRole(workerRole: Role, managerRole: Role): boolean {
  const allowed = ROLE_MANAGER_COMPATIBILITY[workerRole];
  if (allowed === 'none') return false;
  if (allowed === 'any-superior') return SUPERIOR_ROLES.has(managerRole);
  return allowed.has(managerRole);
}
