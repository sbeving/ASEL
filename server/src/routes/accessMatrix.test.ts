import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Permission } from '../utils/permissions.js';
import { isPermissionGranted } from '../utils/permissions.js';
import { ROLES, type Role } from '../utils/roles.js';

const state = vi.hoisted(() => ({
  role: 'viewer' as Role,
  franchiseId: '64b000000000000000000001',
}));

vi.mock('../middleware/auth.js', async () => {
  const permissions = await vi.importActual<typeof import('../utils/permissions.js')>('../utils/permissions.js');
  const roles = await vi.importActual<typeof import('../utils/roles.js')>('../utils/roles.js');

  return {
    AUTH_COOKIE: 'asel_session',
    signSession: vi.fn(),
    verifySession: vi.fn(),
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
      req.user = {
        sub: '64b000000000000000000099',
        role: state.role,
        franchiseId: roles.isGlobalRole(state.role) ? null : state.franchiseId,
        username: `${state.role}_user`,
        sessionVersion: 0,
      };
      next();
    },
    requirePermission:
      (...required: Permission[]) =>
      (req: Request, res: Response) => {
        const allowed = required.some((permission) =>
          permissions.isPermissionGranted(req.user!.role, permission, req.user!.customPermissions),
        );
        if (!allowed) {
          res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not permitted' } });
          return;
        }
        res.status(204).set('x-access-matrix', required.join('|')).end();
      },
    requireRole:
      (...allowedRoles: Role[]) =>
      (req: Request, res: Response, next: NextFunction) => {
        const role = req.user!.role;
        if (role === 'superadmin' || role === 'ceo' || role === 'admin' || allowedRoles.includes(role)) {
          next();
          return;
        }
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not permitted' } });
      },
    franchiseScopeFilter: (user: Request['user'], field = 'franchiseId') => {
      if (!user) return { _neverMatch: true };
      if (roles.isGlobalRole(user.role)) return {};
      if (!user.franchiseId) return { _neverMatch: true };
      return { [field]: user.franchiseId };
    },
  };
});

type MatrixCase = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permissions: Permission[];
  roleGate?: Role[];
};

