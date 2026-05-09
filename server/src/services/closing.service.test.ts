import { describe, expect, it } from 'vitest';
import {
  canOverrideValidatedClosing,
  closingExpectedDrawerAmount,
  closingInstallmentAdvanceAmount,
  closingRequiresVarianceReason,
  closingVarianceAmount,
  normalizeClosingCashDenominations,
} from './closing.service.js';

describe('closing service', () => {
  it('uses the original upfront amount for installment sale advances', () => {
    const sale = {
      paymentMethod: 'installment',
      amountReceived: 500,
      total: 900,
      installmentPlan: {
        upfrontAmount: 120,
      },
    };

    expect(closingInstallmentAdvanceAmount(sale)).toBe(120);
  });

  it('falls back safely for old installment sales without stored plan metadata', () => {
    const sale = {
      paymentMethod: 'installment',
      amountReceived: 75,
      total: 400,
    };

    expect(closingInstallmentAdvanceAmount(sale)).toBe(75);
  });

  it('does not count non-installment sales as advances', () => {
    expect(
      closingInstallmentAdvanceAmount({
        paymentMethod: 'cash',
        amountReceived: 200,
        total: 200,
      }),
    ).toBe(0);
  });

  it('computes the expected cash drawer from cash activity and refunds', () => {
    expect(
      closingExpectedDrawerAmount({
        systemCashTotal: 700,
        treasuryCashInTotal: 150,
        treasuryCashOutTotal: 80,
        returnRefundTotal: 40,
      }),
    ).toBe(730);
  });

  it('does not let cash drawer expectation go below zero', () => {
    expect(
      closingExpectedDrawerAmount({
        systemCashTotal: 25,
        treasuryCashOutTotal: 100,
        returnRefundTotal: 50,
      }),
    ).toBe(0);
  });

  it('normalizes cash denomination lines and totals only counted quantities', () => {
    expect(
      normalizeClosingCashDenominations([
        { label: '50 TND', value: 50, quantity: 2 },
        { label: '20 TND', value: 20, quantity: 0 },
        { label: '500 mill', value: 0.5, quantity: 3.8 },
        { label: '', value: -10, quantity: 4 },
      ]),
    ).toEqual({
      lines: [
        { label: '50 TND', value: 50, quantity: 2, total: 100 },
        { label: '500 mill', value: 0.5, quantity: 3, total: 1.5 },
      ],
      total: 101.5,
    });
  });

  it('requires a variance reason from the configured threshold', () => {
    expect(closingVarianceAmount(104.99, 100)).toBe(4.99);
    expect(closingRequiresVarianceReason(104.99, 100)).toBe(false);
    expect(closingRequiresVarianceReason(105, 100)).toBe(true);
    expect(closingRequiresVarianceReason(95, 100)).toBe(true);
  });

  it('limits validated closing overrides to top-level roles', () => {
    expect(canOverrideValidatedClosing('superadmin')).toBe(true);
    expect(canOverrideValidatedClosing('ceo')).toBe(true);
    expect(canOverrideValidatedClosing('admin')).toBe(true);
    expect(canOverrideValidatedClosing('manager')).toBe(false);
    expect(canOverrideValidatedClosing('franchise')).toBe(false);
  });
});
