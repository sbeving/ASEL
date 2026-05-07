import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { requireAuth, requirePermission, franchiseScopeFilter } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { audit } from '../services/audit.service.js';
import { badRequest, forbidden, notFound } from '../utils/AppError.js';
import { isPermissionGranted } from '../utils/permissions.js';
import type { Role } from '../utils/roles.js';

const router = Router();
const objectId = z.string().refine(isValidObjectId, { message: 'Invalid id' });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z.object({
  type: z.enum(['conge_annuel', 'maladie', 'sans_solde', 'exceptionnel', 'autre']).default('conge_annuel'),
  fromDate: dateOnly,
  toDate: dateOnly,
  reason: z.string().trim().max(1000).optional(),
});

const listQuery = z.object({
  scope: z.enum(['self', 'team']).default('self'),
  franchiseId: objectId.optional(),
  userId: objectId.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
});

const globalLeaveReviewRoles = new Set<Role>(['ceo', 'admin', 'superadmin', 'manager', 'hr_admin']);

async function findFirstManager(filter: Record<string, unknown>) {
  const manager = await User.findOne({ ...filter, active: true }).select('_id').lean();
  return manager?._id ?? null;
}

async function resolveLeaveManager(userId: string) {
  const requester = await User.findById(userId).select('role franchiseId managerId').lean();
  if (!requester) return null;
  if (requester.managerId) return requester.managerId;

  if ((requester.role === 'seller' || requester.role === 'vendeur') && requester.franchiseId) {
    return findFirstManager({ role: 'franchise', franchiseId: requester.franchiseId });
  }

  if (requester.role === 'commercial') {
    return findFirstManager({ role: 'commercial_director' });
  }

  if (requester.role === 'siege_employee' || requester.role === 'hr_admin') {
    return (
      (await findFirstManager({ role: 'hr_admin' })) ??
      (await findFirstManager({ role: 'manager' })) ??
      (await findFirstManager({ role: 'ceo' }))
    );
  }

  return (
    (await findFirstManager({ role: 'manager' })) ??
    (await findFirstManager({ role: 'ceo' })) ??
    (await findFirstManager({ role: 'admin' }))
  );
}

router.post(
  '/',
  requireAuth,
  requirePermission('leave_requests.create'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;
    if (input.toDate < input.fromDate) throw badRequest('toDate must be after fromDate');
    const assignedManagerId = await resolveLeaveManager(req.user!.sub);

    const leaveRequest = await LeaveRequest.create({
      userId: req.user!.sub,
      franchiseId: req.user!.franchiseId ?? null,
      assignedManagerId,
      type: input.type,
      fromDate: input.fromDate,
      toDate: input.toDate,
      reason: input.reason ?? '',
    });

    await audit(req, {
      action: 'leave_request.create',
      entity: 'LeaveRequest',
      entityId: leaveRequest._id.toString(),
      franchiseId: req.user!.franchiseId ?? undefined,
      details: { fromDate: leaveRequest.fromDate, toDate: leaveRequest.toDate, type: leaveRequest.type },
    });

    if (assignedManagerId) {
      await Notification.create({
        userId: assignedManagerId,
        franchiseId: req.user!.franchiseId ?? null,
        title: 'Nouvelle demande conge',
        message: `${req.user!.username} demande un conge du ${leaveRequest.fromDate} au ${leaveRequest.toDate}.`,
        type: 'warning',
        link: '/hr',
        dedupeKey: `leave:${leaveRequest._id.toString()}:created`,
        metadata: { leaveRequestId: leaveRequest._id.toString() },
      });
    }

    res.status(201).json({ leaveRequest });
  }),
);

router.get(
  '/',
  requireAuth,
  requirePermission('leave_requests.view.self', 'leave_requests.view.all'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { scope, franchiseId, userId, status, page, pageSize } = req.query as unknown as z.infer<typeof listQuery>;
    const canViewAll = isPermissionGranted(req.user!.role, 'leave_requests.view.all', req.user!.customPermissions);
    if (scope === 'team' && !canViewAll) throw forbidden();

    const canViewSelfOnly = scope === 'self' || !canViewAll;
    const canReviewGlobally = globalLeaveReviewRoles.has(req.user!.role);
    const filter: Record<string, unknown> = canViewSelfOnly
      ? {}
      : canReviewGlobally
        ? franchiseScopeFilter(req.user)
        : { assignedManagerId: req.user!.sub };
    if (franchiseId) {
      if (filter.franchiseId && filter.franchiseId !== franchiseId) throw forbidden();
      filter.franchiseId = franchiseId;
    }
    if (canViewSelfOnly) filter.userId = req.user!.sub;
    else if (userId) filter.userId = userId;
    if (status) filter.status = status;

    const skip = (page - 1) * pageSize;
    const [total, leaveRequests] = await Promise.all([
      LeaveRequest.countDocuments(filter),
      LeaveRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('userId', 'fullName username role')
        .populate('franchiseId', 'name')
        .populate('assignedManagerId', 'fullName username role')
        .populate('reviewedBy', 'fullName username'),
    ]);

    res.json({
      leaveRequests,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  }),
);

const statusSchema = z.object({
  status: z.enum(['approved', 'rejected', 'cancelled']),
  reviewNote: z.string().trim().max(1000).optional(),
});

router.patch(
  '/:id/status',
  requireAuth,
  requirePermission('leave_requests.manage'),
  validate(z.object({ id: objectId }), 'params'),
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof statusSchema>;
    const leaveRequest = await LeaveRequest.findById(id);
    if (!leaveRequest) throw notFound('Leave request not found');

    const canReviewGlobally = globalLeaveReviewRoles.has(req.user!.role);
    const isAssignedReviewer = leaveRequest.assignedManagerId?.toString() === req.user!.sub;
    if (!canReviewGlobally && !isAssignedReviewer) {
      throw forbidden();
    }
    const scopeFilter = franchiseScopeFilter(req.user);
    if (canReviewGlobally && scopeFilter.franchiseId && leaveRequest.franchiseId?.toString() !== scopeFilter.franchiseId) throw forbidden();

    leaveRequest.status = input.status;
    leaveRequest.reviewNote = input.reviewNote ?? '';
    leaveRequest.reviewedAt = new Date();
    leaveRequest.reviewedBy = req.user!.sub as any;
    await leaveRequest.save();

    await audit(req, {
      action: 'leave_request.review',
      entity: 'LeaveRequest',
      entityId: leaveRequest._id.toString(),
      franchiseId: leaveRequest.franchiseId?.toString() ?? undefined,
      details: { status: leaveRequest.status },
    });

    await Notification.create({
      userId: leaveRequest.userId,
      franchiseId: leaveRequest.franchiseId ?? null,
      title: input.status === 'approved' ? 'Conge approuve' : input.status === 'rejected' ? 'Conge refuse' : 'Demande conge annulee',
      message: input.reviewNote || `Votre demande du ${leaveRequest.fromDate} au ${leaveRequest.toDate} est ${input.status}.`,
      type: input.status === 'approved' ? 'success' : input.status === 'rejected' ? 'danger' : 'info',
      link: '/timelogs',
      dedupeKey: `leave:${leaveRequest._id.toString()}:status:${input.status}`,
      metadata: { leaveRequestId: leaveRequest._id.toString(), status: input.status },
    });

    res.json({ leaveRequest });
  }),
);

export default router;