const matrix: MatrixCase[] = [
  { method: 'GET', path: '/api/products', permissions: ['products.view'] },
  { method: 'POST', path: '/api/products', permissions: ['products.manage'], roleGate: ['admin', 'manager', 'stock_central_maintainer'] },
  { method: 'GET', path: '/api/stock', permissions: ['stock.view'] },
  { method: 'POST', path: '/api/stock/entry', permissions: ['stock.entry'], roleGate: ['admin', 'manager', 'stock_central_maintainer', 'franchise'] },
  { method: 'POST', path: '/api/stock/adjust', permissions: ['stock.adjust'], roleGate: ['admin', 'manager', 'stock_central_maintainer'] },
  { method: 'GET', path: '/api/stock/movements', permissions: ['stock.movements.view'] },
  { method: 'GET', path: '/api/sales', permissions: ['sales.view'] },
  { method: 'POST', path: '/api/sales', permissions: ['sales.create'], roleGate: ['admin', 'manager', 'franchise', 'seller', 'vendeur'] },
  { method: 'GET', path: '/api/clients', permissions: ['clients.view'] },
  { method: 'POST', path: '/api/clients', permissions: ['clients.manage'], roleGate: ['admin', 'manager', 'franchise', 'seller', 'vendeur'] },
  { method: 'GET', path: '/api/installments', permissions: ['installments.view'] },
  { method: 'POST', path: '/api/installments', permissions: ['installments.manage'], roleGate: ['ceo', 'admin', 'superadmin', 'manager', 'franchise'] },
  { method: 'GET', path: '/api/cashflows', permissions: ['cashflows.view'] },
  { method: 'GET', path: '/api/cashflows/ledger', permissions: ['cashflows.view'] },
  { method: 'POST', path: '/api/cashflows', permissions: ['cashflows.manage'] },
  { method: 'GET', path: '/api/hr/summary', permissions: ['hr.view'] },
  { method: 'POST', path: '/api/timelogs', permissions: ['timelogs.create'] },
  { method: 'GET', path: '/api/timelogs', permissions: ['timelogs.view.self', 'timelogs.view.all'] },
  { method: 'GET', path: '/api/timelogs/workers', permissions: ['timelogs.view.all'] },
  { method: 'POST', path: '/api/leave-requests', permissions: ['leave_requests.create'] },
  { method: 'GET', path: '/api/leave-requests', permissions: ['leave_requests.view.self', 'leave_requests.view.all'] },
  { method: 'PATCH', path: '/api/leave-requests/64b000000000000000000010/status', permissions: ['leave_requests.manage'] },
  { method: 'GET', path: '/api/network-points', permissions: ['map.view'] },
  { method: 'GET', path: '/api/network-points/analytics', permissions: ['map.view'] },
  { method: 'GET', path: '/api/network-points/map', permissions: ['map.view'] },
  { method: 'GET', path: '/api/network-points/zones', permissions: ['map.view', 'timelogs.view.all'] },
  { method: 'POST', path: '/api/network-points/zones', permissions: ['map.zones.manage'], roleGate: ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director'] },
  { method: 'POST', path: '/api/network-points', permissions: ['map.manage'] },
  { method: 'GET', path: '/api/franchises', permissions: ['franchises.view'] },
  { method: 'POST', path: '/api/franchises', permissions: ['franchises.manage'], roleGate: ['admin'] },
  { method: 'GET', path: '/api/receptions', permissions: ['receptions.view'] },
  { method: 'POST', path: '/api/receptions', permissions: ['receptions.manage'], roleGate: ['admin', 'manager', 'stock_central_maintainer', 'franchise'] },
  { method: 'GET', path: '/api/audit', permissions: ['audit.view'] },
  { method: 'GET', path: '/api/users', permissions: ['users.manage'] },
  { method: 'GET', path: '/api/notifications', permissions: ['notifications.view'] },
];

function roleGateAllows(role: Role, roleGate?: Role[]) {
  if (!roleGate) return true;
  return role === 'superadmin' || role === 'ceo' || role === 'admin' || roleGate.includes(role);
}

function expectedAllowed(role: Role, testCase: MatrixCase) {
  return testCase.permissions.some((permission) => isPermissionGranted(role, permission)) &&
    roleGateAllows(role, testCase.roleGate);
}

async function createApp() {
  const [
    products,
    stock,
    sales,
    clients,
    installments,
    cashFlows,
    hr,
    timeLogs,
    leaveRequests,
    networkPoints,
    franchises,
    receptions,
    audit,
    users,
    notifications,
  ] = await Promise.all([
    import('./products.js'),
    import('./stock.js'),
    import('./sales.js'),
    import('./clients.js'),
    import('./installments.js'),
    import('./cashFlows.js'),
    import('./hr.js'),
    import('./timeLogs.js'),
    import('./leaveRequests.js'),
    import('./networkPoints.js'),
    import('./franchises.js'),
    import('./receptions.js'),
    import('./audit.js'),
    import('./users.js'),
    import('./notifications.js'),
  ]);

  const app = express();
  app.use(express.json());
  app.use('/api/products', products.default);
  app.use('/api/stock', stock.default);
  app.use('/api/sales', sales.default);
  app.use('/api/clients', clients.default);
  app.use('/api/installments', installments.default);
  app.use('/api/cashflows', cashFlows.default);
  app.use('/api/hr', hr.default);
  app.use('/api/timelogs', timeLogs.default);
  app.use('/api/leave-requests', leaveRequests.default);
  app.use('/api/network-points', networkPoints.default);
  app.use('/api/franchises', franchises.default);
  app.use('/api/receptions', receptions.default);
  app.use('/api/audit', audit.default);
  app.use('/api/users', users.default);
  app.use('/api/notifications', notifications.default);
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }));
  return app;
}

describe('API role access matrix', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await createApp();
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 90000);

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  for (const testCase of matrix) {
    it(`${testCase.method} ${testCase.path} follows the role matrix`, async () => {
      for (const role of ROLES) {
        state.role = role;
        const response = await fetch(`${baseUrl}${testCase.path}`, {
          method: testCase.method,
          headers: { 'content-type': 'application/json' },
          body: testCase.method === 'GET' ? undefined : '{}',
        });

        if (expectedAllowed(role, testCase)) {
          expect(response.status, `${role} should pass ${testCase.method} ${testCase.path}`).toBe(204);
          expect(response.headers.get('x-access-matrix')).toBe(testCase.permissions.join('|'));
        } else {
          expect(response.status, `${role} should be blocked from ${testCase.method} ${testCase.path}`).toBe(403);
        }
      }
    });
  }
});
