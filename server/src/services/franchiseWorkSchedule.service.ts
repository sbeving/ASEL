import type { Request } from 'express';
import mongoose, { type Types } from 'mongoose';
import { Franchise } from '../models/Franchise.js';
import { TimeLog } from '../models/TimeLog.js';
import type { UserDoc } from '../models/User.js';

export interface WorkSchedule {
  enabled?: boolean;
  days?: number[];
  startTime?: string;
  endTime?: string;
  timezone?: string;
}

export interface AutoLoginTimeLogResult {
  created: boolean;
  skippedReason?: 'no_franchise' | 'franchise_not_found' | 'schedule_disabled' | 'outside_work_hours' | 'already_logged';
  logId?: string;
  localDate?: string;
  schedule?: Required<WorkSchedule>;
}

const DEFAULT_SCHEDULE: Required<WorkSchedule> = {
  enabled: true,
  days: [1, 2, 3, 4, 5, 6],
  startTime: '09:00',
  endTime: '19:00',
  timezone: 'Africa/Tunis',
};

function normalizeTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

export function normalizeWorkSchedule(value: WorkSchedule | null | undefined): Required<WorkSchedule> {
  const days = Array.isArray(value?.days)
    ? value.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : DEFAULT_SCHEDULE.days;

  return {
    enabled: value?.enabled ?? DEFAULT_SCHEDULE.enabled,
    days: days.length > 0 ? [...new Set(days)] : DEFAULT_SCHEDULE.days,
    startTime: normalizeTime(value?.startTime, DEFAULT_SCHEDULE.startTime),
    endTime: normalizeTime(value?.endTime, DEFAULT_SCHEDULE.endTime),
    timezone: typeof value?.timezone === 'string' && value.timezone.trim()
      ? value.timezone.trim()
      : DEFAULT_SCHEDULE.timezone,
  };
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const year = values.get('year') ?? '1970';
  const month = values.get('month') ?? '01';
  const day = values.get('day') ?? '01';

  return {
    dateKey: `${year}-${month}-${day}`,
    weekday: weekdayMap[values.get('weekday') ?? 'Mon'] ?? 1,
    minutes: Number(values.get('hour') ?? '0') * 60 + Number(values.get('minute') ?? '0'),
  };
}

function timeToMinutes(value: string): number {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function isWithinWorkSchedule(scheduleInput: WorkSchedule | null | undefined, now = new Date()) {
  const schedule = normalizeWorkSchedule(scheduleInput);
  const parts = localParts(now, schedule.timezone);
  if (!schedule.enabled) return { ok: false, reason: 'schedule_disabled' as const, schedule, localDate: parts.dateKey };
  if (!schedule.days.includes(parts.weekday)) return { ok: false, reason: 'outside_work_hours' as const, schedule, localDate: parts.dateKey };

  const start = timeToMinutes(schedule.startTime);
  const end = timeToMinutes(schedule.endTime);
  const inside = end > start
    ? parts.minutes >= start && parts.minutes <= end
    : parts.minutes >= start || parts.minutes <= end;

  return {
    ok: inside,
    reason: inside ? undefined : 'outside_work_hours' as const,
    schedule,
    localDate: parts.dateKey,
  };
}

export async function createFirstLoginTimeLog(
  req: Request,
  user: Pick<UserDoc, '_id' | 'franchiseId'>,
  now = new Date(),
): Promise<AutoLoginTimeLogResult> {
  if (!user.franchiseId) return { created: false, skippedReason: 'no_franchise' };

  const franchise = await Franchise.findById(user.franchiseId).select('name workSchedule');
  if (!franchise) return { created: false, skippedReason: 'franchise_not_found' };

  const scheduleCheck = isWithinWorkSchedule(franchise.workSchedule as WorkSchedule | undefined, now);
  if (!scheduleCheck.ok) {
    return {
      created: false,
      skippedReason: scheduleCheck.reason,
      localDate: scheduleCheck.localDate,
      schedule: scheduleCheck.schedule,
    };
  }

  const since = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const recentEntries = await TimeLog.find({
    userId: user._id,
    franchiseId: user.franchiseId,
    type: 'entree',
    timestamp: mongoose.trusted({ $gte: since }),
  }).select('timestamp');

  const alreadyLogged = recentEntries.some((entry) => {
    const entryDate = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp);
    return localParts(entryDate, scheduleCheck.schedule.timezone).dateKey === scheduleCheck.localDate;
  });

  if (alreadyLogged) {
    return {
      created: false,
      skippedReason: 'already_logged',
      localDate: scheduleCheck.localDate,
      schedule: scheduleCheck.schedule,
    };
  }

  const log = await TimeLog.create({
    userId: user._id as Types.ObjectId,
    franchiseId: user.franchiseId,
    type: 'entree',
    timestamp: now,
    source: 'auto_login',
    localDate: scheduleCheck.localDate,
    note: 'Pointage automatique: premier login du jour pendant les horaires de travail',
    device: req.get('user-agent'),
  });

  return {
    created: true,
    logId: log._id.toString(),
    localDate: scheduleCheck.localDate,
    schedule: scheduleCheck.schedule,
  };
}
