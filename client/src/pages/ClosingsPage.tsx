import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { dateOnly, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import type { Closing, Franchise } from '../lib/types';

export function ClosingsPage() {
  const { user } = useAuth();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager';
  const canValidate = user?.role === 'admin' || user?.role === 'manager';

  const qc = useQueryClient();
  const [franchiseId, setFranchiseId] = useState(isGlobal ? '' : (user?.franchiseId ?? ''));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [declaredSalesTotal, setDeclaredSalesTotal] = useState(0);
  const [declaredItemsTotal, setDeclaredItemsTotal] = useState(0);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);

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

  const submit = useMutation({
    mutationFn: async () => {
      const payloadFranchiseId = franchiseId || user?.franchiseId;
      if (!payloadFranchiseId) throw new Error('Franchise requise');
      await api.post('/closings', {
        franchiseId: payloadFranchiseId,
        date,
        declaredSalesTotal,
        declaredItemsTotal,
        comment: comment || undefined,
      });
    },
    onSuccess: () => {
      setErr(null);
      setComment('');
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
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="number" min={0} step="0.01" className="input" value={declaredSalesTotal} onChange={(e) => setDeclaredSalesTotal(Math.max(0, Number(e.target.value) || 0))} />
          <input type="number" min={0} className="input" value={declaredItemsTotal} onChange={(e) => setDeclaredItemsTotal(Math.max(0, Number(e.target.value) || 0))} />
          <input className="input" placeholder="Commentaire (optionnel)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn-primary" disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Soumission…' : 'Soumettre clôture'}
          </button>
        </div>
        {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
      </section>

      <section className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Date</th>
                <th className="th text-right">Déclaré</th>
                <th className="th text-right">Système</th>
                <th className="th text-right">Ecart</th>
                <th className="th">Franchise</th>
                <th className="th">Etat</th>
                <th className="th-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {(closings.data ?? []).map((c) => {
                const variance = c.declaredSalesTotal - c.systemSalesTotal;
                return (
                  <tr key={c._id}>
                    <td className="td">{dateOnly(c.closingDate)}</td>
                    <td className="td text-right">{money(c.declaredSalesTotal)}</td>
                    <td className="td text-right">{money(c.systemSalesTotal)}</td>
                    <td className={`td text-right ${variance < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{money(variance)}</td>
                    <td className="td">{typeof c.franchiseId === 'object' ? c.franchiseId.name : '—'}</td>
                    <td className="td">{c.validated ? 'Validée' : 'En attente'}</td>
                    <td className="td-action">
                      {canValidate && !c.validated && (
                        <button className="btn btn-secondary" onClick={() => validateClosing.mutate(c._id)} disabled={validateClosing.isPending}>
                          Valider
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!closings.isLoading && (closings.data?.length ?? 0) === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={7}>Aucune clôture.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
