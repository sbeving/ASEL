import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { dateOnly, dateTime, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import type { Client, Franchise, Installment, Sale } from '../lib/types';

function toLocalDateTimeInputValue(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function InstallmentsPage() {
  const { user } = useAuth();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager';
  const defaultFid = isGlobal ? '' : (user?.franchiseId ?? '');

  const qc = useQueryClient();
  const [franchiseId, setFranchiseId] = useState(defaultFid);
  const [statusFilter, setStatusFilter] = useState<'' | 'pending' | 'paid' | 'late'>('');
  const [saleId, setSaleId] = useState('');
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState(0);
  const [dueDateLocal, setDueDateLocal] = useState(toLocalDateTimeInputValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
  const [err, setErr] = useState<string | null>(null);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const sales = useQuery({
    queryKey: ['sales', franchiseId],
    queryFn: async () =>
      (
        await api.get<{ sales: Sale[] }>('/sales', {
          params: {
            franchiseId: franchiseId || undefined,
            limit: 200,
          },
        })
      ).data.sales,
  });

  const clients = useQuery({
    queryKey: ['clients-for-installments', franchiseId],
    queryFn: async () =>
      (
        await api.get<{ clients: Client[] }>('/clients', {
          params: {
            franchiseId: franchiseId || undefined,
            limit: 200,
          },
        })
      ).data.clients,
  });

  const installments = useQuery({
    queryKey: ['installments', franchiseId, statusFilter],
    queryFn: async () =>
      (
        await api.get<{ installments: Installment[] }>('/installments', {
          params: {
            franchiseId: franchiseId || undefined,
            status: statusFilter || undefined,
          },
        })
      ).data.installments,
  });

  const selectedSaleAmount = useMemo(() => {
    const selected = (sales.data ?? []).find((s) => s._id === saleId);
    return selected?.total ?? 0;
  }, [sales.data, saleId]);

  const create = useMutation({
    mutationFn: async () => {
      if (!saleId) throw new Error('Vente requise');
      const due = new Date(dueDateLocal);
      if (Number.isNaN(due.getTime())) throw new Error('Date d’échéance invalide');
      await api.post('/installments', {
        saleId,
        clientId: clientId || null,
        amount,
        dueDate: due.toISOString(),
      });
    },
    onSuccess: () => {
      setErr(null);
      setSaleId('');
      setClientId('');
      setAmount(0);
      qc.invalidateQueries({ queryKey: ['installments'] });
    },
    onError: (e) => setErr(apiError(e).message),
  });

  const pay = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/installments/${id}/pay`, { paymentMethod: 'cash' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['installments'] }),
    onError: (e) => setErr(apiError(e).message),
  });

  return (
    <>
      <PageHeader title="Echéances" subtitle="Suivi des paiements à terme" />

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
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | 'pending' | 'paid' | 'late')}>
            <option value="">Tous statuts</option>
            <option value="pending">En attente</option>
            <option value="paid">Payée</option>
            <option value="late">En retard</option>
          </select>
          <div className="text-sm text-slate-500 self-center">{installments.data?.length ?? 0} échéance(s)</div>
        </div>
      </section>

      <section className="card p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <select className="input" value={saleId} onChange={(e) => setSaleId(e.target.value)}>
            <option value="">— Vente —</option>
            {(sales.data ?? []).map((s) => (
              <option key={s._id} value={s._id}>
                {dateTime(s.createdAt)} · {money(s.total)}
              </option>
            ))}
          </select>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Sans client</option>
            {(clients.data ?? []).map((c) => (
              <option key={c._id} value={c._id}>{c.fullName}</option>
            ))}
          </select>
          <input type="number" min={0} step="0.01" className="input" value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} />
          <input type="datetime-local" className="input" value={dueDateLocal} onChange={(e) => setDueDateLocal(e.target.value)} />
          <button className="btn-primary" disabled={!saleId || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Création…' : 'Créer échéance'}
          </button>
        </div>
        {saleId && <div className="mt-2 text-sm text-slate-500">Montant de la vente: {money(selectedSaleAmount)}</div>}
        {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
      </section>

      <section className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Echéance</th>
                <th className="th text-right">Montant</th>
                <th className="th">Statut</th>
                <th className="th">Client</th>
                <th className="th">Paiement</th>
                <th className="th">Action</th>
              </tr>
            </thead>
            <tbody>
              {(installments.data ?? []).map((i) => (
                <tr key={i._id}>
                  <td className="td">{dateOnly(i.dueDate)}</td>
                  <td className="td text-right">{money(i.amount)}</td>
                  <td className="td capitalize">{i.status}</td>
                  <td className="td">{typeof i.clientId === 'object' ? i.clientId.fullName : '—'}</td>
                  <td className="td">{i.paidAt ? dateOnly(i.paidAt) : '—'}</td>
                  <td className="td">
                    {i.status !== 'paid' && (
                      <button className="btn btn-secondary" onClick={() => pay.mutate(i._id)} disabled={pay.isPending}>
                        Marquer payé
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!installments.isLoading && (installments.data?.length ?? 0) === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={6}>Aucune échéance.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
