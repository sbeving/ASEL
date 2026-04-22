import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money, dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../auth/AuthContext';
import { useState } from 'react';
import type { Franchise, Sale } from '../lib/types';

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

  return (
    <>
      <PageHeader title="Ventes" subtitle={`${sales.data?.length ?? 0} transactions`} />
      {isGlobal && (
        <div className="mb-4">
          <select className="input max-w-sm" value={selectedFid} onChange={(e) => setSelectedFid(e.target.value)}>
            <option value="">Toutes franchises</option>
            {(franchises.data ?? []).map((f) => (
              <option key={f._id} value={f._id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Franchise</th>
              <th className="th">Vendeur</th>
              <th className="th">Articles</th>
              <th className="th">Paiement</th>
              <th className="th text-right">Sous-total</th>
              <th className="th text-right">Remise</th>
              <th className="th text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(sales.data ?? []).map((s) => (
              <tr key={s._id}>
                <td className="td text-slate-500">{dateTime(s.createdAt)}</td>
                <td className="td">{typeof s.franchiseId === 'object' ? s.franchiseId.name : '—'}</td>
                <td className="td">{typeof s.userId === 'object' ? s.userId.fullName : '—'}</td>
                <td className="td">{s.items.length}</td>
                <td className="td text-slate-500">{s.paymentMethod}</td>
                <td className="td text-right">{money(s.subtotal)}</td>
                <td className="td text-right text-slate-500">{money(s.discount)}</td>
                <td className="td text-right font-medium">{money(s.total)}</td>
              </tr>
            ))}
            {!sales.isLoading && (sales.data?.length ?? 0) === 0 && (
              <tr><td className="td text-slate-400" colSpan={8}>Aucune vente.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
