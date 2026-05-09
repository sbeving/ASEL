import { describe, expect, it } from 'vitest';
import {
  approvedCreditOverrideCovers,
  evaluateInstallmentCreditGuard,
  summarizeCollectionRisk,
} from './clientInsights.service.js';

describe('client insights service', () => {
  it('allows healthy installment credit inside the recommended limit', () => {
    expect(
      evaluateInstallmentCreditGuard({
        creditScore: {
          score: 78,
          tier: 'good',
          label: 'Fiable',
          recommendedCreditLimit: 2500,
          maxMonthlyPayment: 400,
        },
        balanceDue: 600,
        lateInstallments: 0,
        newCreditAmount: 900,
        installmentCount: 3,
      }),
    ).toMatchObject({
      requiresOverride: false,
      reasons: [],
      projectedDebt: 1500,
      estimatedMonthlyPayment: 300,
    });
  });

  it('requires override for risky score, late installments, and excess debt', () => {
    const decision = evaluateInstallmentCreditGuard({
      creditScore: {
        score: 42,
        tier: 'risky',
        label: 'Risque eleve',
        recommendedCreditLimit: 500,
        maxMonthlyPayment: 120,
      },
      balanceDue: 450,
      lateInstallments: 2,
      newCreditAmount: 600,
      installmentCount: 2,
    });

    expect(decision.requiresOverride).toBe(true);
    expect(decision.projectedDebt).toBe(1050);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'Score credit risque eleve (42/100)',
        '2 echeance(s) client deja en retard',
        'Score credit 42/100 sous le minimum 50/100',
        'Dette projetee 1050 TND au-dessus du plafond autorise 500 TND',
        'Mensualite estimee 300 TND au-dessus de la capacite autorisee 120 TND',
      ]),
    );
  });

  it('applies franchise credit policy overrides', () => {
    const decision = evaluateInstallmentCreditGuard({
      creditScore: {
        score: 45,
        tier: 'watch',
        label: 'A surveiller',
        recommendedCreditLimit: 500,
        maxMonthlyPayment: 100,
      },
      balanceDue: 450,
      lateInstallments: 1,
      newCreditAmount: 400,
      installmentCount: 2,
      policy: {
        minimumScoreForInstallment: 40,
        blockLateInstallments: false,
        maxDebtToRecommendedLimitRatio: 2,
        maxMonthlyPaymentRatio: 2,
      },
    });

    expect(decision.requiresOverride).toBe(false);
    expect(decision.policy).toMatchObject({
      minimumScoreForInstallment: 40,
      blockLateInstallments: false,
      maxDebtToRecommendedLimitRatio: 2,
      maxMonthlyPaymentRatio: 2,
    });
  });

  it('validates approved credit override coverage', () => {
    expect(
      approvedCreditOverrideCovers(
        {
          status: 'approved',
          approvedCreditLimit: 1200,
          approvedMonthlyPayment: 350,
          expiresAt: '2026-06-01T00:00:00.000Z',
        },
        { projectedDebt: 1000, estimatedMonthlyPayment: 300 },
        new Date('2026-05-09T00:00:00.000Z'),
      ),
    ).toEqual({ allowed: true, reasons: [] });

    expect(
      approvedCreditOverrideCovers(
        {
          status: 'approved',
          approvedCreditLimit: 900,
          approvedMonthlyPayment: 250,
          expiresAt: '2026-05-01T00:00:00.000Z',
        },
        { projectedDebt: 1000, estimatedMonthlyPayment: 300 },
        new Date('2026-05-09T00:00:00.000Z'),
      ),
    ).toMatchObject({ allowed: false });
  });

  it('summarizes collection exposure by credit tier and franchise', () => {
    const summary = summarizeCollectionRisk([
      {
        balanceDue: 700,
        pendingDue: 500,
        lateDue: 200,
        pendingInstallments: 2,
        lateInstallments: 1,
        riskTier: 'risky',
        franchiseId: 'f1',
        franchiseName: 'Centre',
      },
      {
        balanceDue: 300,
        pendingDue: 300,
        lateDue: 0,
        pendingInstallments: 1,
        riskTier: 'good',
        franchiseId: 'f1',
        franchiseName: 'Centre',
      },
      {
        balanceDue: 0,
        riskTier: 'excellent',
        franchiseId: 'f2',
        franchiseName: 'Nord',
      },
    ]);

    expect(summary).toMatchObject({
      clientsDue: 2,
      dueAmount: 1000,
      pendingDue: 800,
      lateDue: 200,
      pendingInstallments: 3,
      lateInstallments: 1,
      riskyClients: 1,
      byTier: {
        risky: { clients: 1, balanceDue: 700, pendingDue: 500, lateDue: 200 },
        good: { clients: 1, balanceDue: 300, pendingDue: 300, lateDue: 0 },
      },
      byFranchise: [
        {
          franchiseId: 'f1',
          franchiseName: 'Centre',
          clients: 2,
          balanceDue: 1000,
          pendingDue: 800,
          lateDue: 200,
        },
      ],
    });
  });
});
