import { describe, expect, it } from 'vitest';
import { normalizeInstallmentSummary } from './installments.js';

describe('installments route helpers', () => {
  it('normalizes aging totals for the filtered installments dashboard', () => {
    expect(
      normalizeInstallmentSummary({
        totalCount: 7,
        pendingCount: 3,
        pendingAmount: 450,
        lateCount: 2,
        lateAmount: 180,
        paidCount: 2,
        paidAmount: 320,
        receiptCount: 2,
      }),
    ).toEqual({
      totalCount: 7,
      pendingCount: 3,
      pendingAmount: 450,
      lateCount: 2,
      lateAmount: 180,
      dueAmount: 630,
      paidCount: 2,
      paidAmount: 320,
      receiptCount: 2,
    });
  });

  it('returns a full zero summary when no installment matches filters', () => {
    expect(normalizeInstallmentSummary()).toEqual({
      totalCount: 0,
      pendingCount: 0,
      pendingAmount: 0,
      lateCount: 0,
      lateAmount: 0,
      dueAmount: 0,
      paidCount: 0,
      paidAmount: 0,
      receiptCount: 0,
    });
  });
});
