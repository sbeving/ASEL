import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';
import { 
  TrendingUp, TrendingDown, PackageOpen, ArrowRightLeft, 
  Wallet, CreditCard, Landmark, CalendarClock, Receipt, Filter, Banknote
} from 'lucide-react';
import { api } from '../lib/api';
import { money, dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import type { DashboardPayload, Sale } from '../lib/types';
import clsx from 'clsx';

function KpiCard({ 
  label, value, hint, icon: Icon, trend, index 
}: { 
  label: string; value: string; hint?: string; icon: any; trend?: number; index: number;
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="card p-5 relative overflow-hidden group"
    >
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-brand-50 rounded-full opacity-50 dark:bg-brand-900/20 group-hover:scale-150 transition-transform duration-500" />
      <div className="flex justify-between items-start mb-4 relative">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-brand-100 text-brand-600 rounded-lg dark:bg-brand-900/50 dark:text-brand-400">
            <Icon className="w-5 h-5" />
          </div>
          <span className="text-sm font-semibold text-surface-500 uppercase tracking-wider">{label}</span>
        </div>
      </div>
      <div className="relative">
        <div className="text-3xl font-black text-surface-900 dark:text-white tracking-tight">{value}</div>
        <div className="flex items-center justify-between mt-2">
          {hint && <span className="text-xs text-surface-500 dark:text-surface-400">{hint}</span>}
          {trend !== undefined && (
            <span className={clsx("flex items-center gap-1 text-xs font-bold", trend >= 0 ? "text-emerald-500" : "text-rose-500")}>
              {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {Math.abs(trend)}%
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

const paymentMethodConfig: Record<Sale['paymentMethod'], { label: string; icon: any; color: string }> = {
  cash: { label: 'Espèces', icon: Banknote, color: '#10b981' },
  card: { label: 'Carte', icon: CreditCard, color: '#6366f1' },
  transfer: { label: 'Virement', icon: Landmark, color: '#3b82f6' },
  installment: { label: 'Échéance', icon: CalendarClock, color: '#f59e0b' },
  other: { label: 'Autre', icon: Receipt, color: '#64748b' },
};

// Tooltip customization for charts
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/90 dark:bg-surface-800/90 backdrop-blur-md p-3 border border-surface-200 dark:border-surface-700 rounded-xl shadow-glass">
        <p className="text-sm font-semibold text-surface-900 dark:text-white mb-1">{label}</p>
        {payload.map((entry: any, i: number) => (
          <p key={i} className="text-sm" style={{ color: entry.color }}>
            <span className="font-medium">{entry.name}:</span> {money(entry.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<DashboardPayload>('/dashboard')).data,
  });

  if (isLoading) return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-pulse rounded-full bg-brand-500/50" />
        <div className="text-surface-500 animate-pulse">Chargement des indicateurs...</div>
      </div>
    </div>
  );
  if (!data) return null;
  const { kpis, lowStock, recentSales, roleProfile, reports } = data;

  // Transform data for charts
  const paymentChartData = reports.paymentBreakdown.map(p => ({
    name: paymentMethodConfig[p.paymentMethod]?.label || p.paymentMethod,
    total: p.total,
    count: p.count,
    fill: paymentMethodConfig[p.paymentMethod]?.color || '#cbd5e1'
  }));

  // topProductsData is removed as it's unused at the moment

  return (
    <div className="h-full flex flex-col max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <PageHeader 
          title="Tableau de bord" 
          subtitle={`Aperçu en temps réel • Profil ${roleProfile.scope === 'global' ? 'Global' : 'Franchise'}`} 
        />
        <div className="flex gap-2">
          <button className="btn-secondary text-xs py-2 shadow-sm">
            <Filter className="w-4 h-4" /> Filtres
          </button>
          <button className="btn-primary text-xs py-2 shadow-sm">
            Générer Rapport
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <KpiCard index={0} label="CA Aujourd'hui" value={money(kpis.todaySalesTotal)} hint={`${kpis.todaySalesCount} ventes`} icon={Wallet} trend={12} />
        <KpiCard index={1} label="CA Ce Mois" value={money(kpis.monthSalesTotal)} hint={`${kpis.monthSalesCount} ventes`} icon={TrendingUp} trend={5} />
        <KpiCard index={2} label="Alertes Stock" value={String(kpis.lowStockCount)} hint="Produits à réapprovisionner" icon={PackageOpen} trend={-2} />
        <KpiCard index={3} label="Transferts en cours" value={String(kpis.pendingTransfers)} hint="Demandes en attente" icon={ArrowRightLeft} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        {/* Revenue Analytics */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="card lg:col-span-2 p-5 flex flex-col"
        >
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-bold text-surface-900 dark:text-white">Répartition des Paiements</h3>
              <p className="text-xs text-surface-500">Volume par méthode sur le mois en cours</p>
            </div>
          </div>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paymentChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(val) => `${val / 1000}k`} tick={{ fontSize: 12, fill: '#64748b' }} />
                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={50} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Cash Flow Widget */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="card p-5 bg-gradient-to-br from-surface-900 to-surface-800 text-white relative overflow-hidden border-0"
        >
          <div className="absolute top-0 right-0 p-32 bg-brand-500/20 rounded-full blur-3xl" />
          <h3 className="font-bold mb-1 relative z-10">Trésorerie du Jour</h3>
          <p className="text-xs text-surface-400 mb-6 relative z-10">Synthèse des flux de caisse</p>
          
          <div className="space-y-4 relative z-10">
            <div className="flex justify-between items-end border-b border-surface-700/50 pb-3">
              <span className="text-sm text-surface-300">Encaissements</span>
              <span className="text-lg font-bold text-emerald-400">{money(reports.cashToday.in)}</span>
            </div>
            <div className="flex justify-between items-end border-b border-surface-700/50 pb-3">
              <span className="text-sm text-surface-300">Décaissements</span>
              <span className="text-lg font-bold text-rose-400">{money(reports.cashToday.out)}</span>
            </div>
            <div className="flex justify-between items-end pt-2">
              <span className="font-medium text-surface-200">Solde Net</span>
              <span className="text-2xl font-black text-white">{money(reports.cashToday.net)}</span>
            </div>
            
            <div className="mt-4 pt-4 border-t border-surface-700/50">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-medium bg-amber-500/10 p-2 rounded-lg">
                <CalendarClock className="w-4 h-4" />
                <span>{reports.pendingInstallments} échéance(s) à traiter aujourd'hui</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Sales List */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="card flex flex-col"
        >
          <div className="flex items-center justify-between p-5 border-b border-surface-200 dark:border-surface-700">
            <h3 className="font-bold text-surface-900 dark:text-white">Ventes Récentes</h3>
            <button className="text-xs text-brand-600 hover:text-brand-700 font-medium">Voir tout</button>
          </div>
          <div className="flex-1 overflow-auto max-h-[300px] custom-scrollbar">
            {recentSales.length === 0 ? (
              <div className="p-8 text-center text-surface-500">Aucune vente récente.</div>
            ) : (
              <div className="divide-y divide-surface-100 dark:divide-surface-800/50">
                {recentSales.map((sale) => (
                  <div key={sale._id} className="p-4 hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center text-surface-500">
                        <Receipt className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-surface-900 dark:text-white">{sale.invoiceNumber || 'Ticket'}</div>
                        <div className="text-xs text-surface-500">{dateTime(sale.createdAt)}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-brand-600 dark:text-brand-400">{money(sale.total)}</div>
                      <div className="text-[10px] uppercase text-surface-400 mt-0.5">{typeof sale.franchiseId === 'object' ? sale.franchiseId?.name : '-'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* Low Stock Alerts */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="card flex flex-col"
        >
          <div className="flex items-center justify-between p-5 border-b border-surface-200 dark:border-surface-700">
            <h3 className="font-bold text-surface-900 dark:text-white flex items-center gap-2">
              Alertes Stock
              <span className="badge-danger px-2 py-0.5 text-[10px]">{lowStock.length}</span>
            </h3>
            <button className="text-xs text-brand-600 hover:text-brand-700 font-medium">Réapprovisionner</button>
          </div>
          <div className="flex-1 overflow-auto max-h-[300px] custom-scrollbar">
            {lowStock.length === 0 ? (
              <div className="p-8 text-center text-surface-500">Aucune alerte de stock.</div>
            ) : (
              <div className="divide-y divide-surface-100 dark:divide-surface-800/50">
                {lowStock.map((s) => (
                  <div key={s._id} className="p-4 hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-surface-900 dark:text-white">{s.product.name}</div>
                      <div className="text-xs text-surface-500 mt-0.5">{s.franchise?.name ?? '-'}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-sm font-bold text-rose-600">{s.quantity} en stock</div>
                        <div className="text-[10px] text-surface-400 mt-0.5">Seuil: {s.product.lowStockThreshold}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
