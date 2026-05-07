import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { dateOnly, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import type { Closing, Franchise } from '../lib/types';

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
  const [franchiseId, setFranchiseId] = useState(isGlobal ? '' : (user?.franchiseId ?? ''));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [declaredSalesTotal, setDeclaredSalesTotal] = useState(0);
  const [declaredItemsTotal, setDeclaredItemsTotal] = useState(0);
  const [comment, setComment] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const effectiveFranchiseId = franchiseId || user?.franchiseId || '';

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
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
            installmentAdvancesTotal: number;
            cashInstallmentsTotal: number;
            installmentCashCount: number;
            installmentDueTotal: number;
            installmentDueCount: number;
            installmentPaidTotal: number;
            installmentPaidCount: number;
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
    if (!summary.data) return;
    setDeclaredSalesTotal(summary.data.systemCashTotal);
    setDeclaredItemsTotal(summary.data.systemItemsTotal);
  }, [summary.data]);

  const submit = useMutation({
    mutationFn: async () => {
      const payloadFranchiseId = franchiseId || user?.franchiseId;
      if (!payloadFranchiseId) throw new Error('Franchise requise');
      const payload = {
        franchiseId: payloadFranchiseId,
        date,
        declaredSalesTotal,
        declaredItemsTotal,
        comment: comment || undefined,
      };
      if (editingId) await api.patch(`/closings/${editingId}`, payload);
      else await api.post('/closings', payload);
    },
    onSuccess: () => {
      setErr(null);
      setComment('');
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
      <PageHeader title="Clôtures" subtitle="Déclaration et validation fin de journée" />

      <section className="card p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {isGlobal ? (
            <select className="input" value={franchiseId} onChange={(e) => setFranchiseId(e.target.value)}>
              <option value="">Toutes franchises</option>
              {(franchises.data ?? []).map((f) => (
                <option key={f._id} value={f._id}>{f.name}</option>
              ))}
            </select>
          ) : (
            <input className="input" disabled value={user?.franchiseId ? 'Franchise courante' : 'Aucune franchise'} />
          )}
          <div className="text-sm text-slate-500 self-center">{closings.data?.length ?? 0} clôture(s)</div>
        </div>
      </section>

      <section className="card p-4 mb-5">
        {summary.data && (
          <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Metric label="Total especes caisse" value={money(summary.data.systemCashTotal)} />
            <Metric label="Ventes especes" value={money(summary.data.cashSalesTotal)} />
            <Metric label="Avances echeance" value={money(summary.data.installmentAdvancesTotal)} />
            <Metric label="Echeances encaissees" value={money(summary.data.cashInstallmentsTotal)} />
            <Metric label="Echeances a payer" value={money(summary.data.installmentDueTotal)} hint={`${summary.data.installmentDueCount} lot(s)`} />
            <Metric label="Articles sortis" value={String(summary.data.systemItemsTotal)} />
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <label className="block">
            <span className="label">Jour de travail</span>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Especes reelles en caisse</span>
            <input type="number" min={0} step="0.01" className="input" title="Argent especes reel en caisse" value={declaredSalesTotal} onChange={(e) => setDeclaredSalesTotal(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label className="block">
            <span className="label">Articles declares</span>
            <input type="number" min={0} className="input" value={declaredItemsTotal} onChange={(e) => setDeclaredItemsTotal(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label className="block">
            <span className="label">Commentaire</span>
            <input className="input" placeholder="Optionnel" value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Soumission…' : editingId ? 'Enregistrer correction' : 'Soumettre clôture'}
          </button>
        </div>
        {editingId && (
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() => {
              setEditingId(null);
              setComment('');
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
                <th className="th text-right">Caisse auto</th>
                <th className="th text-right">Avances</th>
                <th className="th text-right">Ech. enc.</th>
                <th className="th text-right">Ecart</th>
                <th className="th">Franchise</th>
                <th className="th">Etat</th>
                <th className="th-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {(closings.data ?? []).map((c) => {
                const systemCashTotal = c.systemCashTotal ?? c.systemSalesTotal;
                const variance = c.declaredSalesTotal - systemCashTotal;
                return (
                  <tr key={c._id}>
                    <td className="td">{dateOnly(c.closingDate)}</td>
                    <td className="td text-right">{money(c.declaredSalesTotal)}</td>
                    <td className="td text-right">{money(systemCashTotal)}</td>
                    <td className="td text-right">{money(c.installmentAdvancesTotal ?? 0)}</td>
                    <td className="td text-right">{money(c.cashInstallmentsTotal ?? 0)}</td>
                    <td className={`td text-right ${variance < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{money(variance)}</td>
                    <td className="td">{typeof c.franchiseId === 'object' ? c.franchiseId.name : '—'}</td>
                    <td className="td">
                      <div>{c.validated ? 'Validée' : 'En attente'}</div>
                      {c.autoGenerated && <div className="text-xs text-slate-500">Auto 04:00</div>}
                    </td>
                    <td className="td-action">
                      {canValidate && (
                        <div className="flex justify-end gap-2">
                          {!c.validated && (
                            <button className="btn btn-secondary" onClick={() => validateClosing.mutate(c._id)} disabled={validateClosing.isPending}>
                              Valider
                            </button>
                          )}
                          <button
                            className="btn btn-secondary"
                            onClick={() => {
                              setEditingId(c._id);
                              setFranchiseId(typeof c.franchiseId === 'object' ? c.franchiseId._id : String(c.franchiseId));
                              setDate(new Date(c.closingDate).toISOString().slice(0, 10));
                              setDeclaredSalesTotal(c.declaredSalesTotal);
                              setDeclaredItemsTotal(c.declaredItemsTotal);
                              setComment(c.comment ?? '');
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-danger !min-h-[34px] !px-3 !py-1"
                            disabled={deleteClosing.isPending}
                            onClick={() => {
                              if (window.confirm('Supprimer cette cloture ?')) deleteClosing.mutate(c._id);
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
                  <td className="td text-slate-400" colSpan={9}>Aucune clôture.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
