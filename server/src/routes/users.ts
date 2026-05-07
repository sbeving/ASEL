import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { env } from '../config/env.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/User.js';
import { Franchise } from '../models/Franchise.js';
import { audit } from '../services/audit.service.js';
import { ROLES, isCompatibleManagerRole, isFranchiseScoped, type Role } from '../utils/roles.js';
import { PERMISSIONS, normalizeCustomPermissionOverrides } from '../utils/permissions.js';
import { badRequest, notFound, forbidden } from '../utils/AppError.js';
import { userAvatarUpload, toUploadPath } from '../middleware/upload.js';

const router = Router();

router.use(requireAuth, requirePermission('users.manage'));

const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });
const permissionEnum = z.enum(PERMISSIONS);
const customPermissionsSchema = z.object({
  grants: z.array(permissionEnum).max(300).default([]),
  revokes: z.array(permissionEnum).max(300).default([]),
});

const baseUser = {
  username: z.string().min(3).max(50).trim().toLowerCase(),
  fullName: z.string().min(1).max(100).trim(),
  role: z.enum(ROLES),
  franchiseId: objectId.nullable().optional(),
  managerId: objectId.nullable().optional(),
  active: z.boolean().optional(),
  customPermissions: customPermissionsSchema.optional(),
};

const createSchema = z.object({
  ...baseUser,
  password: z.string().min(8).max(200),
});

const updateSchema = z.object({
  fullName: z.string().min(1).max(100).trim().optional(),
  role: z.enum(ROLES).optional(),
  franchiseId: objectId.nullable().optional(),
  managerId: objectId.nullable().optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
  customPermissions: customPermissionsSchema.optional(),
});

async function ensureFranchiseConsistency(role: string, franchiseId: unknown) {
  if (role === 'commercial') {
    if (franchiseId) {
      const exists = await Franchise.exists({ _id: franchiseId });
      if (!exists) throw badRequest('franchiseId does not exist');
    }
    return;
  }

  const isScoped = isFranchiseScoped(role as any);
  if (isScoped) {
    if (!franchiseId) throw badRequest('franchiseId is required for this role');
    const exists = await Franchise.exists({ _id: franchiseId });
    if (!exists) throw badRequest('franchiseId does not exist');
  }
  if (!isScoped && franchiseId) {
    throw badRequest('franchiseId must be null for non-scoped roles');
  }
}

async function ensureManagerConsistency(
  role: Role,
  franchiseId: string | null | undefined,
  managerId: string | null | undefined,
  userId?: string,
) {
  if (!managerId) return;
  if (userId && managerId === userId) throw badRequest('A user cannot manage themselves');
  const manager = await User.findOne({ _id: managerId, active: true }).select('role franchiseId managerId').lean();
  if (!manager) throw badRequest('managerId does not exist or is inactive');
  if (!isCompatibleManagerRole(role, manager.role as Role)) {
    throw badRequest(`A ${role} user cannot be managed by a ${manager.role} user`);
  }
  const managerFranchiseId = manager.franchiseId?.toString();
  if (['seller', 'vendeur', 'viewer'].includes(role) && franchiseId && managerFranchiseId !== franchiseId) {
    throw badRequest('Seller/viewer manager must belong to the same franchise');
  }

  let nextManagerId = manager.managerId?.toString();
  const seen = new Set<string>([managerId]);
  while (userId && nextManagerId) {
    if (nextManagerId === userId) throw badRequest('Manager hierarchy cannot contain cycles');
    if (seen.has(nextManagerId)) throw badRequest('Manager hierarchy cannot contain cycles');
    seen.add(nextManagerId);
    const next = await User.findById(nextManagerId).select('managerId').lean();
    nextManagerId = next?.managerId?.toString();
  }
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await User.find().sort({ createdAt: -1 }).populate('managerId', 'fullName username role');
    res.json({ users });
  }),
);

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;
    if (input.role === 'superadmin' && req.user!.role !== 'superadmin') { throw forbidden('Only superadmins can create superadmin accounts'); }
    await ensureFranchiseConsistency(input.role, input.franchiseId);
    await ensureManagerConsistency(input.role, input.franchiseId ?? null, input.managerId);

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
    const user = await User.create({
      username: input.username,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
      franchiseId: input.franchiseId ?? null,
      managerId: input.managerId ?? null,
      active: input.active ?? true,
      customPermissions: normalizeCustomPermissionOverrides(input.customPermissions),
    });
    await audit(req, { action: 'user.create', entity: 'User', entityId: user._id.toString() });
    res.status(201).json({ user });
  }),
);

router.patch(
  '/:id',
  validate(z.object({ id: objectId }), 'params'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof updateSchema>;

    const user = await User.findById(id);
    if (!user) throw notFound('User not found');
    if (user.role === 'superadmin' && req.user!.role !== 'superadmin') throw forbidden('You cannot modify a superadmin');
    if (input.role === 'superadmin' && req.user!.role !== 'superadmin') throw forbidden('Only superadmins can assign superadmin role');

    if (input.role || 'franchiseId' in input) {
      const nextRole = input.role ?? user.role;
      const nextFid = 'franchiseId' in input ? input.franchiseId : user.franchiseId?.toString();
      await ensureFranchiseConsistency(nextRole, nextFid);
      user.role = nextRole as typeof user.role;
      if ('franchiseId' in input) user.franchiseId = (input.franchiseId as any) ?? null;
    }
    if ('managerId' in input) {
      await ensureManagerConsistency(user.role as Role, user.franchiseId?.toString() ?? null, input.managerId, id);
      user.managerId = (input.managerId as any) ?? null;
    } else if (input.role || 'franchiseId' in input) {
      await ensureManagerConsistency(
        user.role as Role,
        user.franchiseId?.toString() ?? null,
        user.managerId?.toString(),
        id,
      );
    }
    if (input.fullName !== undefined) user.fullName = input.fullName;
    if (input.active !== undefined) user.active = input.active;
    if (input.customPermissions !== undefined) {
      user.customPermissions = normalizeCustomPermissionOverrides(input.customPermissions);
    }
    if (input.password) {
      user.passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
      user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    }

    // Prevent admins from locking themselves out
    if (req.user!.sub === id && (input.active === false || (input.role && input.role !== 'admin'))) {
      throw badRequest('You cannot remove your own admin access');
    }

    await user.save();
    await audit(req, { action: 'user.update', entity: 'User', entityId: id, details: Object.keys(input) });
    res.json({ user });
  }),
);

router.delete(
  '/:id',
  validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    if (req.user!.sub === id) throw badRequest('You cannot deactivate yourself');
    const userToDeactivate = await User.findById(id);
    if (!userToDeactivate) throw notFound('User not found');
    if (userToDeactivate.role === 'superadmin' && req.user!.role !== 'superadmin') throw forbidden('You cannot deactivate a superadmin');
    const user = await User.findByIdAndUpdate(id, { active: false }, { new: true });
    await audit(req, { action: 'user.deactivate', entity: 'User', entityId: id });
    res.json({ user });
  }),
);

router.post(
  '/:id/avatar',
  validate(z.object({ id: objectId }), 'params'),
  userAvatarUpload.single('avatar'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('avatar file is required');
    const { id } = req.params as { id: string };
    const user = await User.findById(id);
    if (!user) throw notFound('User not found');

    user.avatarPath = toUploadPath('user-avatars', req.file.filename);
    await user.save();

    await audit(req, {
      action: 'user.avatar.upload',
      entity: 'User',
      entityId: user._id.toString(),
    });

    res.json({ user });
  }),
);

export default router;
