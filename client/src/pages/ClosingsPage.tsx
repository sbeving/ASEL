import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { dateOnly, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import type { Closing, Franchise } from '../lib/types';

const CASH_DENOMINATIONS = [
  { label: '50 TND', value: 50 },
  { label: '20 TND', value: 20 },
  { label: '10 TND', value: 10 },
  { label: '5 TND', value: 5 },
  { label: '2 TND', value: 2 },
  { label: '1 TND', value: 1 },
  { label: '500 mill', value: 0.5 },
  { label: '200 mill', value: 0.2 },
  { label: '100 mill', value: 0.1 },
  { label: '50 mill', value: 0.05 },
] as const;

function denominationKey(value: number) {
  return String(value);
}

function emptyDenominations() {
  return Object.fromEntries(
    CASH_DENOMINATIONS.map((item) => [denominationKey(item.value), 0]),
  ) as Record<string, number>;
}

export function ClosingsPage() {
  const { user } = useAuth();
  const isGlobal =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'cash_central_maintainer';
  const canValidate = isGlobal;

  const qc = useQueryClient();
  const [franchiseId, setFranchiseId] = useState(
    isGlobal ? '' : (user?.franchiseId ?? ''),
  );
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [declaredSalesTotal, setDeclaredSalesTotal] = useState(0);
  const [declaredItemsTotal, setDeclaredItemsTotal] = useState(0);
  const [denominationQty, setDenominationQty] = useState<
    Record<string, number>
  >(() => emptyDenominations());
  const [varianceReason, setVarianceReason] = useState('');
  const [comment, setComment] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const effectiveFranchiseId = franchiseId || user?.franchiseId || '';

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () =>
      (await api.get<{ franchises: Franchise[] }>('/franchises')).data
        .franchises,
  });

  const closings = useQuery({
    queryKey: ['closings', franchiseId],
    queryFn: async () =>
      (
        await api.get<{ closings: Closing[] }>('/closings', {
          params: {
            franchiseId: franchiseId || undefined,
          },
        })
      ).data.closings,
  });

  const summary = useQuery({
    enabled: !!effectiveFranchiseId,
    queryKey: ['closing-summary', effectiveFranchiseId, date],
    queryFn: async () =>
      (
        await api.get<{
          summary: {
            saleCount: number;
            systemSalesTotal: number;
            systemItemsTotal: number;
            systemCashTotal: number;
            cashSalesTotal: number;
            cardSalesTotal: number;
            transferSalesTotal: number;
            otherSalesTotal: number;
            installmentAdvancesTotal: number;
            cashInstallmentsTotal: number;
            installmentCashCount: number;
            installmentDueTotal: number;
            installmentDueCount: number;
            installmentPaidTotal: number;
            installmentPaidCount: number;
            treasuryCashInTotal: number;
            treasuryCashOutTotal: number;
            expenseCashOutTotal: number;
            centralCashOutTotal: number;
            returnRefundTotal: number;
            returnRefundCount: number;
            expectedDrawerTotal: number;
            paymentBreakdown: Record<string, { count: number; total: number }>;
          };
        }>('/closings/summary', {
          params: {
            franchiseId: effectiveFranchiseId,
            date,
          },
        })
      ).data.summary,
  });

  useEffect(() => {
    if (!summary.data || editingId) return;
    setDeclaredSalesTotal(summary.data.expectedDrawerTotal);
    setDeclaredItemsTotal(summary.data.systemItemsTotal);
  }, [editingId, summary.data]);

  const cashDenominationLines = useMemo(
    () =>
      CASH_DENOMINATIONS.map((item) => {
        const quantity = Math.max(
          0,
          Math.floor(denominationQty[denominationKey(item.value)] ?? 0),
        );
        return {
          label: item.label,
          value: item.value,
          quantity,
          total: Math.round(item.value * quantity * 100) / 100,
        };
      }).filter((item) => item.quantity > 0),
    [denominationQty],
  );
  const cashDenominationTotal = useMemo(
    () =>
      Math.round(
        cashDenominationLines.reduce((sum, item) => sum + item.total, 0) * 100,
      ) / 100,
    [cashDenominationLines],
  );
  const expectedDrawerTotal = summary.data?.expectedDrawerTotal ?? 0;
  const cashVariance =
    Math.round((declaredSalesTotal - expectedDrawerTotal) * 100) / 100;
  const varianceRequiresReason = Math.abs(cashVariance) >= 5;

  function updateDenomination(value: number, quantity: number) {
    const key = denominationKey(value);
    const next = {
      ...denominationQty,
      [key]: Math.max(0, Math.floor(quantity || 0)),
    };
    setDenominationQty(next);
    const nextTotal = CASH_DENOMINATIONS.reduce((sum, item) => {
      const itemQuantity = Math.max(
        0,
        Math.floor(next[denominationKey(item.value)] ?? 0),
      );
      return sum + item.value * itemQuantity;
    }, 0);
    setDeclaredSalesTotal(
      Math.round((nextTotal > 0 ? nextTotal : expectedDrawerTotal) * 100) / 100,
    );
  }

  const submit = useMutation({
    mutationFn: async () => {
      const payloadFranchiseId = franchiseId || user?.franchiseId;
      if (!payloadFranchiseId) throw new Error('Franchise requise');
      const payload = {
        franchiseId: payloadFranchiseId,
        date,
        declaredSalesTotal,
        declaredItemsTotal,
        cashDenominations: cashDenominationLines,
        varianceReason: varianceReason || undefined,
        comment: comment || undefined,
      };
      if (editingId) await api.patch(`/closings/${editingId}`, payload);
      else await api.post('/closings', payload);
    },
    onSuccess: () => {
      setErr(null);
      setComment('');
      setVarianceReason('');
      setDenominationQty(emptyDenominations());
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['closings'] });
    },
    onError: (e) => setErr(apiError(e).message),
  });

  const validateClosing = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/closings/${id}/validate`);
    },
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['closings'] });
    },
    onError: (e) => setErr(apiError(e).message),
  });

  const deleteClosing = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/closings/${id}`);
    },
    onSuccess: () => {
      setErr(null);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['closings'] });
    },
    onError: (e) => setErr(apiError(e).message),
  });

  return (
    <>
      <PageHeader
        title="Clôtures"
        subtitle="Déclaration et validation fin de journée"
      />

      <section className="card p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {isGlobal ? (
            <select
              className="input"
              value={franchiseId}
              onChange={(e) => setFranchiseId(e.target.value)}
            >
              <option value="">Toutes franchises</option>
              {(franchises.data ?? []).map((f) => (
                <option key={f._id} value={f._id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              disabled
              value={
                user?.franchiseId ? 'Franchise courante' : 'Aucune franchise'
              }
            />
          )}
          <div className="text-sm text-slate-500 self-center">
            {closings.data?.length ?? 0} clôture(s)
          </div>
        </div>
      </section>

      <section className="card p-4 mb-5">
        {summary.data && (
          <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Metric
              label="Especes attendues"
              value={money(summary.data.expectedDrawerTotal)}
              hint="Auto + mouvements - retours"
            />
            <Metric
              label="Ventes especes"
              value={money(summary.data.cashSalesTotal)}
            />
            <Metric
              label="Avances echeance"
              value={money(summary.data.installmentAdvancesTotal)}
            />
            <Metric
              label="Echeances encaissees"
              value={money(summary.data.cashInstallmentsTotal)}
            />
            <Metric
              label="Entrees caisse"
              value={money(summary.data.treasuryCashInTotal)}
            />
            <Metric
              label="Sorties caisse"
              value={money(summary.data.treasuryCashOutTotal)}
            />
            <Metric
              label="Retours rembourses"
              value={money(summary.data.returnRefundTotal)}
              hint={`${summary.data.returnRefundCount} retour(s)`}
            />
            <Metric label="Carte" value={money(summary.data.cardSalesTotal)} />
            <Metric
              label="Virements"
              value={money(summary.data.transferSalesTotal)}
            />
            <Metric
              label="Echeances a payer"
              value={money(summary.data.installmentDueTotal)}
              hint={`${summary.data.installmentDueCount} lot(s)`}
            />
            <Metric
              label="Articles sortis"
              value={String(summary.data.systemItemsTotal)}
            />
            <Metric
              label="CA total"
              value={money(summary.data.systemSalesTotal)}
              hint={`${summary.data.saleCount} vente(s)`}
            />
          </div>
        )}
        <div className="mb-4 border-y border-slate-200 py-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Comptage especes
              </div>
              <div className="text-xs text-slate-500">
                Saisis les billets/pieces, le total reel se calcule
                automatiquement.
              </div>
            </div>
            <div
              className={`text-sm font-semibold ${
                cashVariance < 0
                  ? 'text-rose-600'
                  : cashVariance > 0
                    ? 'text-emerald-700'
                    : 'text-slate-600'
              }`}
            >
              Ecart: {money(cashVariance)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {CASH_DENOMINATIONS.map((item) => (
              <label key={item.label} className="block">
                <span className="label">{item.label}</span>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={denominationQty[denominationKey(item.value)] ?? 0}
                  onChange={(event) =>
                    updateDenomination(item.value, Number(event.target.value))
                  }
                />
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">Total comptage: </span>
              <span className="font-bold text-slate-900">
                {money(cashDenominationTotal)}
              </span>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">Attendu: </span>
              <span className="font-bold text-slate-900">
                {money(expectedDrawerTotal)}
              </span>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">Declare: </span>
              <span className="font-bold text-slate-900">
                {money(declaredSalesTotal)}
              </span>
            </div>
          </div>
          {varianceRequiresReason && (
            <label className="mt-3 block">
              <span className="label">Raison obligatoire de l'ecart</span>
              <textarea
                className="input min-h-[84px]"
                value={varianceReason}
                onChange={(event) => setVarianceReason(event.target.value)}
                placeholder="Ex: fond de caisse manquant, remboursement client, erreur de comptage..."
              />
            </label>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <label className="block">
            <span className="label">Jour de travail</span>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">Especes reelles en caisse</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="input"
              title="Argent especes reel en caisse"
              value={declaredSalesTotal}
              onChange={(e) =>
                setDeclaredSalesTotal(Math.max(0, Number(e.target.value) || 0))
              }
            />
          </label>
          <label className="block">
            <span className="label">Articles declares</span>
            <input
              type="number"
              min={0}
              className="input"
              value={declaredItemsTotal}
              onChange={(e) =>
                setDeclaredItemsTotal(Math.max(0, Number(e.target.value) || 0))
              }
            />
          </label>
          <label className="block">
            <span className="label">Commentaire</span>
            <input
              className="input"
              placeholder="Optionnel"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <button
            className="btn-primary"
            disabled={
              submit.isPending ||
              (varianceRequiresReason && !varianceReason.trim())
            }
            onClick={() => submit.mutate()}
          >
            {submit.isPending
              ? 'Soumission…'
              : editingId
                ? 'Enregistrer correction'
                : 'Soumettre clôture'}
          </button>
        </div>
        {editingId && (
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() => {
              setEditingId(null);
              setComment('');
              setVarianceReason('');
              setDenominationQty(emptyDenominations());
            }}
          >
            Annuler modification
          </button>
        )}
        {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
      </section>

      <section className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Date</th>
                <th className="th text-right">Déclaré</th>
                <th className="th text-right">Attendu</th>
                <th className="th text-right">Ventes esp.</th>
                <th className="th text-right">Mouvements</th>
                <th className="th text-right">Retours</th>
                <th className="th text-right">Ecart</th>
                <th className="th">Franchise</th>
                <th className="th">Etat</th>
                <th className="th-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {(closings.data ?? []).map((c) => {
                const expectedDrawerTotal =
                  c.expectedDrawerTotal ??
                  c.systemCashTotal ??
                  c.systemSalesTotal;
                const movementNet =
                  (c.treasuryCashInTotal ?? 0) - (c.treasuryCashOutTotal ?? 0);
                const variance = c.declaredSalesTotal - expectedDrawerTotal;
                return (
                  <tr key={c._id}>
                    <td className="td">{dateOnly(c.closingDate)}</td>
                    <td className="td text-right">
                      {money(c.declaredSalesTotal)}
                    </td>
                    <td className="td text-right">
                      {money(expectedDrawerTotal)}
                    </td>
                    <td className="td text-right">
                      {money(c.cashSalesTotal ?? 0)}
                    </td>
                    <td className="td text-right">{money(movementNet)}</td>
                    <td className="td text-right">
                      {money(c.returnRefundTotal ?? 0)}
                    </td>
                    <td
                      className={`td text-right ${variance < 0 ? 'text-rose-600' : 'text-emerald-700'}`}
                    >
                      {money(variance)}
                    </td>
                    <td className="td">
                      {typeof c.franchiseId === 'object'
                        ? c.franchiseId.name
                        : '—'}
                    </td>
                    <td className="td">
                      <div>{c.validated ? 'Validée' : 'En attente'}</div>
                      {c.autoGenerated && (
                        <div className="text-xs text-slate-500">Auto 04:00</div>
                      )}
                    </td>
                    <td className="td-action">
                      {canValidate && (
                        <div className="flex justify-end gap-2">
                          {!c.validated && (
                            <button
                              className="btn btn-secondary"
                              onClick={() => validateClosing.mutate(c._id)}
                              disabled={validateClosing.isPending}
                            >
                              Valider
                            </button>
                          )}
                          <button
                            className="btn btn-secondary"
                            onClick={() => {
                              setEditingId(c._id);
                              setFranchiseId(
                                typeof c.franchiseId === 'object'
                                  ? c.franchiseId._id
                                  : String(c.franchiseId),
                              );
                              setDate(
                                new Date(c.closingDate)
                                  .toISOString()
                                  .slice(0, 10),
                              );
                              setDeclaredSalesTotal(c.declaredSalesTotal);
                              setDeclaredItemsTotal(c.declaredItemsTotal);
                              setDenominationQty({
                                ...emptyDenominations(),
                                ...Object.fromEntries(
                                  (c.cashDenominations ?? []).map((item) => [
                                    denominationKey(item.value),
                                    item.quantity,
                                  ]),
                                ),
                              });
                              setVarianceReason(c.varianceReason ?? '');
                              setComment(c.comment ?? '');
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-danger !min-h-[34px] !px-3 !py-1"
                            disabled={deleteClosing.isPending}
                            onClick={() => {
                              if (window.confirm('Supprimer cette cloture ?'))
                                deleteClosing.mutate(c._id);
                            }}
                          >
                            Supprimer
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!closings.isLoading && (closings.data?.length ?? 0) === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={10}>
                    Aucune clôture.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
