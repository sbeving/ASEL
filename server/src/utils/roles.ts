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
