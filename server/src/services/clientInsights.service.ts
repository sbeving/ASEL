import mongoose from 'mongoose';
import { Client } from '../models/Client.js';
import { Sale } from '../models/Sale.js';
import { Installment } from '../models/Installment.js';
import { Franchise } from '../models/Franchise.js';
import { ClientCreditOverrideRequest } from '../models/ClientCreditOverrideRequest.js';

type CreditTier = 'excellent' | 'good' | 'watch' | 'risky';

interface ClientCreditProfile {
  monthlySalary?: number | null;
  additionalIncome?: number | null;
  employmentStatus?: string;
  housingStatus?: string;
  monthlyRent?: number | null;
  maritalStatus?: string;
  childrenCount?: number | null;
  spouseWorks?: boolean | null;
  distanceKmToFranchise?: number | null;
}

interface ClientCreditInputs {
  totalSpent: number;
  saleCount: number;
  lastSaleAt?: Date | string | null;
  balanceDue: number;
  pendingInstallments: number;
  lateInstallments: number;
  paidInstallments: number;
  totalInstallments: number;
}

export interface CreditPolicy {
  enabled: boolean;
  minimumScoreForInstallment: number;
  blockRiskyTier: boolean;
  blockLateInstallments: boolean;
  maxDebtToRecommendedLimitRatio: number;
  maxMonthlyPaymentRatio: number;
}

export const DEFAULT_CREDIT_POLICY: CreditPolicy = {
  enabled: true,
  minimumScoreForInstallment: 50,
  blockRiskyTier: true,
  blockLateInstallments: true,
  maxDebtToRecommendedLimitRatio: 1,
  maxMonthlyPaymentRatio: 1,
};

function toObjectIds(ids: string[]) {
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizePercent(value: unknown, fallback: number, max = 100): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return clamp(numeric, 0, max);
}

export function normalizeCreditPolicy(input?: Partial<CreditPolicy> | null) {
  return {
    enabled: input?.enabled ?? DEFAULT_CREDIT_POLICY.enabled,
    minimumScoreForInstallment: normalizePercent(
      input?.minimumScoreForInstallment,
      DEFAULT_CREDIT_POLICY.minimumScoreForInstallment,
      100,
    ),
    blockRiskyTier:
      input?.blockRiskyTier ?? DEFAULT_CREDIT_POLICY.blockRiskyTier,
    blockLateInstallments:
      input?.blockLateInstallments ??
      DEFAULT_CREDIT_POLICY.blockLateInstallments,
    maxDebtToRecommendedLimitRatio: normalizePercent(
      input?.maxDebtToRecommendedLimitRatio,
      DEFAULT_CREDIT_POLICY.maxDebtToRecommendedLimitRatio,
      5,
    ),
    maxMonthlyPaymentRatio: normalizePercent(
      input?.maxMonthlyPaymentRatio,
      DEFAULT_CREDIT_POLICY.maxMonthlyPaymentRatio,
      5,
    ),
  };
}

export async function resolveCreditPolicy(franchiseId?: string | null) {
  if (!franchiseId) return DEFAULT_CREDIT_POLICY;
  const franchise = await Franchise.findById(franchiseId)
    .select('creditPolicy')
    .lean();
  return normalizeCreditPolicy(
    franchise?.creditPolicy as Partial<CreditPolicy>,
  );
}

function getCreditProfile(client: unknown): ClientCreditProfile {
  const value = (client as { creditProfile?: ClientCreditProfile })
    .creditProfile;
  return value ?? {};
}

function tierFromScore(score: number): { tier: CreditTier; label: string } {
  if (score >= 82) return { tier: 'excellent', label: 'Tres fiable' };
  if (score >= 68) return { tier: 'good', label: 'Fiable' };
  if (score >= 50) return { tier: 'watch', label: 'A surveiller' };
  return { tier: 'risky', label: 'Risque eleve' };
}

