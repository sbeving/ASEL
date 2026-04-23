import { describe, expect, it } from 'vitest';
import { buildInstallmentSchedule } from './installments.js';

describe('buildInstallmentSchedule', () => {
  it('splits an exact amount evenly', () => {
    const schedule = buildInstallmentSchedule({
      totalAmount: 120,
      installmentCount: 3,
      startDate: new Date('2026-04-23T00:00:00.000Z'),
      intervalDays: 30,
    });

    expect(schedule.map((item) => item.amount)).toEqual([40, 40, 40]);
  });

  it('pushes the rounding remainder to the last installment', () => {
    const schedule = buildInstallmentSchedule({
      totalAmount: 100,
      installmentCount: 3,
      startDate: new Date('2026-04-23T00:00:00.000Z'),
      intervalDays: 15,
    });

    expect(schedule.map((item) => item.amount)).toEqual([33.33, 33.33, 33.34]);
  });

  it('uses the remaining balance after upfront payment', () => {
    const schedule = buildInstallmentSchedule({
      totalAmount: 250,
      upfrontAmount: 50,
      installmentCount: 4,
      startDate: new Date('2026-04-23T00:00:00.000Z'),
      intervalDays: 7,
    });

    expect(schedule.map((item) => item.amount)).toEqual([50, 50, 50, 50]);
    expect(schedule[1]?.dueDate.toISOString()).toContain('2026-04-30');
  });
});
