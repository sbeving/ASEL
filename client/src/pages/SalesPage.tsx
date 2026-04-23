import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money, dateTime, dateOnly } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../auth/AuthContext';
import type { Franchise, Sale } from '../lib/types';

const paymentMethodLabels: Record<Sale['paymentMethod'], string> = {
  cash: 'Espèces',
  card: 'Carte',
  transfer: 'Virement',
  installment: 'Échéance',
  other: 'Autre',
};

const saleTypeLabels: Record<Sale['saleType'], string> = {
  ticket: 'Ticket',
  facture: 'Facture',
  devis: 'Devis',
};

const paymentStatusLabels: Record<Sale['paymentStatus'], string> = {
  paid: 'Payée',
  partial: 'Partielle',
  pending: 'En attente',
};

function statusBadgeClass(status: Sale['paymentStatus']) {
  if (status === 'paid') return 'badge-success';
  if (status === 'partial') return 'badge-warning';
  return 'badge-muted';
}

export function SalesPage() {
  const { user } = useAuth();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager';
  const [selectedFid, setSelectedFid] = useState('');

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const sales = useQuery({
    queryKey: ['sales', selectedFid],
    queryFn: async () =>
      (
        await api.get<{ sales: Sale[] }>('/sales', {
          params: { franchiseId: selectedFid || undefined, limit: 200 },
        })
      ).data.sales,
  });

  const summary = useMemo(() => {
    const rows = sales.data ?? [];
    const total = rows.reduce((sum, sale) => sum + sale.total, 0);
    const received = rows.reduce((sum, sale) => sum + (sale.amountReceived ?? 0), 0);
    const installmentSales = rows.filter((sale) => sale.paymentMethod === 'installment').length;
    return { total, received, installmentSales };
  }, [sales.data]);

  return (
    <>
      <PageHeader title="Ventes" subtitle={`${sales.data?.length ?? 0} transactions récentes`} />

      {isGlobal && (
        <div className="mb-4">
          <select className="input max-w-sm" value={selectedFid} onChange={(e) => setSelectedFid(e.target.value)}>
            <option value="">Toutes franchises</option>
            {(franchises.data ?? []).map((franchise) => (
              <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
            ))}
          </select>
        </div>
      )}

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Volume</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{money(summary.total)}</div>
          <div className="mt-1 text-sm text-slate-500">Total facturé sur la sélection</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Encaissements</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{money(summary.received)}</div>
          <div className="mt-1 text-sm text-slate-500">Montants déjà reçus</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Ventes à terme</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{summary.installmentSales}</div>
          <div className="mt-1 text-sm text-slate-500">Transactions avec échéances</div>
        </div>
      </section>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Pièce</th>
              <th className="th">Date</th>
              <th className="th">Franchise</th>
              <th className="th">Client</th>
              <th className="th">Type</th>
              <th className="th">Paiement</th>
              <th className="th">Statut</th>
              <th className="th text-right">Reçu</th>
              <th className="th text-right">Reste</th>
              <th className="th text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(sales.data ?? []).map((sale) => {
              const amountReceived = sale.amountReceived ?? 0;
              const remaining = Math.max(0, sale.total - amountReceived);
              const clientName = typeof sale.clientId === 'object' && sale.clientId ? sale.clientId.fullName : '—';
              const franchiseName = typeof sale.franchiseId === 'object' ? sale.franchiseId.name : '—';

              return (
                <tr key={sale._id}>
                  <td className="td">
                    <div className="font-medium text-slate-900">{sale.invoiceNumber || '—'}</div>
                    <div className="text-xs text-slate-500">{sale.items.length} article(s)</div>
                  </td>
                  <td className="td text-slate-500">
                    <div>{dateTime(sale.createdAt)}</div>
                    {sale.installmentPlan && (
                      <div className="text-xs">1er lot: {dateOnly(sale.installmentPlan.firstDueDate)}</div>
                    )}
                  </td>
                  <td className="td">{franchiseName}</td>
                  <td className="td">{clientName}</td>
                  <td className="td">{saleTypeLabels[sale.saleType]}</td>
                  <td className="td">{paymentMethodLabels[sale.paymentMethod]}</td>
                  <td className="td">
                    <span className={statusBadgeClass(sale.paymentStatus)}>{paymentStatusLabels[sale.paymentStatus]}</span>
                  </td>
                  <td className="td text-right">{sale.amountReceived == null ? '—' : money(amountReceived)}</td>
                  <td className="td text-right">{money(remaining)}</td>
                  <td className="td text-right font-medium">{money(sale.total)}</td>
                </tr>
              );
            })}
            {!sales.isLoading && (sales.data?.length ?? 0) === 0 && (
              <tr><td className="td text-slate-400" colSpan={10}>Aucune vente.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