export function computeClientCreditScore(
  client: unknown,
  inputs: ClientCreditInputs,
) {
  const profile = getCreditProfile(client);
  const salary = Math.max(0, Number(profile.monthlySalary ?? 0));
  const additionalIncome = Math.max(0, Number(profile.additionalIncome ?? 0));
  const rent =
    profile.housingStatus === 'rent' || profile.housingStatus === 'mortgage'
      ? Math.max(0, Number(profile.monthlyRent ?? 0))
      : 0;
  const childrenCount = Math.max(0, Number(profile.childrenCount ?? 0));
  const declaredIncome = salary + additionalIncome;
  const estimatedFamilyLoad = childrenCount * 180;
  const monthlyCapacity = Math.max(
    0,
    declaredIncome - rent - estimatedFamilyLoad,
  );

  const paidRate =
    inputs.totalInstallments > 0
      ? inputs.paidInstallments / inputs.totalInstallments
      : 0.5;
  const lateRate =
    inputs.totalInstallments > 0
      ? inputs.lateInstallments / inputs.totalInstallments
      : 0;
  const paymentHistoryScore =
    inputs.totalInstallments > 0
      ? clamp(paidRate * 24 + (1 - lateRate) * 16, 0, 40)
      : 22;

  const debtPressure =
    monthlyCapacity > 0
      ? inputs.balanceDue / monthlyCapacity
      : inputs.balanceDue > 0
        ? 2
        : 0;
  const debtScore =
    monthlyCapacity > 0
      ? clamp(22 - debtPressure * 18, 0, 22)
      : inputs.balanceDue > 0
        ? 5
        : 12;

  const purchaseScore =
    clamp((inputs.totalSpent / 2500) * 10, 0, 10) +
    clamp(inputs.saleCount * 1.2, 0, 8);
  const lastSaleTime = inputs.lastSaleAt
    ? new Date(inputs.lastSaleAt).getTime()
    : 0;
  const recencyScore =
    lastSaleTime > 0 && Date.now() - lastSaleTime <= 120 * 24 * 60 * 60 * 1000
      ? 4
      : 0;

  const employmentScore = [
    'salaried',
    'business_owner',
    'self_employed',
    'retired',
  ].includes(profile.employmentStatus ?? '')
    ? 5
    : profile.employmentStatus && profile.employmentStatus !== 'unknown'
      ? 2
      : 0;
  const housingScore =
    profile.housingStatus === 'owner' || profile.housingStatus === 'family'
      ? 4
      : profile.housingStatus === 'rent' || profile.housingStatus === 'mortgage'
        ? 2
        : 0;
  const spouseScore =
    profile.maritalStatus === 'married' && profile.spouseWorks === true ? 2 : 0;
  const distance = Number(profile.distanceKmToFranchise ?? NaN);
  const distanceScore = Number.isFinite(distance)
    ? distance <= 10
      ? 3
      : distance <= 30
        ? 2
        : distance <= 60
          ? 1
          : 0
    : 0;
  const stabilityScore =
    employmentScore + housingScore + spouseScore + distanceScore;

  const completedFields = [
    salary > 0,
    profile.employmentStatus && profile.employmentStatus !== 'unknown',
    profile.housingStatus && profile.housingStatus !== 'unknown',
    profile.maritalStatus && profile.maritalStatus !== 'unknown',
    Number.isFinite(distance),
    profile.spouseWorks !== null && profile.spouseWorks !== undefined,
  ].filter(Boolean).length;
  const completenessScore = clamp(completedFields * 1.5, 0, 9);

  const score = Math.round(
    clamp(
      paymentHistoryScore +
        debtScore +
        purchaseScore +
        recencyScore +
        stabilityScore +
        completenessScore,
      0,
      100,
    ),
  );
  const tier = tierFromScore(score);
  const maxMonthlyPayment = roundMoney(clamp(monthlyCapacity * 0.3, 0, 2500));
  const recommendedCreditLimit = roundMoney(
    clamp(
      monthlyCapacity * 0.8 +
        inputs.totalSpent * 0.08 -
        inputs.balanceDue * 0.6,
      0,
      8000,
    ),
  );
  const reasons: string[] = [];

  if (inputs.lateInstallments > 0)
    reasons.push(`${inputs.lateInstallments} echeance(s) en retard`);
  if (inputs.balanceDue > 0)
    reasons.push(`Solde restant ${roundMoney(inputs.balanceDue)} TND`);
  if (monthlyCapacity > 0)
    reasons.push(`Capacite mensuelle estimee ${maxMonthlyPayment} TND`);
  if (inputs.totalSpent > 0)
    reasons.push(`Historique achats ${roundMoney(inputs.totalSpent)} TND`);
  if (completedFields < 4) reasons.push('Fiche credit a completer');

  return {
    score,
    tier: tier.tier,
    label: tier.label,
    recommendedCreditLimit,
    maxMonthlyPayment,
    factors: {
      paymentHistory: Math.round(paymentHistoryScore),
      debt: Math.round(debtScore),
      relationship: Math.round(purchaseScore + recencyScore),
      stability: Math.round(stabilityScore),
      completeness: Math.round(completenessScore),
    },
    reasons,
  };
}

