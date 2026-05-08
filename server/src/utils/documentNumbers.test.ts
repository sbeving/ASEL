import { describe, expect, it } from 'vitest';
import { cashFlowReceiptSequenceKey, formatCashFlowReceiptNumber } from './documentNumbers.js';

describe('document numbers', () => {
  it('formats cashflow receipt numbers by year and padded sequence', () => {
    const date = new Date('2026-05-09T10:00:00.000Z');

    expect(formatCashFlowReceiptNumber(date, 1)).toBe('REC-2026-000001');
    expect(formatCashFlowReceiptNumber(date, 42)).toBe('REC-2026-000042');
    expect(formatCashFlowReceiptNumber(date, 123456)).toBe('REC-2026-123456');
  });

  it('uses a yearly sequence key for cashflow receipts', () => {
    expect(cashFlowReceiptSequenceKey(new Date(2026, 0, 1, 12))).toBe('cashflow-receipt:2026');
    expect(cashFlowReceiptSequenceKey(new Date(2027, 11, 31, 12))).toBe('cashflow-receipt:2027');
  });
});
