import { describe, expect, it } from 'vitest';
import { isPermissionGranted, normalizeCustomPermissionOverrides, type Permission } from './permissions.js';
import { ROLES, type Role } from './roles.js';

describe('permissions', () => {
  it('uses role baseline permissions', () => {
    expect(isPermissionGranted('seller', 'sales.create')).toBe(true);
    expect(isPermissionGranted('seller', 'demands.create')).toBe(true);
    expect(isPermissionGranted('vendeur', 'demands.create')).toBe(true);
    expect(isPermissionGranted('viewer', 'demands.create')).toBe(false);
    expect(isPermissionGranted('seller', 'users.manage')).toBe(false);
    expect(isPermissionGranted('siege_employee', 'timelogs.create')).toBe(true);
    expect(isPermissionGranted('siege_employee', 'dashboard.view')).toBe(true);
    expect(isPermissionGranted('siege_employee', 'products.view')).toBe(false);
    expect(isPermissionGranted('siege_employee', 'notifications.view')).toBe(true);
    expect(isPermissionGranted('commercial', 'map.manage')).toBe(true);
    expect(isPermissionGranted('commercial', 'dashboard.view')).toBe(true);
    expect(isPermissionGranted('commercial', 'products.view')).toBe(true);
    expect(isPermissionGranted('commercial', 'notifications.view')).toBe(true);
    expect(isPermissionGranted('commercial', 'sales.view')).toBe(false);
    expect(isPermissionGranted('ceo', 'audit.view')).toBe(true);
    expect(isPermissionGranted('commercial_director', 'map.zones.manage')).toBe(true);
    expect(isPermissionGranted('commercial_director', 'notifications.view')).toBe(true);
    expect(isPermissionGranted('hr_admin', 'notifications.view')).toBe(true);
    expect(isPermissionGranted('stock_central_maintainer', 'stock.adjust')).toBe(true);
    expect(isPermissionGranted('cash_central_maintainer', 'cashflows.manage')).toBe(true);
  });

  it('keeps main API endpoint access aligned with the role hierarchy', () => {
    const contracts: Array<{
      endpoint: string;
      permission: Permission;
      allowed: Role[];
    }> = [
      { endpoint: 'GET /api/dashboard', permission: 'dashboard.view', allowed: [...ROLES] },
      { endpoint: 'GET /api/notifications', permission: 'notifications.view', allowed: [...ROLES] },
      {
        endpoint: 'GET /api/hr/summary',
        permission: 'hr.view',
        allowed: ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'hr_admin', 'franchise'],
      },
      {
        endpoint: 'GET /api/network-points',
        permission: 'map.view',
        allowed: ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'franchise', 'commercial'],
      },
      {
        endpoint: 'POST /api/network-points',
        permission: 'map.manage',
        allowed: ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'franchise', 'commercial'],
      },
      {
        endpoint: 'GET /api/timelogs?scope=team',
        permission: 'timelogs.view.all',
        allowed: ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'hr_admin', 'franchise'],
      },
      {
        endpoint: 'POST /api/cashflows',
        permission: 'cashflows.manage',
        allowed: ['ceo', 'admin', 'superadmin', 'manager', 'cash_central_maintainer', 'franchise'],
      },
      {
        endpoint: 'POST /api/stock/adjust',
        permission: 'stock.adjust',
        allowed: ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer'],
      },
      {
        endpoint: 'GET /api/users',
        permission: 'users.manage',
        allowed: ['ceo', 'admin', 'superadmin', 'manager', 'hr_admin'],
      },
    ];

    for (const contract of contracts) {
      for (const role of ROLES) {
        expect(
          isPermissionGranted(role, contract.permission),
          `${contract.endpoint} should ${contract.allowed.includes(role) ? '' : 'not '}allow ${role}`,
        ).toBe(contract.allowed.includes(role));
      }
    }
  });

  it('applies custom grants', () => {
    const overrides = normalizeCustomPermissionOverrides({ grants: ['audit.view'], revokes: [] });
    expect(isPermissionGranted('manager', 'audit.view', overrides)).toBe(true);
  });

  it('revokes override grants and role permissions', () => {
    const overrides = normalizeCustomPermissionOverrides({
      grants: ['sales.create'],
      revokes: ['sales.create'],
    });
    expect(isPermissionGranted('seller', 'sales.create', overrides)).toBe(false);
  });
});