export interface InstallmentCreditGuardInput {
  creditScore?: {
    score: number;
    tier: CreditTier;
    label: string;
    recommendedCreditLimit: number;
    maxMonthlyPayment: number;
  } | null;
  balanceDue: number;
  lateInstallments: number;
  newCreditAmount: number;
  installmentCount?: number;
  policy?: Partial<CreditPolicy> | null;
}

export interface ClientCreditOverrideCoverageInput {
  status?: string | null;
  approvedCreditLimit?: number | null;
  approvedMonthlyPayment?: number | null;
  expiresAt?: Date | string | null;
}

export function approvedCreditOverrideCovers(
  override: ClientCreditOverrideCoverageInput | null | undefined,
  decision: Pick<
    ReturnType<typeof evaluateInstallmentCreditGuard>,
    'projectedDebt' | 'estimatedMonthlyPayment'
  >,
  now = new Date(),
) {
  const reasons: string[] = [];
  if (!override) reasons.push('Aucune approbation credit trouvee');
  if (override && override.status !== 'approved')
    reasons.push('Approbation credit non validee');
  const expiresAt = override?.expiresAt ? new Date(override.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() < now.getTime())
    reasons.push('Approbation credit expiree');
  const approvedCreditLimit = Math.max(
    0,
    Number(override?.approvedCreditLimit ?? 0),
  );
  if (decision.projectedDebt > approvedCreditLimit) {
    reasons.push(
      `Dette projetee ${decision.projectedDebt} TND au-dessus de l'approbation ${approvedCreditLimit} TND`,
    );
  }
  const approvedMonthlyPayment = Math.max(
    0,
    Number(override?.approvedMonthlyPayment ?? 0),
  );
  if (
    approvedMonthlyPayment > 0 &&
    decision.estimatedMonthlyPayment > approvedMonthlyPayment
  ) {
    reasons.push(
      `Mensualite estimee ${decision.estimatedMonthlyPayment} TND au-dessus de l'approbation ${approvedMonthlyPayment} TND`,
    );
  }
  return {
    allowed: reasons.length === 0,
    reasons,
  };
}

