export const POINTAGE_FRESHNESS_MINUTES = 180;
export const POINTAGE_FRESHNESS_MS = POINTAGE_FRESHNESS_MINUTES * 60 * 1000;

export type WorkSessionLog = {
  type: string;
  timestamp: Date | string;
};

export function computeWorkedMinutes(logs: WorkSessionLog[], now = new Date()) {
  const sorted = [...logs].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  let shiftOpen = false;
  let paused = false;
  let lastFreshAt: number | null = null;
  let workSegmentStart: number | null = null;
  let totalMs = 0;
  let lastType: string | null = null;
  let lastAt: number | null = null;

  function accrueUntil(until: number) {
    if (!shiftOpen || paused || workSegmentStart === null || lastFreshAt === null) return;
    const expiry = lastFreshAt + POINTAGE_FRESHNESS_MS;
    const end = Math.min(until, expiry);
    if (end > workSegmentStart) totalMs += end - workSegmentStart;
    workSegmentStart = until >= expiry ? null : end;
  }

  function refreshAt(at: number) {
    lastFreshAt = at;
    if (!paused) workSegmentStart = at;
  }

  for (const log of sorted) {
    const at = new Date(log.timestamp).getTime();
    if (!Number.isFinite(at)) continue;
    lastType = log.type;
    lastAt = at;

    if (log.type === 'entree') {
      if (!shiftOpen) {
        shiftOpen = true;
        paused = false;
        refreshAt(at);
      } else {
        accrueUntil(at);
        paused = false;
        refreshAt(at);
      }
      continue;
    }

    if (!shiftOpen) continue;

    if (log.type === 'verif') {
      accrueUntil(at);
      refreshAt(at);
      continue;
    }

    if (log.type === 'pause_debut') {
      accrueUntil(at);
      paused = true;
      workSegmentStart = null;
      continue;
    }

    if (log.type === 'pause_fin') {
      paused = false;
      refreshAt(at);
      continue;
    }

    if (log.type === 'sortie') {
      accrueUntil(at);
      shiftOpen = false;
      paused = false;
      lastFreshAt = null;
      workSegmentStart = null;
    }
  }

  const nowMs = now.getTime();
  const fresh = lastFreshAt !== null && nowMs - lastFreshAt <= POINTAGE_FRESHNESS_MS;
  const activeShift = shiftOpen && !paused && fresh;
  accrueUntil(nowMs);

  return {
    workedMinutes: Math.round(totalMs / 60000),
    activeShift,
    staleShift: shiftOpen && !paused && !activeShift,
    lastType,
    lastTimestamp: lastAt === null ? null : new Date(lastAt),
    freshnessMinutes: POINTAGE_FRESHNESS_MINUTES,
  };
}
