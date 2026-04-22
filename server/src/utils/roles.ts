export const ROLES = ['admin', 'manager', 'franchise', 'seller'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that are not bound to a specific franchise (see all data). */
export const GLOBAL_ROLES: ReadonlySet<Role> = new Set(['admin', 'manager']);

/** Roles that must be bound to exactly one franchise. */
export const FRANCHISE_SCOPED_ROLES: ReadonlySet<Role> = new Set([
  'franchise',
  'seller',
]);

export const isGlobalRole = (role: Role) => GLOBAL_ROLES.has(role);
export const isFranchiseScoped = (role: Role) => FRANCHISE_SCOPED_ROLES.has(role);