export function evaluateInstallmentCreditGuard(
  input: InstallmentCreditGuardInput,
) {
  const policy = normalizeCreditPolicy(input.policy);
  const score = input.creditScore;
  const currentDebt = Math.max(0, Number(input.balanceDue) || 0);
  const newCreditAmount = Math.max(0, Number(input.newCreditAmount) || 0);
  const projectedDebt = roundMoney(currentDebt + newCreditAmount);
  const recommendedCreditLimit = Math.max(
    0,
    Number(score?.recommendedCreditLimit ?? 0),
  );
  const installmentCount = Math.max(
    1,
    Number(input.installmentCount ?? 1) || 1,
  );
  const estimatedMonthlyPayment = roundMoney(
    newCreditAmount / installmentCount,
  );
  const reasons: string[] = [];

  if (!policy.enabled) {
    return {
      requiresOverride: false,
      reasons,
      projectedDebt,
      recommendedCreditLimit,
      estimatedMonthlyPayment,
      policy,
    };
  }

  if (!score) reasons.push('Score credit client indisponible');
  else if (score.score < policy.minimumScoreForInstallment) {
    reasons.push(
      `Score credit ${score.score}/100 sous le minimum ${policy.minimumScoreForInstallment}/100`,
    );
  }
  if (score?.tier === 'risky' && policy.blockRiskyTier)
    reasons.push(`Score credit risque eleve (${score.score}/100)`);
  if (input.lateInstallments > 0 && policy.blockLateInstallments)
    reasons.push(`${input.lateInstallments} echeance(s) client deja en retard`);
  const allowedDebt = roundMoney(
    recommendedCreditLimit * policy.maxDebtToRecommendedLimitRatio,
  );
  if (projectedDebt > allowedDebt) {
    reasons.push(
      `Dette projetee ${projectedDebt} TND au-dessus du plafond autorise ${allowedDebt} TND`,
    );
  }
  const allowedMonthlyPayment = score?.maxMonthlyPayment
    ? roundMoney(score.maxMonthlyPayment * policy.maxMonthlyPaymentRatio)
    : 0;
  if (
    allowedMonthlyPayment > 0 &&
    estimatedMonthlyPayment > allowedMonthlyPayment
  ) {
    reasons.push(
      `Mensualite estimee ${estimatedMonthlyPayment} TND au-dessus de la capacite autorisee ${allowedMonthlyPayment} TND`,
    );
  }

  return {
    requiresOverride: reasons.length > 0,
    reasons,
    projectedDebt,
    recommendedCreditLimit,
    estimatedMonthlyPayment,
    policy,
  };
}

export type CollectionRiskTier = CreditTier | 'unknown';

export interface CollectionRiskSummaryInput {
  balanceDue: number;
  pendingDue?: number;
  lateDue?: number;
  pendingInstallments?: number;
  lateInstallments?: number;
  riskTier?: CollectionRiskTier | null;
  franchiseId?: string | null;
  franchiseName?: string | null;
}

function emptyRiskBucket() {
  return { clients: 0, balanceDue: 0, pendingDue: 0, lateDue: 0 };
}

