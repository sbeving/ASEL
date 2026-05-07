import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';
import { 
  TrendingUp, TrendingDown, PackageOpen, ArrowRightLeft, 
  Wallet, CreditCard, Landmark, CalendarClock, Receipt, Filter, Banknote, Download, X,
  ScanLine, ShoppingCart, Boxes, Users, ClipboardList, ArrowUpRight, MapPin, Clock, UserCheck, Network as NetworkIcon
} from 'lucide-react';
import { api } from '../lib/api';
import { apiError } from '../lib/api';
import { money, dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../auth/AuthContext';
import type { DashboardPayload, Franchise, Role, Sale } from '../lib/types';
import clsx from 'clsx';
import { openPrintableReport } from '../lib/report';

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
      className="card group relative overflow-hidden p-4 sm:p-5"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-brand-500 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="relative mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-brand-100 text-brand-600 rounded-lg dark:bg-brand-900/50 dark:text-brand-400">
            <Icon className="w-5 h-5" />
          </div>
          <span className="text-sm font-semibold text-surface-500 uppercase tracking-wider">{label}</span>
        </div>
      </div>
      <div className="relative">
        <div className="text-2xl font-black tracking-tight text-surface-900 dark:text-white sm:text-3xl">{value}</div>
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

type DashboardPeriod = 'today' | 'week' | 'month' | 'custom';

type DashboardFilters = {
  period: DashboardPeriod;
  from: string;
  to: string;
  franchiseId: string;
  paymentMethod: '' | Sale['paymentMethod'];
};

const periodLabel: Record<DashboardPeriod, string> = {
  today: "Aujourd'hui",
  week: 'Semaine',
  month: 'Mois',
  custom: 'Personnalise',
};

function isoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeekDate(value = new Date()) {
  const copy = new Date(value);
  const day = copy.getDay();
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function defaultDashboardFilters(): DashboardFilters {
  const now = new Date();
  return {
    period: 'month',
    from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: isoDate(now),
    franchiseId: '',
    paymentMethod: '',
  };
}

function rangeForPeriod(period: DashboardPeriod, current: DashboardFilters) {
  const now = new Date();
  if (period === 'today') {
    const today = isoDate(now);
    return { from: today, to: today };
  }
  if (period === 'week') return { from: isoDate(startOfWeekDate(now)), to: isoDate(now) };
  if (period === 'month') return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now) };
  return { from: current.from, to: current.to };
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function generateDashboardReport(data: DashboardPayload, filters: DashboardFilters, franchiseName: string) {
  const rows = [
    ['CA periode', money(data.kpis.monthSalesTotal)],
    ['Ventes periode', String(data.kpis.monthSalesCount)],
    ["CA aujourd'hui", money(data.kpis.todaySalesTotal)],
    ['Alertes stock', String(data.kpis.lowStockCount)],
    ['Transferts en cours', String(data.kpis.pendingTransfers)],
    ['Tresorerie nette', money(data.reports.cashToday.net)],
  ];
  const paymentRows = data.reports.paymentBreakdown
    .map((row) => `<tr><td>${escapeHtml(paymentMethodConfig[row.paymentMethod]?.label ?? row.paymentMethod)}</td><td>${row.count}</td><td>${money(row.total)}</td></tr>`)
    .join('');
  const productRows = data.reports.topProducts
    .map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.quantity}</td><td>${money(row.revenue)}</td></tr>`)
    .join('');
  const lowStockRows = data.lowStock
    .slice(0, 20)
    .map((row) => `<tr><td>${escapeHtml(row.product.name)}</td><td>${escapeHtml(row.franchise?.name ?? '-')}</td><td>${row.quantity}</td><td>${row.product.lowStockThreshold}</td></tr>`)
    .join('');
  const kpiRows = rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('');
  const html = `<!doctype html>
<html>
  <head>
    <title>Rapport dashboard ASEL</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }
      h1 { margin: 0 0 6px; font-size: 24px; }
      h2 { margin: 28px 0 10px; font-size: 16px; }
      .meta { color: #64748b; font-size: 12px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
      th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; font-size: 12px; }
      th { background: #f8fafc; }
    </style>
  </head>
  <body>
    <h1>Rapport dashboard ASEL</h1>
    <div class="meta">
      Periode: ${escapeHtml(filters.from)} -> ${escapeHtml(filters.to)} |
      Franchise: ${escapeHtml(franchiseName || 'Toutes')} |
      Paiement: ${escapeHtml(filters.paymentMethod ? paymentMethodConfig[filters.paymentMethod].label : 'Tous')} |
      Genere le ${escapeHtml(new Date().toLocaleString('fr-TN'))}
    </div>
    <h2>Indicateurs</h2>
    <table><tbody>${kpiRows}</tbody></table>
    <h2>Paiements</h2>
    <table><thead><tr><th>Methode</th><th>Nombre</th><th>Total</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="3">Aucune donnee</td></tr>'}</tbody></table>
    <h2>Top produits</h2>
    <table><thead><tr><th>Produit</th><th>Quantite</th><th>CA</th></tr></thead><tbody>${productRows || '<tr><td colspan="3">Aucune donnee</td></tr>'}</tbody></table>
    <h2>Alertes stock</h2>
    <table><thead><tr><th>Produit</th><th>Franchise</th><th>Stock</th><th>Seuil</th></tr></thead><tbody>${lowStockRows || '<tr><td colspan="4">Aucune alerte</td></tr>'}</tbody></table>
    <script>window.addEventListener('load', () => window.print());</script>
  </body>
</html>`;
  return openPrintableReport(html);
}

const quickLinks = [
  {
    to: '/pos',
    label: 'Vente rapide',
    description: 'Ouvrir la caisse, scanner, encaisser.',
    icon: ShoppingCart,
    roles: ['ceo', 'admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur'],
  },
  {
    to: '/receptions',
    label: 'Facture OCR',
    description: 'Importer une facture fournisseur en lignes stock.',
    icon: ScanLine,
    roles: ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer', 'franchise'],
  },
  {
    to: '/stock',
    label: 'Stock produit',
    description: 'Chercher quantites, seuils et mouvements.',
    icon: Boxes,
  },
  {
    to: '/clients',
    label: 'Client',
    description: 'Retrouver un client et ses ventes.',
    icon: Users,
  },
  {
    to: '/demands',
    label: 'Demande',
    description: 'Creer ou suivre un besoin de stock.',
    icon: ClipboardList,
    roles: ['ceo', 'admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur'],
  },
] satisfies Array<{ to: string; label: string; description: string; icon: any; roles?: Role[] }>;

function roleAllows(roles: Role[] | undefined, role: Role): boolean {
  return !roles || roles.includes(role);
}

function QuickLinkCard({ to, label, description, icon: Icon }: { to: string; label: string; description: string; icon: any }) {
  return (
    <Link
      to={to}
      className="group flex min-h-[88px] items-center gap-3 rounded-xl border border-surface-200 bg-white p-3 shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50 dark:border-surface-700 dark:bg-surface-900 dark:hover:border-brand-700 dark:hover:bg-brand-900/20"
    >
      <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-surface-100 text-surface-600 transition-colors group-hover:bg-brand-100 group-hover:text-brand-700 dark:bg-surface-800 dark:text-surface-300 dark:group-hover:bg-brand-900/40 dark:group-hover:text-brand-300">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-bold text-surface-900 dark:text-white">
          {label}
          <ArrowUpRight className="h-3.5 w-3.5 text-surface-400 transition-colors group-hover:text-brand-600" />
        </span>
        <span className="mt-0.5 block text-xs font-medium leading-4 text-surface-500">{description}</span>
      </span>
    </Link>
  );
}

function formatHours(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0h';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}`;
}

