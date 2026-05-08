import { describe, expect, it } from 'vitest';
import { cashLedgerAccountForFlow, signedCashLedgerAmount } from './treasuryLedger.service.js';

describe('treasury ledger service', () => {
  it('uses the central account for caisse centrale movements', () => {
    expect(cashLedgerAccountForFlow({ franchiseId: '64b000000000000000000001', isCentralCashbox: true })).toEqual({
      accountType: 'central_cashbox',
      accountKey: 'central',
    });
  });

  it('uses a franchise account for franchise movements', () => {
    expect(cashLedgerAccountForFlow({ franchiseId: '64b000000000000000000001', isCentralCashbox: false })).toEqual({
      accountType: 'franchise_cashbox',
      accountKey: 'franchise:64b000000000000000000001',
    });
  });

  it('signs encaissements as positive and decaissements as negative', () => {
    expect(signedCashLedgerAmount('encaissement', 120.5)).toBe(120.5);
    expect(signedCashLedgerAmount('decaissement', 120.5)).toBe(-120.5);
  });
});