export function summarizeCollectionRisk(rows: CollectionRiskSummaryInput[]) {
  const byTier: Record<
    CollectionRiskTier,
    ReturnType<typeof emptyRiskBucket>
  > = {
    excellent: emptyRiskBucket(),
    good: emptyRiskBucket(),
    watch: emptyRiskBucket(),
    risky: emptyRiskBucket(),
    unknown: emptyRiskBucket(),
  };
  const byFranchise = new Map<
    string,
    ReturnType<typeof emptyRiskBucket> & {
      franchiseId: string | null;
      franchiseName: string;
    }
  >();
  const summary = {
    clientsDue: 0,
    dueAmount: 0,
    pendingDue: 0,
    lateDue: 0,
    pendingInstallments: 0,
    lateInstallments: 0,
    riskyClients: 0,
    byTier,
    byFranchise: [] as Array<
      ReturnType<typeof emptyRiskBucket> & {
        franchiseId: string | null;
        franchiseName: string;
      }
    >,
  };

  for (const row of rows) {
    const balanceDue = roundMoney(Math.max(0, Number(row.balanceDue) || 0));
    if (balanceDue <= 0) continue;
    const pendingDue = roundMoney(Math.max(0, Number(row.pendingDue) || 0));
    const lateDue = roundMoney(Math.max(0, Number(row.lateDue) || 0));
    const tier = row.riskTier ?? 'unknown';
    const tierBucket = byTier[tier] ?? byTier.unknown;
    tierBucket.clients += 1;
    tierBucket.balanceDue = roundMoney(tierBucket.balanceDue + balanceDue);
    tierBucket.pendingDue = roundMoney(tierBucket.pendingDue + pendingDue);
    tierBucket.lateDue = roundMoney(tierBucket.lateDue + lateDue);

    const franchiseKey = row.franchiseId ?? 'unknown';
    const franchiseBucket = byFranchise.get(franchiseKey) ?? {
      franchiseId: row.franchiseId ?? null,
      franchiseName: row.franchiseName || 'Sans franchise',
      ...emptyRiskBucket(),
    };
    franchiseBucket.clients += 1;
    franchiseBucket.balanceDue = roundMoney(
      franchiseBucket.balanceDue + balanceDue,
    );
    franchiseBucket.pendingDue = roundMoney(
      franchiseBucket.pendingDue + pendingDue,
    );
    franchiseBucket.lateDue = roundMoney(franchiseBucket.lateDue + lateDue);
    byFranchise.set(franchiseKey, franchiseBucket);

    summary.clientsDue += 1;
    summary.dueAmount = roundMoney(summary.dueAmount + balanceDue);
    summary.pendingDue = roundMoney(summary.pendingDue + pendingDue);
    summary.lateDue = roundMoney(summary.lateDue + lateDue);
    summary.pendingInstallments += Math.max(
      0,
      Number(row.pendingInstallments) || 0,
    );
    summary.lateInstallments += Math.max(0, Number(row.lateInstallments) || 0);
    if (tier === 'risky' || lateDue > 0) summary.riskyClients += 1;
  }

  summary.byFranchise = [...byFranchise.values()].sort(
    (a, b) => b.balanceDue - a.balanceDue,
  );
  return summary;
}

export async function attachClientListMetrics<
  T extends { _id: mongoose.Types.ObjectId | string },
>(clients: T[], franchiseScopeId?: string | null) {
  if (clients.length === 0) return [];

  const clientIds = clients.map((client) => client._id.toString());
  const scopedMatch = franchiseScopeId
    ? { franchiseId: new mongoose.Types.ObjectId(franchiseScopeId) }
    : {};

  const [salesRows, installmentRows] = await Promise.all([
    Sale.aggregate<{
      _id: mongoose.Types.ObjectId;
      totalSpent: number;
      saleCount: number;
      lastSaleAt: Date | null;
    }>([
      {
        $match: {
          ...scopedMatch,
          cancelledAt: null,
          clientId: { $in: toObjectIds(clientIds) },
        },
      },
      {
        $group: {
          _id: '$clientId',
          totalSpent: { $sum: '$total' },
          saleCount: { $sum: 1 },
          lastSaleAt: { $max: '$createdAt' },
        },
      },
    ]),
    Installment.aggregate<{
      _id: mongoose.Types.ObjectId;
      balanceDue: number;
      pendingInstallments: number;
      lateInstallments: number;
      paidInstallments: number;
      totalInstallments: number;
    }>([
      {
        $match: {
          ...scopedMatch,
          clientId: { $in: toObjectIds(clientIds) },
        },
      },
      {
        $lookup: {
          from: 'sales',
          localField: 'saleId',
          foreignField: '_id',
          as: 'sale',
        },
      },
      { $unwind: '$sale' },
      { $match: { 'sale.cancelledAt': null } },
      {
        $group: {
          _id: '$clientId',
          balanceDue: {
            $sum: {
              $cond: [{ $in: ['$status', ['pending', 'late']] }, '$amount', 0],
            },
          },
          pendingInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0],
            },
          },
          lateInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'late'] }, 1, 0],
            },
          },
          paidInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'paid'] }, 1, 0],
            },
          },
          totalInstallments: { $sum: 1 },
        },
      },
    ]),
  ]);

  const salesMap = new Map(salesRows.map((row) => [row._id.toString(), row]));
  const installmentMap = new Map(
    installmentRows.map((row) => [row._id.toString(), row]),
  );

  return clients.map((client) => {
    const sales = salesMap.get(client._id.toString());
    const installments = installmentMap.get(client._id.toString());

    return {
      ...client,
      totalSpent: sales?.totalSpent ?? 0,
      saleCount: sales?.saleCount ?? 0,
      lastSaleAt: sales?.lastSaleAt ?? null,
      balanceDue: installments?.balanceDue ?? 0,
      pendingInstallments: installments?.pendingInstallments ?? 0,
      lateInstallments: installments?.lateInstallments ?? 0,
      paidInstallments: installments?.paidInstallments ?? 0,
      totalInstallments: installments?.totalInstallments ?? 0,
      creditScore: computeClientCreditScore(client, {
        totalSpent: sales?.totalSpent ?? 0,
        saleCount: sales?.saleCount ?? 0,
        lastSaleAt: sales?.lastSaleAt ?? null,
        balanceDue: installments?.balanceDue ?? 0,
        pendingInstallments: installments?.pendingInstallments ?? 0,
        lateInstallments: installments?.lateInstallments ?? 0,
        paidInstallments: installments?.paidInstallments ?? 0,
        totalInstallments: installments?.totalInstallments ?? 0,
      }),
    };
  });
}