const pointageTypeLabel: Record<'entree' | 'sortie' | 'pause_debut' | 'pause_fin', string> = {
  entree: 'Entree',
  sortie: 'Sortie',
  pause_debut: 'Pause debut',
  pause_fin: 'Pause fin',
};

const pointStatusLabel: Record<string, string> = {
  prospect: 'Prospects',
  contact: 'Contactes',
  contrat_non_signe: 'Contrats non signes',
  contrat_signe: 'Contrats signes',
  actif: 'Actifs',
  suspendu: 'Suspendus',
  resilie: 'Resilies',
};

function RoleKpi({ label, value, icon: Icon, accent = '' }: { label: string; value: string; icon: any; accent?: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-surface-500">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className={clsx('mt-2 text-2xl font-black tracking-tight text-surface-900', accent)}>{value}</div>
    </div>
  );
}

function RoleAction({ to, label, description, icon: Icon }: { to: string; label: string; description: string; icon: any }) {
  return (
    <Link to={to} className="card flex min-h-[92px] items-center gap-3 p-4 hover:border-brand-200 hover:bg-brand-50">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-100 text-surface-700">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-surface-900">{label}</span>
        <span className="mt-1 block text-xs text-surface-500">{description}</span>
      </span>
    </Link>
  );
}

function PilotageList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ label: string; value: string; hint?: string }>;
  empty: string;
}) {
  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-bold text-surface-900">{title}</h2>
      <div className="space-y-2">
        {rows.slice(0, 8).map((row) => (
          <div key={`${row.label}-${row.value}`} className="flex items-center justify-between gap-3 rounded-lg border border-surface-200 bg-surface-50 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-surface-900">{row.label}</div>
              {row.hint && <div className="mt-0.5 truncate text-xs text-surface-500">{row.hint}</div>}
            </div>
            <div className="shrink-0 text-sm font-bold text-surface-900">{row.value}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="rounded-lg border border-dashed border-surface-200 px-3 py-6 text-center text-sm text-surface-500">{empty}</div>}
      </div>
    </div>
  );
}

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
  const { user } = useAuth();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<DashboardFilters>(() => defaultDashboardFilters());
  const canFilterFranchise = ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director'].includes(user?.role ?? '');
  const dashboardParams = useMemo(
    () => ({
      from: filters.from || undefined,
      to: filters.to || undefined,
      franchiseId: canFilterFranchise && filters.franchiseId ? filters.franchiseId : undefined,
      paymentMethod: filters.paymentMethod || undefined,
    }),
    [canFilterFranchise, filters.franchiseId, filters.from, filters.paymentMethod, filters.to],
  );
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['dashboard', dashboardParams],
    queryFn: async () => (await api.get<DashboardPayload>('/dashboard', { params: dashboardParams })).data,
  });
  const franchises = useQuery({
    enabled: canFilterFranchise,
    queryKey: ['franchises', 'dashboard-filter'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  if (isLoading) return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-pulse rounded-full bg-brand-500/50" />
        <div className="text-surface-500 animate-pulse">Chargement des indicateurs...</div>
      </div>
    </div>
  );
  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Tableau de bord" subtitle="Impossible de charger les indicateurs" />
        <div className="card p-5">
          <div className="text-sm font-semibold text-rose-700">Erreur dashboard</div>
          <p className="mt-2 text-sm text-surface-600">{apiError(error).message}</p>
          <button type="button" className="btn-primary mt-4" onClick={() => refetch()}>
            Recharger
          </button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Tableau de bord" subtitle="Aucune donnee recue" />
        <div className="card p-5 text-sm text-surface-600">Reessayez le chargement du dashboard.</div>
      </div>
    );
  }
  const { kpis, lowStock, recentSales, roleProfile, reports } = data;
  const visibleQuickLinks = quickLinks.filter((link) => (user ? roleAllows(link.roles, user.role) : true));
  const selectedFranchiseName =
    (franchises.data ?? []).find((franchise) => franchise._id === filters.franchiseId)?.name ?? '';
  const hasCustomFilters =
    filters.period !== 'month' || Boolean(filters.franchiseId) || Boolean(filters.paymentMethod);
  const displayedPeriod = `${filters.from} -> ${filters.to}`;
  const setPeriod = (period: DashboardPeriod) => {
    const range = rangeForPeriod(period, filters);
    setFilters((current) => ({ ...current, period, ...range }));
  };
  const resetFilters = () => setFilters(defaultDashboardFilters());
  const handleGenerateReport = () => {
    const opened = generateDashboardReport(data, filters, selectedFranchiseName);
    if (!opened) {
      window.alert('Le navigateur a bloque la fenetre du rapport. Autorisez les popups pour generer le rapport.');
    }
  };
  const showPaymentFilter = !['hr_admin', 'commercial', 'siege_employee', 'commercial_director'].includes(user?.role ?? '');
  const dashboardHeader = (title: string, subtitle: string) => (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <PageHeader title={title} subtitle={subtitle} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={clsx('btn-secondary py-2 text-xs shadow-sm', hasCustomFilters && '!border-brand-300 !bg-brand-50 !text-brand-700')}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <Filter className="h-4 w-4" />
            Filtres
            {hasCustomFilters && <span className="badge-info ml-1 !px-1.5 !py-0">actifs</span>}
          </button>
          <button type="button" className="btn-primary py-2 text-xs shadow-sm" onClick={handleGenerateReport}>
            <Download className="h-4 w-4" />
            Generer Rapport
          </button>
        </div>
      </div>

      {filtersOpen && (
        <section className="card mb-6 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-surface-900 dark:text-white">Filtres dashboard</h2>
              <p className="text-xs text-surface-500">Les KPIs, graphes, listes et rapport suivent les filtres disponibles pour votre role.</p>
            </div>
            <button type="button" className="btn-secondary !px-3 !py-2" onClick={() => setFiltersOpen(false)} aria-label="Fermer filtres">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-[220px_160px_160px_minmax(180px,1fr)_180px_auto]">
            <div>
              <label className="label">Periode</label>
              <select className="input" value={filters.period} onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}>
                {(Object.keys(periodLabel) as DashboardPeriod[]).map((period) => (
                  <option key={period} value={period}>{periodLabel[period]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Du</label>
              <input
                className="input"
                type="date"
                value={filters.from}
                onChange={(event) => setFilters((current) => ({ ...current, period: 'custom', from: event.target.value }))}
              />
            </div>
            <div>
              <label className="label">Au</label>
              <input
                className="input"
                type="date"
                value={filters.to}
                onChange={(event) => setFilters((current) => ({ ...current, period: 'custom', to: event.target.value }))}
              />
            </div>
            {canFilterFranchise && (
              <div>
                <label className="label">Franchise</label>
                <select
                  className="input"
                  value={filters.franchiseId}
                  onChange={(event) => setFilters((current) => ({ ...current, franchiseId: event.target.value }))}
                >
                  <option value="">Toutes franchises</option>
                  {(franchises.data ?? []).map((franchise) => (
                    <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
                  ))}
                </select>
              </div>
            )}
            {showPaymentFilter && (
              <div>
                <label className="label">Paiement</label>
                <select
                  className="input"
                  value={filters.paymentMethod}
                  onChange={(event) => setFilters((current) => ({ ...current, paymentMethod: event.target.value as DashboardFilters['paymentMethod'] }))}
                >
                  <option value="">Tous</option>
                  {(Object.keys(paymentMethodConfig) as Sale['paymentMethod'][]).map((method) => (
                    <option key={method} value={method}>{paymentMethodConfig[method].label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-end">
              <button type="button" className="btn-secondary w-full" onClick={resetFilters}>
                Reinitialiser
              </button>
            </div>
          </div>
          {isFetching && <div className="mt-3 text-xs font-medium text-brand-600">Actualisation des donnees...</div>}
        </section>
      )}
    </>
  );

  if (user && ['ceo', 'admin', 'superadmin', 'manager'].includes(user.role)) {
    const pilotage = data.roleStats?.pilotage;
    const bestFranchise = pilotage?.franchiseProfitability?.[0];
    const losingFranchise = pilotage?.franchiseProfitability?.slice(-1)[0];
    const title = user.role === 'ceo' ? 'Pilotage CEO' : 'Pilotage groupe';
    return (
      <div className="mx-auto max-w-[1600px]">
        {dashboardHeader(title, `Vue groupe filtree ${displayedPeriod}: ventes, rentabilite, stock, tresorerie, commerciaux et zones`)}
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <RoleKpi icon={TrendingUp} label="CA mois" value={money(kpis.monthSalesTotal)} />
          <RoleKpi icon={Wallet} label="Tresorerie nette" value={money(pilotage?.treasury.net ?? 0)} accent={(pilotage?.treasury.net ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
          <RoleKpi icon={PackageOpen} label="Valeur stock" value={money(pilotage?.stock.value ?? 0)} />
          <RoleKpi icon={Boxes} label="Marge stock" value={money(pilotage?.stock.marginPotential ?? 0)} accent="text-emerald-700" />
          <RoleKpi icon={MapPin} label="Zones mortes" value={String(pilotage?.deadZones.length ?? 0)} accent={(pilotage?.deadZones.length ?? 0) > 0 ? 'text-rose-700' : 'text-emerald-700'} />
          <RoleKpi icon={Users} label="Commerciaux dormants" value={String(pilotage?.dormantCommercials.length ?? 0)} accent={(pilotage?.dormantCommercials.length ?? 0) > 0 ? 'text-amber-700' : 'text-emerald-700'} />
        </section>

        <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-surface-900">CA par franchise</h2>
              <span className="badge-muted">Mois courant</span>
            </div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pilotage?.caByFranchise ?? []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="franchiseName" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Bar dataKey="ca" name="CA" fill="#059669" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-surface-500">Best commercial</div>
              <div className="mt-2 text-xl font-black text-surface-900">{pilotage?.bestCommercial?.commercialName ?? '-'}</div>
              <div className="mt-1 text-sm text-surface-500">
                {pilotage?.bestCommercial ? `${pilotage.bestCommercial.activePoints} points actifs / ${pilotage.bestCommercial.points} total` : 'Aucune activite'}
              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-surface-500">Best franchise</div>
              <div className="mt-2 text-xl font-black text-emerald-700">{bestFranchise?.franchiseName ?? '-'}</div>
              <div className="mt-1 text-sm text-surface-500">{bestFranchise ? `Marge ${money(bestFranchise.margin)}` : 'Aucune vente'}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-surface-500">Franchise perdante</div>
              <div className="mt-2 text-xl font-black text-rose-700">{losingFranchise?.franchiseName ?? '-'}</div>
              <div className="mt-1 text-sm text-surface-500">{losingFranchise ? `Marge ${money(losingFranchise.margin)}` : 'Aucune vente'}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <PilotageList
            title="Achats par fournisseur"
            rows={(pilotage?.purchasesBySupplier ?? []).map((row) => ({ label: row.supplierName, value: money(row.total), hint: `${row.count} reception(s)` }))}
            empty="Aucun achat valide ce mois."
          />
          <PilotageList
            title="Zones a reprendre"
            rows={(pilotage?.deadZones ?? []).map((row) => ({ label: row.name, value: `${row.pointCount} point(s)`, hint: row.ownerCount === 0 ? 'Aucun owner' : 'Sans activite' }))}
            empty="Aucune zone morte."
          />
          <PilotageList
            title="Produits dormants"
            rows={(pilotage?.dormantProducts ?? []).map((row) => ({ label: row.name, value: money(row.sellPrice ?? 0), hint: row.reference || row.barcode || 'Sans vente 90j' }))}
            empty="Aucun produit dormant."
          />
        </section>
      </div>
    );
  }

  if (user?.role === 'hr_admin') {
    const stats = data.roleStats?.hr;
    return (
      <div className="mx-auto max-w-7xl">
        {dashboardHeader('Dashboard RH', `Pointage, presence et demandes conge sur ${displayedPeriod}`)}
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <RoleKpi icon={Users} label="Employes" value={String(stats?.employeeCount ?? 0)} />
          <RoleKpi icon={UserCheck} label="En travail" value={String(stats?.atWorkCount ?? 0)} accent="text-emerald-700" />
          <RoleKpi icon={Clock} label="Heures semaine" value={`${stats?.weekHours ?? 0}h`} />
          <RoleKpi icon={CalendarClock} label="Conges attente" value={String(stats?.pendingLeaveRequests ?? 0)} accent="text-amber-700" />
        </section>
        <section className="grid gap-3 md:grid-cols-3">
          <RoleAction to="/hr" label="Module RH" description="Timesheets, pointage equipe et conges." icon={Users} />
          <RoleAction to="/timelogs" label="Pointage" description="Carte et historique des pointages." icon={Clock} />
          <RoleAction to="/users" label="Employes" description="Comptes staff et roles d'acces." icon={UserCheck} />
        </section>
        <section className="mt-5 grid gap-4 lg:grid-cols-3">
          <PilotageList
            title="Effectif par role"
            rows={(stats?.byRole ?? []).map((row) => ({ label: row.role, value: String(row.count) }))}
            empty="Aucun employe actif."
          />
          <PilotageList
            title="Derniers pointages"
            rows={(stats?.latestPunches ?? []).map((row) => ({
              label: row.employeeName || '-',
              value: pointageTypeLabel[row.type],
              hint: `${row.site || 'Site'} - ${dateTime(row.timestamp)}`,
            }))}
            empty="Aucun pointage recent."
          />
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-bold text-surface-900">Alertes tracabilite</h2>
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Commerciaux hors zone</div>
              <div className="mt-1 text-3xl font-black text-amber-800">{stats?.outOfZoneCommercialPings ?? 0}</div>
              <p className="mt-1 text-xs text-amber-700">Pings commerciaux hors zone sur la periode filtree.</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (user?.role === 'commercial_director') {
    const stats = data.roleStats?.commercialDirector;
    return (
      <div className="mx-auto max-w-[1600px]">
        {dashboardHeader('Direction commerciale', `Zones, commerciaux et tracabilite terrain sur ${displayedPeriod}`)}
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <RoleKpi icon={Users} label="Commerciaux" value={String(stats?.commercialCount ?? 0)} />
          <RoleKpi icon={UserCheck} label="Actifs semaine" value={String(stats?.activeCommercialsThisWeek ?? 0)} accent="text-emerald-700" />
          <RoleKpi icon={MapPin} label="Zones" value={String(stats?.zonesCount ?? 0)} />
          <RoleKpi icon={MapPin} label="Zones non liees" value={String(stats?.unassignedZones ?? 0)} accent={(stats?.unassignedZones ?? 0) > 0 ? 'text-rose-700' : 'text-emerald-700'} />
          <RoleKpi icon={NetworkIcon} label="Points reseau" value={String(stats?.networkPoints ?? 0)} />
          <RoleKpi icon={Clock} label="Hors zone" value={String(stats?.outOfZonePings ?? 0)} accent={(stats?.outOfZonePings ?? 0) > 0 ? 'text-rose-700' : 'text-emerald-700'} />
        </section>
        <section className="mb-5 grid gap-3 md:grid-cols-3">
          <RoleAction to="/map" label="Carte commerciale" description="Zones, points et maintenance des affectations." icon={MapPin} />
          <RoleAction to="/network-points" label="Points reseau" description="Suivre leads, statuts et documents terrain." icon={NetworkIcon} />
          <RoleAction to="/timelogs" label="Tracabilite" description="Pointage et controle des positions commerciales." icon={Clock} />
        </section>
        <section className="grid gap-4 xl:grid-cols-4">
          <div className="card p-4 xl:col-span-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-surface-500">Best commercial</div>
            <div className="mt-2 text-xl font-black text-surface-900">{stats?.bestCommercial?.commercialName ?? '-'}</div>
            <div className="mt-1 text-sm text-surface-500">
              {stats?.bestCommercial ? `${stats.bestCommercial.activePoints} actifs / ${stats.bestCommercial.points} points` : 'Aucune activite'}
            </div>
          </div>
          <PilotageList
            title="Pipeline points"
            rows={(stats?.pointsByStatus ?? []).map((row) => ({ label: pointStatusLabel[row.status] ?? row.status, value: String(row.count) }))}
            empty="Aucun point reseau."
          />
          <PilotageList
            title="Commerciaux dormants"
            rows={(stats?.dormantCommercials ?? []).map((row) => ({ label: row.commercialName || '-', value: `${row.points} point(s)`, hint: row.lastActivityAt ? dateTime(row.lastActivityAt) : 'Aucune activite 30j' }))}
            empty="Aucun dormant."
          />
          <PilotageList
            title="Dernieres positions"
            rows={(stats?.latestPings ?? []).map((row) => ({
              label: row.commercialName || '-',
              value: row.inZone === false ? 'Hors zone' : row.inZone === true ? 'Dans zone' : 'Zone inconnue',
              hint: `${row.zoneName || 'Sans zone'} - ${dateTime(row.timestamp)}${row.accuracy != null ? ` - ${row.accuracy}m` : ''}`,
            }))}
            empty="Aucune position terrain."
          />
        </section>
      </div>
    );
  }

  if (user?.role === 'commercial') {
    const stats = data.roleStats?.commercial;
    return (
      <div className="mx-auto max-w-7xl">
        {dashboardHeader('Dashboard commercial', 'Carte, zones et points activation/recharge')}
        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          <RoleKpi icon={MapPin} label="Points reseau" value={String(stats?.networkPoints ?? 0)} />
          <RoleKpi icon={MapPin} label="Points GPS" value={String(stats?.pointsWithGps ?? 0)} accent="text-emerald-700" />
          <RoleKpi icon={ClipboardList} label="Zones assignees" value={String(stats?.zones ?? 0)} />
        </section>
        <section className="grid gap-3 md:grid-cols-3">
          <RoleAction to="/map" label="Ma carte" description="Voir zones et points de recharge/activation." icon={MapPin} />
          <RoleAction to="/network-points" label="Points reseau" description="Ajouter lead, statut, notes et contacts." icon={NetworkIcon} />
          <RoleAction to="/timelogs" label="Pointage" description="Pointer et verifier votre tracabilite." icon={Clock} />
        </section>
      </div>
    );
  }

  if (user?.role === 'siege_employee') {
    const stats = data.roleStats?.employee;
    return (
      <div className="mx-auto max-w-7xl">
        {dashboardHeader('Mon dashboard siege', 'Pointage, heures travaillees et demandes conge')}
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <RoleKpi icon={Clock} label="Heures semaine" value={formatHours(stats?.workedMinutesThisWeek ?? 0)} />
          <RoleKpi icon={UserCheck} label="Shift actif" value={stats?.activeShift ? 'Oui' : 'Non'} accent={stats?.activeShift ? 'text-emerald-700' : ''} />
          <RoleKpi icon={CalendarClock} label="Conges attente" value={String(stats?.pendingLeaveRequests ?? 0)} />
          <RoleKpi icon={MapPin} label="Site pointage" value={stats?.siteName ?? 'Siege'} />
        </section>
        <section className="mb-5 grid gap-3 md:grid-cols-2">
          <RoleAction to="/timelogs" label="Pointage" description="Verifier GPS, pointer entree/sortie/pauses." icon={Clock} />
          <RoleAction to="/timelogs" label="Demande conge" description="Envoyer et suivre vos demandes depuis pointage." icon={CalendarClock} />
        </section>
        <section className="card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-bold text-surface-900">Dernier pointage</div>
              <div className="mt-1 text-sm text-surface-500">
                {stats?.lastType ? pointageTypeLabel[stats.lastType] : 'Aucun pointage cette semaine'}
                {stats?.lastTimestamp ? ` - ${dateTime(stats.lastTimestamp)}` : ''}
              </div>
            </div>
            <span className={stats?.activeShift ? 'badge-success' : 'badge-muted'}>
              {stats?.activeShift ? 'En travail' : 'Hors shift'}
            </span>
          </div>
        </section>
      </div>
    );
  }

  if (user?.role === 'franchise') {
    const stats = data.roleStats?.franchise;
    return (
      <div className="mx-auto max-w-[1600px]">
        {dashboardHeader('Dashboard franchise', `Stock, marge potentielle, caisse et ventes sur ${displayedPeriod}`)}
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <RoleKpi icon={TrendingUp} label="CA periode" value={money(stats?.ca ?? 0)} />
          <RoleKpi icon={Receipt} label="Ventes" value={String(stats?.salesCount ?? 0)} />
          <RoleKpi icon={PackageOpen} label="Cout stock" value={money(stats?.stockCost ?? 0)} />
          <RoleKpi icon={Boxes} label="Profit potentiel" value={money(stats?.stockMarginPotential ?? 0)} accent="text-emerald-700" />
          <RoleKpi icon={Wallet} label="Tresorerie nette" value={money(stats?.treasury.net ?? 0)} accent={(stats?.treasury.net ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
          <RoleKpi icon={PackageOpen} label="Alertes stock" value={String(stats?.lowStockCount ?? 0)} accent={(stats?.lowStockCount ?? 0) > 0 ? 'text-rose-700' : 'text-emerald-700'} />
        </section>
        <section className="mb-5 grid gap-3 md:grid-cols-4">
          <RoleAction to="/stock" label="Stock" description="Quantites, cout et mouvements." icon={Boxes} />
          <RoleAction to="/pos" label="Caisse" description="Ventes, scan et encaissement." icon={ShoppingCart} />
          <RoleAction to="/cashflows" label="Tresorerie" description="Encaissements et decaissements." icon={Wallet} />
          <RoleAction to="/receptions" label="Achats" description="Bons de reception fournisseurs." icon={Receipt} />
        </section>
        <section className="grid gap-4 xl:grid-cols-3">
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-bold text-surface-900">Valeur stock</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-surface-50 px-3 py-2">
                <span className="text-sm text-surface-500">Quantite</span>
                <span className="font-bold text-surface-900">{stats?.stockQuantity ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-surface-50 px-3 py-2">
                <span className="text-sm text-surface-500">Vente theorique</span>
                <span className="font-bold text-surface-900">{money(stats?.stockSellValue ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2">
                <span className="text-sm font-semibold text-emerald-700">Marge potentielle</span>
                <span className="font-black text-emerald-800">{money(stats?.stockMarginPotential ?? 0)}</span>
              </div>
            </div>
          </div>
          <PilotageList
            title="Top marge produits"
            rows={(stats?.topMarginProducts ?? []).map((row) => ({ label: row.name, value: money(row.margin), hint: `${row.quantity} vendu(s) - CA ${money(row.revenue)}` }))}
            empty="Aucune vente sur la periode."
          />
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-bold text-surface-900">Achats et caisse</h2>
            <div className="space-y-2">
              <div className="flex justify-between rounded-lg border border-surface-200 px-3 py-2 text-sm">
                <span className="text-surface-500">Achats valides</span>
                <span className="font-bold text-surface-900">{money(stats?.purchasesTotal ?? 0)}</span>
              </div>
              <div className="flex justify-between rounded-lg border border-surface-200 px-3 py-2 text-sm">
                <span className="text-surface-500">Encaissements</span>
                <span className="font-bold text-emerald-700">{money(stats?.treasury.encaissements ?? 0)}</span>
              </div>
              <div className="flex justify-between rounded-lg border border-surface-200 px-3 py-2 text-sm">
                <span className="text-surface-500">Decaissements</span>
                <span className="font-bold text-rose-700">{money(stats?.treasury.decaissements ?? 0)}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (user?.role === 'seller' || user?.role === 'vendeur') {
    const stats = data.roleStats?.seller;
    return (
      <div className="mx-auto max-w-7xl">
        {dashboardHeader('Mon dashboard vendeur', `Vos ventes et actions de caisse sur ${displayedPeriod}`)}
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <RoleKpi icon={Wallet} label="CA aujourd'hui" value={money(stats?.todaySalesTotal ?? 0)} />
          <RoleKpi icon={Receipt} label="Ventes aujourd'hui" value={String(stats?.todaySalesCount ?? 0)} />
          <RoleKpi icon={TrendingUp} label="CA mois" value={money(stats?.monthSalesTotal ?? 0)} />
          <RoleKpi icon={ShoppingCart} label="Ticket moyen" value={money(stats?.averageTicket ?? 0)} />
        </section>
        <section className="mb-5 grid gap-3 md:grid-cols-3">
          <RoleAction to="/pos" label="Caisse" description="Scanner, vendre et encaisser." icon={ShoppingCart} />
          <RoleAction to="/sales" label="Mes ventes" description="Historique des tickets et factures." icon={Receipt} />
          <RoleAction to="/timelogs" label="Pointage" description="Suivre vos heures de travail." icon={Clock} />
        </section>
      </div>
    );
  }

  // Transform data for charts
  const paymentChartData = reports.paymentBreakdown.map(p => ({
    name: paymentMethodConfig[p.paymentMethod]?.label || p.paymentMethod,
    total: p.total,
    count: p.count,
    fill: paymentMethodConfig[p.paymentMethod]?.color || '#cbd5e1'
  }));

  // topProductsData is removed as it's unused at the moment

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col">
      {dashboardHeader('Tableau de bord', `Apercu ${displayedPeriod} - Profil ${roleProfile.scope === 'global' ? 'Global' : 'Franchise'}`)}

      <section className="mb-6">
        <div className="mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-surface-500">Acces rapides</h2>
          <p className="text-xs font-medium text-surface-400">Actions visibles sur PC, tablette et mobile.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {visibleQuickLinks.map((link) => (
            <QuickLinkCard key={link.to} {...link} />
          ))}
        </div>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard index={0} label={hasCustomFilters ? 'CA Periode' : 'CA Ce Mois'} value={money(kpis.monthSalesTotal)} hint={`${kpis.monthSalesCount} ventes`} icon={TrendingUp} trend={5} />
        <KpiCard index={1} label="CA Aujourd'hui" value={money(kpis.todaySalesTotal)} hint={`${kpis.todaySalesCount} ventes`} icon={Wallet} trend={12} />
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
              <p className="text-xs text-surface-500">Volume par methode sur la periode filtree</p>
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
          className="card relative overflow-hidden border-0 bg-surface-900 p-5 text-white"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-brand-400" />
          <h3 className="font-bold mb-1 relative z-10">Tresorerie periode</h3>
          <p className="text-xs text-surface-400 mb-6 relative z-10">Synthese des flux de caisse filtres</p>
          
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
