import { describe, expect, it } from 'vitest';
import { computeWorkedMinutes } from './workSession.js';

describe('computeWorkedMinutes', () => {
  it('keeps a shift active when the last pointage is fresh', () => {
    const stats = computeWorkedMinutes(
      [{ type: 'entree', timestamp: new Date('2026-05-08T08:00:00.000Z') }],
      new Date('2026-05-08T09:00:00.000Z'),
    );

    expect(stats.activeShift).toBe(true);
    expect(stats.workedMinutes).toBe(60);
  });

  it('marks a shift stale after three hours without pointage', () => {
    const stats = computeWorkedMinutes(
      [{ type: 'entree', timestamp: new Date('2026-05-08T08:00:00.000Z') }],
      new Date('2026-05-08T11:30:00.000Z'),
    );

    expect(stats.activeShift).toBe(false);
    expect(stats.staleShift).toBe(true);
    expect(stats.workedMinutes).toBe(180);
  });

  it('uses repeated entree as a freshness check without resetting worked time', () => {
    const stats = computeWorkedMinutes(
      [
        { type: 'entree', timestamp: new Date('2026-05-08T08:00:00.000Z') },
        { type: 'entree', timestamp: new Date('2026-05-08T09:45:00.000Z') },
      ],
      new Date('2026-05-08T10:15:00.000Z'),
    );

    expect(stats.activeShift).toBe(true);
    expect(stats.workedMinutes).toBe(135);
  });

  it('uses verif as the recurring three-hour freshness check', () => {
    const stats = computeWorkedMinutes(
      [
        { type: 'entree', timestamp: new Date('2026-05-08T08:00:00.000Z') },
        { type: 'verif', timestamp: new Date('2026-05-08T09:45:00.000Z') },
      ],
      new Date('2026-05-08T10:15:00.000Z'),
    );

    expect(stats.activeShift).toBe(true);
    expect(stats.workedMinutes).toBe(135);
    expect(stats.lastType).toBe('verif');
  });

  it('does not count the unverified gap after the freshness window expires', () => {
    const stats = computeWorkedMinutes(
      [
        { type: 'entree', timestamp: new Date('2026-05-08T08:00:00.000Z') },
        { type: 'verif', timestamp: new Date('2026-05-08T09:00:00.000Z') },
        { type: 'verif', timestamp: new Date('2026-05-08T13:00:00.000Z') },
      ],
      new Date('2026-05-08T13:30:00.000Z'),
    );

    expect(stats.activeShift).toBe(true);
    expect(stats.workedMinutes).toBe(270);
  });
});
