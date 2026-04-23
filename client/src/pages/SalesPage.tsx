import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money, dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../auth/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Franchise, Sale } from '../lib/types';

interface SalePage {
  sales: Sale[];
  nextCursor: string | null;
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

  const pages = useInfiniteQuery<SalePage>({
    queryKey: ['sales', selectedFid],
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<SalePage>('/sales', {
          params: {
            franchiseId: selectedFid || undefined,
            cursor: pageParam || undefined,
            limit: 50,
          },
        })
      ).data,
  });

  const sales = (pages.data?.pages ?? []).flatMap((p) => p.sales);

  return (
    <>
      <PageHeader title="Ventes" subtitle={`${sales.length} transactions chargées`} />
      {isGlobal && (
        <div className="mb-4">
          <select className="input max-w-sm" value={selectedFid} onChange={(e) => setSelectedFid(e.target.value)}>
            <option value="">Toutes franchises</option>
            {(franchises.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
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
            {sales.map((s) => (
              <tr key={s.id}>
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
            {!pages.isLoading && sales.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={8}>Aucune vente.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <button
            className="btn-secondary"
            onClick={() => pages.fetchNextPage()}
            disabled={pages.isFetchingNextPage}
          >
            {pages.isFetchingNextPage ? 'Chargement…' : 'Charger plus'}
          </button>
        </div>
      )}
    </>
  );
}
