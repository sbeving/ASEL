import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money, dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import type { DashboardPayload, Sale } from '../lib/types';

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

const paymentMethodLabel: Record<Sale['paymentMethod'], string> = {
  cash: 'Especes',
  card: 'Carte',
  transfer: 'Virement',
  installment: 'Echeance',
  other: 'Autre',
};

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<DashboardPayload>('/dashboard')).data,
  });

  if (isLoading) return <div className="text-slate-400">Chargement...</div>;
  if (!data) return null;
  const { kpis, lowStock, recentSales, roleProfile, reports } = data;

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle="Vue d'ensemble de votre activite" />

      <section className="surface-enter mb-5 rounded-xl border border-brand-200 bg-brand-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Profil {roleProfile.scope === 'global' ? 'global' : 'franchise'}
        </div>
        <div className="mt-1 text-sm font-semibold text-brand-900">{roleProfile.primaryGoal}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {roleProfile.recommendedActions.map((item) => (
            <span key={item} className="badge-info">
              {item}
            </span>
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Ventes aujourd'hui" value={money(kpis.todaySalesTotal)} hint={`${kpis.todaySalesCount} transactions`} />
        <Kpi label="Ventes ce mois" value={money(kpis.monthSalesTotal)} hint={`${kpis.monthSalesCount} transactions`} />
        <Kpi label="Produits en rupture" value={String(kpis.lowStockCount)} hint="sous le seuil" />
        <Kpi label="Transferts en attente" value={String(kpis.pendingTransfers)} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="card p-4 xl:col-span-1">
          <div className="text-sm font-semibold">Rapport tresorerie du jour</div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Encaissement</span>
              <span className="font-medium text-emerald-700">{money(reports.cashToday.in)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Decaissement</span>
              <span className="font-medium text-rose-700">{money(reports.cashToday.out)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 pt-2">
              <span className="font-medium text-slate-700">Net</span>
              <span className="font-semibold text-slate-900">{money(reports.cashToday.net)}</span>
            </div>
            <div className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
              Echeances a traiter: <span className="font-semibold">{reports.pendingInstallments}</span>
            </div>
          </div>
        </div>

        <div className="card p-4 xl:col-span-2">
          <div className="text-sm font-semibold">Modes de paiement (mois)</div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Mode</th>
                  <th className="th text-right">Transactions</th>
                  <th className="th text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {reports.paymentBreakdown.map((row) => (
                  <tr key={`${row.paymentMethod}-${row.count}`}>
                    <td className="td">{paymentMethodLabel[row.paymentMethod] ?? row.paymentMethod}</td>
                    <td className="td text-right">{row.count}</td>
                    <td className="td text-right font-medium">{money(row.total)}</td>
                  </tr>
                ))}
                {reports.paymentBreakdown.length === 0 && (
                  <tr>
                    <td className="td text-slate-400" colSpan={3}>Aucune donnee de paiement.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="card">
          <div className="border-b border-slate-200 px-5 py-3 text-sm font-semibold">
            Stock faible
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Produit</th>
                  <th className="th">Franchise</th>
                  <th className="th text-right">Qte</th>
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
                    <td className="td text-slate-500">{s.franchise?.name ?? '-'}</td>
                    <td className="td text-right font-medium text-rose-600">{s.quantity}</td>
                    <td className="td text-right text-slate-500">{s.product.lowStockThreshold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="border-b border-slate-200 px-5 py-3 text-sm font-semibold">
            Ventes recentes
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
                    <td className="td text-slate-400" colSpan={4}>Aucune vente recente.</td>
                  </tr>
                )}
                {recentSales.map((s) => (
                  <tr key={s._id}>
                    <td className="td text-slate-500">{dateTime(s.createdAt)}</td>
                    <td className="td">{typeof s.franchiseId === 'object' ? s.franchiseId?.name : '-'}</td>
                    <td className="td">
                      {typeof s.userId === 'object' ? s.userId?.fullName : '-'}
                    </td>
                    <td className="td text-right font-medium">{money(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-6 card p-4">
        <div className="mb-3 text-sm font-semibold">Top produits (mois)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Produit</th>
                <th className="th text-right">Quantite</th>
                <th className="th text-right">CA</th>
              </tr>
            </thead>
            <tbody>
              {reports.topProducts.map((item) => (
                <tr key={item.productId}>
                  <td className="td">{item.name}</td>
                  <td className="td text-right">{item.quantity}</td>
                  <td className="td text-right font-medium">{money(item.revenue)}</td>
                </tr>
              ))}
              {reports.topProducts.length === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={3}>Aucune vente sur la periode.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
