import { describe, expect, it } from 'vitest';
import { isPermissionGranted, normalizeCustomPermissionOverrides } from './permissions.js';

describe('permissions', () => {
  it('uses role baseline permissions', () => {
    expect(isPermissionGranted('seller', 'sales.create')).toBe(true);
    expect(isPermissionGranted('seller', 'demands.create')).toBe(true);
    expect(isPermissionGranted('vendeur', 'demands.create')).toBe(true);
    expect(isPermissionGranted('viewer', 'demands.create')).toBe(false);
    expect(isPermissionGranted('seller', 'users.manage')).toBe(false);
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