export async function getClientOverview(
  clientId: string,
  franchiseScopeId?: string | null,
) {
  const client = await Client.findById(clientId)
    .populate('franchiseId', 'name')
    .lean();
  if (!client) return null;

  if (
    franchiseScopeId &&
    client.franchiseId &&
    client.franchiseId._id.toString() !== franchiseScopeId
  ) {
    return 'forbidden' as const;
  }

  const scopedMatch = franchiseScopeId
    ? { franchiseId: new mongoose.Types.ObjectId(franchiseScopeId) }
    : {};
  const clientObjectId = new mongoose.Types.ObjectId(clientId);

  const [
    salesSummaryRows,
    installmentSummaryRows,
    recentSales,
    recentInstallments,
    recentCreditOverrides,
  ] = await Promise.all([
    Sale.aggregate<{
      _id: null;
      totalSpent: number;
      saleCount: number;
      lastSaleAt: Date | null;
    }>([
      {
        $match: {
          ...scopedMatch,
          cancelledAt: null,
          clientId: clientObjectId,
        },
      },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$total' },
          saleCount: { $sum: 1 },
          lastSaleAt: { $max: '$createdAt' },
        },
      },
    ]),
    Installment.aggregate<{
      _id: null;
      balanceDue: number;
      pendingInstallments: number;
      lateInstallments: number;
      paidInstallments: number;
      totalInstallments: number;
    }>([
      {
        $match: {
          ...scopedMatch,
          clientId: clientObjectId,
        },
      },
      {
        $lookup: {
          from: 'sales',
          localField: 'saleId',
          foreignField: '_id',
          as: 'sale',
        },
      },
      { $unwind: '$sale' },
      { $match: { 'sale.cancelledAt': null } },
      {
        $group: {
          _id: null,
          balanceDue: {
            $sum: {
              $cond: [{ $in: ['$status', ['pending', 'late']] }, '$amount', 0],
            },
          },
          pendingInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0],
            },
          },
          lateInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'late'] }, 1, 0],
            },
          },
          paidInstallments: {
            $sum: {
              $cond: [{ $eq: ['$status', 'paid'] }, 1, 0],
            },
          },
          totalInstallments: { $sum: 1 },
        },
      },
    ]),
    Sale.find({
      ...scopedMatch,
      cancelledAt: null,
      clientId,
    })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate('franchiseId', 'name')
      .populate('userId', 'fullName username')
      .lean(),
    Installment.find({
      ...scopedMatch,
      clientId,
    })
      .sort({ dueDate: 1 })
      .limit(8)
      .populate({
        path: 'saleId',
        match: { cancelledAt: null },
        select: 'invoiceNumber saleType total createdAt',
      })
      .lean(),
    ClientCreditOverrideRequest.find({ clientId })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate('requestedBy', 'fullName username')
      .populate('reviewedBy', 'fullName username')
      .lean(),
  ]);

  const salesSummary = salesSummaryRows[0] ?? {
    totalSpent: 0,
    saleCount: 0,
    lastSaleAt: null,
  };
  const installmentSummary = installmentSummaryRows[0] ?? {
    balanceDue: 0,
    pendingInstallments: 0,
    lateInstallments: 0,
    paidInstallments: 0,
    totalInstallments: 0,
  };
  const creditScore = computeClientCreditScore(client, {
    totalSpent: salesSummary.totalSpent,
    saleCount: salesSummary.saleCount,
    lastSaleAt: salesSummary.lastSaleAt,
    balanceDue: installmentSummary.balanceDue,
    pendingInstallments: installmentSummary.pendingInstallments,
    lateInstallments: installmentSummary.lateInstallments,
    paidInstallments: installmentSummary.paidInstallments,
    totalInstallments: installmentSummary.totalInstallments,
  });

  return {
    client,
    salesSummary,
    installmentSummary,
    creditScore,
    creditScoreHistory: client.creditScoreHistory ?? [],
    recentCreditOverrides,
    recentSales,
    recentInstallments: recentInstallments.filter(
      (installment) => installment.saleId,
    ),
  };
}

