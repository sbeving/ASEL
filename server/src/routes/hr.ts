import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { TimeLog } from '../models/TimeLog.js';
import { User } from '../models/User.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { WORKER_ROLES } from '../utils/pointage.js';

const router = Router();

type TimeLogType = 'entree' | 'sortie' | 'pause_debut' | 'pause_fin';

interface LeanTimeLog {
  userId: string | { _id?: unknown; toString?: () => string };
  type: TimeLogType;
  timestamp: Date;
}

function weekStart(date = new Date()) {
  const value = new Date(date);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  value.setHours(0, 0, 0, 0);
  return value;
}

function userIdOf(value: LeanTimeLog['userId']) {
  if (typeof value === 'string') return value;
  const id = (value as { _id?: { toString?: () => string } })?._id;
  return id?.toString?.() ?? value?.toString?.() ?? '';
}

function computeWorked(logs: LeanTimeLog[]) {
  const sorted = [...logs].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  let shiftStart: number | null = null;
  let breakStart: number | null = null;
  let pausedMs = 0;
  let totalMs = 0;
  let lastType: TimeLogType | null = null;

  for (const log of sorted) {
    const at = new Date(log.timestamp).getTime();
    if (!Number.isFinite(at)) continue;
    lastType = log.type;

    if (log.type === 'entree') {
      shiftStart = at;
      breakStart = null;
      pausedMs = 0;
      continue;
    }

    if (shiftStart === null) continue;

    if (log.type === 'pause_debut') {
      if (breakStart === null) breakStart = at;
      continue;
    }

    if (log.type === 'pause_fin') {
      if (breakStart !== null) {
        pausedMs += Math.max(0, at - breakStart);
        breakStart = null;
      }
      continue;
    }

    if (log.type === 'sortie') {
      const effectivePausedMs = pausedMs + (breakStart !== null ? Math.max(0, at - breakStart) : 0);
      totalMs += Math.max(0, at - shiftStart - effectivePausedMs);
      shiftStart = null;
      breakStart = null;
      pausedMs = 0;
    }
  }

  const activeShift = shiftStart !== null && Date.now() - shiftStart <= 18 * 60 * 60 * 1000;
  if (activeShift && shiftStart !== null) {
    const effectivePausedMs = pausedMs + (breakStart !== null ? Math.max(0, Date.now() - breakStart) : 0);
    totalMs += Math.max(0, Date.now() - shiftStart - effectivePausedMs);
  }

  return {
    workedMinutes: Math.round(totalMs / 60000),
    activeShift,
    lastType,
  };
}

router.get(
  '/summary',
  requireAuth,
  requirePermission('hr.view'),
  asyncHandler(async (req, res) => {
    const start = weekStart();
    const globalHr = ['ceo', 'admin', 'superadmin', 'manager', 'hr_admin'].includes(req.user!.role);
    const workerFilter: Record<string, unknown> = {
      role: mongoose.trusted({ $in: WORKER_ROLES }),
      active: true,
    };
    const leaveFilter: Record<string, unknown> = { status: 'pending' };
    if (!globalHr) {
      leaveFilter.assignedManagerId = req.user!.sub;
      if (req.user!.role === 'franchise' && req.user!.franchiseId) {
        workerFilter.franchiseId = req.user!.franchiseId;
      } else if (req.user!.role === 'commercial_director') {
        workerFilter.role = 'commercial';
      } else {
        workerFilter.managerId = req.user!.sub;
      }
    }
    const [workers, pendingLeaveRequests] = await Promise.all([
      User.find(workerFilter)
        .sort({ role: 1, fullName: 1 })
        .select('fullName username role franchiseId active')
        .populate('franchiseId', 'name')
        .lean(),
      LeaveRequest.find(leaveFilter)
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('userId', 'fullName username role')
        .populate('franchiseId', 'name')
        .populate('assignedManagerId', 'fullName username role')
        .lean(),
    ]);

    const workerIds = workers.map((worker) => worker._id);
    const logs =
      workerIds.length > 0
        ? await TimeLog.find({
            userId: mongoose.trusted({ $in: workerIds }),
            timestamp: mongoose.trusted({ $gte: start }),
          })
            .sort({ timestamp: 1 })
            .select('userId type timestamp')
            .lean<LeanTimeLog[]>()
        : [];

    const logsByUser = new Map<string, LeanTimeLog[]>();
    for (const log of logs) {
      const id = userIdOf(log.userId);
      if (!id) continue;
      const rows = logsByUser.get(id) ?? [];
      rows.push(log);
      logsByUser.set(id, rows);
    }

    const employees = workers.map((worker) => {
      const stats = computeWorked(logsByUser.get(worker._id.toString()) ?? []);
      return {
        _id: worker._id.toString(),
        fullName: worker.fullName,
        username: worker.username,
        role: worker.role,
        franchise: typeof worker.franchiseId === 'object' && worker.franchiseId ? worker.franchiseId : null,
        workedMinutes: stats.workedMinutes,
        activeShift: stats.activeShift,
        lastType: stats.lastType,
      };
    });

    res.json({
      weekStart: start.toISOString(),
      summary: {
        employeeCount: employees.length,
        atWorkCount: employees.filter((employee) => employee.activeShift).length,
        pendingLeaveCount: pendingLeaveRequests.length,
        workedMinutes: employees.reduce((sum, employee) => sum + employee.workedMinutes, 0),
      },
      employees,
      pendingLeaveRequests,
    });
  }),
);

export default router;
