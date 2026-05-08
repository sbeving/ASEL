import mongoose from 'mongoose';
import { CashLedgerEntry } from '../models/CashLedgerEntry.js';
import { nextSequenceValue } from './sequence.service.js';

type CashFlowLike = {
  _id: mongoose.Types.ObjectId | string;
  franchiseId: mongoose.Types.ObjectId | string;
  linkedFlowId?: mongoose.Types.ObjectId | string | null;
  isCentralCashbox?: boolean;
  status: 'pending' | 'approved' | 'rejected';
  type: 'encaissement' | 'decaissement';
  subType?: string | null;
  amount: number;
  reason: string;
  reference?: string | null;
  receiptNumber?: string | null;
  date?: Date | string | null;
};

export function cashLedgerAccountForFlow(flow: Pick<CashFlowLike, 'franchiseId' | 'isCentralCashbox'>) {
  const franchiseId = flow.franchiseId.toString();
  return flow.isCentralCashbox
    ? { accountType: 'central_cashbox' as const, accountKey: 'central' }
    : { accountType: 'franchise_cashbox' as const, accountKey: `franchise:${franchiseId}` };
}

export function signedCashLedgerAmount(type: CashFlowLike['type'], amount: number) {
  const normalizedAmount = Math.max(0, Number(amount) || 0);
  return type === 'encaissement' ? normalizedAmount : -normalizedAmount;
}

export async function voidCashFlowLedger(
  flow: Pick<CashFlowLike, '_id'>,
  actorId?: string,
  reason = 'cashflow changed',
  session?: mongoose.ClientSession,
) {
  await CashLedgerEntry.updateMany(
    { cashFlowId: flow._id, active: true },
    {
      $set: {
        active: false,
        voidedAt: new Date(),
        voidedBy: actorId ? new mongoose.Types.ObjectId(actorId) : null,
        voidReason: reason,
      },
    },
    { session },
  );
}

export async function postCashFlowLedger(flow: CashFlowLike, actorId?: string, session?: mongoose.ClientSession) {
  await voidCashFlowLedger(flow, actorId, 'superseded by latest approved movement', session);
  if (flow.status !== 'approved') return null;

  const account = cashLedgerAccountForFlow(flow);
  const signedAmount = signedCashLedgerAmount(flow.type, flow.amount);
  const revision = await nextSequenceValue(`cashledger:${flow._id.toString()}`, session);
  const [entry] = await CashLedgerEntry.create(
    [
      {
        ...account,
        franchiseId: flow.franchiseId,
        cashFlowId: flow._id,
        linkedFlowId: flow.linkedFlowId ?? null,
        revision,
        direction: signedAmount >= 0 ? 'credit' : 'debit',
        amount: Math.abs(signedAmount),
        signedAmount,
        flowType: flow.type,
        flowSubType: flow.subType ?? 'other',
        reason: flow.reason,
        reference: flow.reference ?? '',
        receiptNumber: flow.receiptNumber ?? null,
        date: flow.date ? new Date(flow.date) : new Date(),
        postedBy: actorId ? new mongoose.Types.ObjectId(actorId) : null,
        postedAt: new Date(),
      },
    ],
    { session },
  );

  return entry ?? null;
}