export async function recordClientCreditScoreSnapshot(
  clientId: string,
  options: {
    franchiseScopeId?: string | null;
    capturedBy?: string | null;
    source?: 'create' | 'manual_update' | 'sale_guard' | 'system';
  } = {},
) {
  const overview = await getClientOverview(clientId, options.franchiseScopeId);
  if (!overview || overview === 'forbidden') return null;
  const snapshot = {
    capturedAt: new Date(),
    capturedBy: options.capturedBy
      ? new mongoose.Types.ObjectId(options.capturedBy)
      : null,
    source: options.source ?? 'system',
    score: overview.creditScore.score,
    tier: overview.creditScore.tier,
    label: overview.creditScore.label,
    recommendedCreditLimit: overview.creditScore.recommendedCreditLimit,
    maxMonthlyPayment: overview.creditScore.maxMonthlyPayment,
    balanceDue: overview.installmentSummary.balanceDue,
    lateInstallments: overview.installmentSummary.lateInstallments,
    totalSpent: overview.salesSummary.totalSpent,
    reasons: overview.creditScore.reasons.slice(0, 8),
  };
  const client = await Client.findById(clientId).select('creditScoreHistory');
  if (!client) return null;
  const history = Array.isArray(client.creditScoreHistory)
    ? client.creditScoreHistory
    : [];
  const last = history.at(-1) as typeof snapshot | undefined;
  const unchanged =
    last &&
    last.score === snapshot.score &&
    last.tier === snapshot.tier &&
    roundMoney(last.recommendedCreditLimit) ===
      roundMoney(snapshot.recommendedCreditLimit) &&
    roundMoney(last.maxMonthlyPayment) ===
      roundMoney(snapshot.maxMonthlyPayment) &&
    roundMoney(last.balanceDue) === roundMoney(snapshot.balanceDue) &&
    last.lateInstallments === snapshot.lateInstallments &&
    roundMoney(last.totalSpent) === roundMoney(snapshot.totalSpent);

  if (unchanged) return last;
  client.creditScoreHistory = [...history.slice(-23), snapshot] as any;
  await client.save();
  return snapshot;
}
