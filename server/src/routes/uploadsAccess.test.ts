import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middleware/error.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';
import type { Role } from '../utils/roles.js';

const state = vi.hoisted(() => ({
  role: 'viewer' as Role,
  userId: '64b000000000000000000001',
  franchiseId: '64b000000000000000000010',
}));

vi.mock('../middleware/auth.js', async () => {
  const permissions = await vi.importActual<typeof import('../utils/permissions.js')>('../utils/permissions.js');
  return {
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
      req.user = {
        sub: state.userId,
        role: state.role,
        franchiseId: state.franchiseId,
        username: `${state.role}_user`,
        sessionVersion: 0,
      };
      next();
    },
    requirePermission: vi.fn(),
    requireRole: vi.fn(),
    franchiseScopeFilter: vi.fn(),
    signSession: vi.fn(),
    verifySession: vi.fn(),
    AUTH_COOKIE: 'asel_session',
    isPermissionGranted: permissions.isPermissionGranted,
  };
});

function mockQuery(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(result),
  };
}

async function createApp() {
  const uploads = await import('./uploads.js');
  const app = express();
  app.use('/api/uploads', uploads.default);
  app.use(errorHandler);
  return app;
}

describe('upload object access', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await createApp();
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    state.role = 'viewer';
    state.userId = '64b000000000000000000001';
    state.franchiseId = '64b000000000000000000010';
  });

  it('blocks product image access when the role cannot view products', async () => {
    state.role = 'siege_employee';
    vi.spyOn(Product, 'findOne').mockReturnValue(mockQuery({ _id: new mongoose.Types.ObjectId(), active: true }) as any);

    const response = await fetch(`${baseUrl}/api/uploads/product-images/photo.jpg`);

    expect(response.status).toBe(403);
    expect(Product.findOne).not.toHaveBeenCalled();
  });

  it('requires product images to belong to a product record', async () => {
    state.role = 'viewer';
    vi.spyOn(Product, 'findOne').mockReturnValue(mockQuery(null) as any);

    const response = await fetch(`${baseUrl}/api/uploads/product-images/missing.jpg`);

    expect(response.status).toBe(404);
    expect(Product.findOne).toHaveBeenCalledWith({ imagePath: 'product-images/missing.jpg' });
  });

  it('allows only the avatar owner or user managers to access user avatars', async () => {
    vi.spyOn(User, 'findOne').mockReturnValue(
      mockQuery({ _id: new mongoose.Types.ObjectId('64b000000000000000000002'), franchiseId: state.franchiseId }) as any,
    );

    state.role = 'viewer';
    let response = await fetch(`${baseUrl}/api/uploads/user-avatars/avatar.jpg`);
    expect(response.status).toBe(403);

    state.userId = '64b000000000000000000002';
    response = await fetch(`${baseUrl}/api/uploads/user-avatars/avatar.jpg`);
    expect(response.status).toBe(404);

    state.userId = '64b000000000000000000001';
    state.role = 'hr_admin';
    response = await fetch(`${baseUrl}/api/uploads/user-avatars/avatar.jpg`);
    expect(response.status).toBe(404);
  });
});
