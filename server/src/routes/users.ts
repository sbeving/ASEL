import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/User.js';
import { Franchise } from '../models/Franchise.js';
import { audit } from '../services/audit.service.js';
import { ROLES, isFranchiseScoped } from '../utils/roles.js';
import { passwordSchema } from '../utils/passwordPolicy.js';
import { badRequest, notFound } from '../utils/AppError.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });

const baseUser = {
  username: z.string().min(3).max(50).trim().toLowerCase(),
  fullName: z.string().min(1).max(100).trim(),
  role: z.enum(ROLES),
  franchiseId: objectId.nullable().optional(),
  active: z.boolean().optional(),
};

const createSchema = z.object({
  ...baseUser,
  password: passwordSchema,
});

const updateSchema = z.object({
  fullName: z.string().min(1).max(100).trim().optional(),
  role: z.enum(ROLES).optional(),
  franchiseId: objectId.nullable().optional(),
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
});

async function ensureFranchiseConsistency(role: string, franchiseId: unknown) {
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

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ users });
  }),
);

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;
    await ensureFranchiseConsistency(input.role, input.franchiseId);

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
    const user = await User.create({
      username: input.username,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
      franchiseId: input.franchiseId ?? null,
      active: input.active ?? true,
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

    if (input.role || 'franchiseId' in input) {
      const nextRole = input.role ?? user.role;
      const nextFid = 'franchiseId' in input ? input.franchiseId : user.franchiseId?.toString();
      await ensureFranchiseConsistency(nextRole, nextFid);
      user.role = nextRole as typeof user.role;
      if ('franchiseId' in input) user.franchiseId = (input.franchiseId as any) ?? null;
    }
    if (input.fullName !== undefined) user.fullName = input.fullName;
    if (input.active !== undefined) user.active = input.active;
    if (input.password) {
      user.passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
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
    const user = await User.findByIdAndUpdate(id, { active: false }, { new: true });
    if (!user) throw notFound('User not found');
    await audit(req, { action: 'user.deactivate', entity: 'User', entityId: id });
    res.json({ user });
  }),
);

export default router;
