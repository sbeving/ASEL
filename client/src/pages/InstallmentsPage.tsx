import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { dateOnly, dateTime, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import type { Client, Franchise, Installment, Sale } from '../lib/types';

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function statusBadge(status: Installment['status']) {
  if (status === 'paid') return 'badge-success';
  if (status === 'late') return 'badge-danger';
  return 'badge-warning';
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
  const [dueDateLocal, setDueDateLocal] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
  );
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
    const selected = (sales.data ?? []).find((sale) => sale._id === saleId);
    return selected?.total ?? 0;
  }, [saleId, sales.data]);

  const create = useMutation({
    mutationFn: async () => {
      if (!saleId) throw new Error('Vente requise');
      const due = new Date(dueDateLocal);
      if (Number.isNaN(due.getTime())) throw new Error("Date d'échéance invalide");
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
    onError: (error) => setErr(apiError(error).message),
  });

  const pay = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/installments/${id}/pay`, { paymentMethod: 'cash' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['installments'] }),
    onError: (error) => setErr(apiError(error).message),
  });

  return (
    <>
      <PageHeader title="Échéances" subtitle="Suivi des paiements à terme" />

      <section className="card mb-5 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {isGlobal ? (
            <select className="input" value={franchiseId} onChange={(e) => setFranchiseId(e.target.value)}>
              <option value="">Toutes franchises</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
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
          <div className="self-center text-sm text-slate-500">{installments.data?.length ?? 0} échéance(s)</div>
        </div>
      </section>

      <section className="card mb-5 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <select className="input" value={saleId} onChange={(e) => setSaleId(e.target.value)}>
            <option value="">— Vente —</option>
            {(sales.data ?? []).map((sale) => (
              <option key={sale._id} value={sale._id}>
                {(sale.invoiceNumber || dateTime(sale.createdAt))} · {money(sale.total)}
              </option>
            ))}
          </select>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Sans client</option>
            {(clients.data ?? []).map((client) => (
              <option key={client._id} value={client._id}>{client.fullName}</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            step="0.01"
            className="input"
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          />
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
                <th className="th">Pièce</th>
                <th className="th">Échéance</th>
                <th className="th text-right">Montant</th>
                <th className="th">Statut</th>
                <th className="th">Client</th>
                <th className="th">Paiement</th>
                <th className="th">Action</th>
              </tr>
            </thead>
            <tbody>
              {(installments.data ?? []).map((installment) => (
                <tr key={installment._id}>
                  <td className="td">
                    {typeof installment.saleId === 'object' && installment.saleId
                      ? installment.saleId.invoiceNumber || dateTime(installment.saleId.createdAt)
                      : '—'}
                  </td>
                  <td className="td">{dateOnly(installment.dueDate)}</td>
                  <td className="td text-right">{money(installment.amount)}</td>
                  <td className="td"><span className={statusBadge(installment.status)}>{installment.status}</span></td>
                  <td className="td">
                    {typeof installment.clientId === 'object' && installment.clientId ? installment.clientId.fullName : '—'}
                  </td>
                  <td className="td">{installment.paidAt ? dateOnly(installment.paidAt) : '—'}</td>
                  <td className="td">
                    {installment.status !== 'paid' && (
                      <button className="btn btn-secondary" onClick={() => pay.mutate(installment._id)} disabled={pay.isPending}>
                        Marquer payé
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!installments.isLoading && (installments.data?.length ?? 0) === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={7}>Aucune échéance.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
