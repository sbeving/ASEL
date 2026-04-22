import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money, dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import type { DashboardPayload } from '../lib/types';

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<DashboardPayload>('/dashboard')).data,
  });

  if (isLoading) return <div className="text-slate-400">Chargement…</div>;
  if (!data) return null;
  const { kpis, lowStock, recentSales } = data;

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle="Vue d’ensemble de votre activité" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Ventes aujourd’hui" value={money(kpis.todaySalesTotal)} hint={`${kpis.todaySalesCount} transactions`} />
        <Kpi label="Ventes ce mois" value={money(kpis.monthSalesTotal)} hint={`${kpis.monthSalesCount} transactions`} />
        <Kpi label="Produits en rupture" value={String(kpis.lowStockCount)} hint="sous le seuil" />
        <Kpi label="Transferts en attente" value={String(kpis.pendingTransfers)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="px-5 py-3 border-b border-slate-200 text-sm font-semibold">
            Stock faible
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Produit</th>
                  <th className="th">Franchise</th>
                  <th className="th text-right">Qté</th>
                  <th className="th text-right">Seuil</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.length === 0 && (
                  <tr>
                    <td className="td text-slate-400" colSpan={4}>Aucun produit sous le seuil.</td>
                  </tr>
                )}
                {lowStock.map((s) => (
                  <tr key={s._id}>
                    <td className="td">{s.product.name}</td>
                    <td className="td text-slate-500">{s.franchise?.name ?? '—'}</td>
                    <td className="td text-right font-medium text-rose-600">{s.quantity}</td>
                    <td className="td text-right text-slate-500">{s.product.lowStockThreshold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="px-5 py-3 border-b border-slate-200 text-sm font-semibold">
            Ventes récentes
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Franchise</th>
                  <th className="th">Vendeur</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.length === 0 && (
                  <tr>
                    <td className="td text-slate-400" colSpan={4}>Aucune vente récente.</td>
                  </tr>
                )}
                {recentSales.map((s) => (
                  <tr key={s._id}>
                    <td className="td text-slate-500">{dateTime(s.createdAt)}</td>
                    <td className="td">{typeof s.franchiseId === 'object' ? s.franchiseId?.name : '—'}</td>
                    <td className="td">
                      {typeof s.userId === 'object' ? s.userId?.fullName : '—'}
                    </td>
                    <td className="td text-right font-medium">{money(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
