export const ROLES = ['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that are not bound to a specific franchise (see all data). */
export const GLOBAL_ROLES: ReadonlySet<Role> = new Set(['admin', 'superadmin', 'manager']);

/** Roles that must be bound to exactly one franchise. */
export const FRANCHISE_SCOPED_ROLES: ReadonlySet<Role> = new Set([
  'franchise',
  'seller',
  'vendeur',
  'viewer',
]);

export const isGlobalRole = (role: Role) => GLOBAL_ROLES.has(role);
export const isFranchiseScoped = (role: Role) => FRANCHISE_SCOPED_ROLES.has(role);
