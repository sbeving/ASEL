import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import type { Role } from '../lib/types';
import { useTheme } from '../lib/theme';
import {
  LayoutDashboard, Package, ShoppingCart, MonitorSmartphone, Users,
  Bell, Wrench, ArrowRightLeft, ClipboardList, Network, RotateCcw, Clock,
  Wallet, Truck, ClipboardCheck, Lock, CalendarDays, Tag, Layers,
  Briefcase, Store, MapPin, UserCog, History, LogOut, Menu, X, Sun, Moon, ShieldCheck,
  PanelLeftClose, PanelLeftOpen,
  ChevronRight
} from 'lucide-react';

const DASHBOARD_ROLES: Role[] = ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'stock_central_maintainer', 'cash_central_maintainer', 'hr_admin', 'franchise', 'seller', 'vendeur', 'commercial', 'siege_employee', 'viewer'];
const ERP_ROLES: Role[] = ['ceo', 'admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer'];
const STOCK_VIEW_ROLES: Role[] = ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer', 'franchise', 'seller', 'vendeur', 'viewer'];
const SELLING_ROLES: Role[] = ['ceo', 'admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur'];
const STAFF_ROLES: Role[] = ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'stock_central_maintainer', 'cash_central_maintainer', 'hr_admin', 'franchise', 'seller', 'vendeur', 'commercial', 'siege_employee'];
const COMMERCIAL_ROLES: Role[] = ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'franchise', 'commercial'];
const FRANCHISE_OPS_ROLES: Role[] = ['ceo', 'admin', 'superadmin', 'manager', 'franchise'];
const STOCK_OPS_ROLES: Role[] = ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer', 'franchise'];
const CASH_ROLES: Role[] = ['ceo', 'admin', 'superadmin', 'manager', 'cash_central_maintainer', 'franchise'];
const HR_ROLES: Role[] = ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'hr_admin', 'franchise'];
const NOTIFICATION_ROLES: Role[] = [...STAFF_ROLES, 'viewer'];

const nav: { to: string; label: string; icon: any; section: string; roles?: Role[] }[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, section: 'Pilotage', roles: DASHBOARD_ROLES },
  { to: '/notifications', label: 'Notifications', icon: Bell, section: 'Pilotage', roles: NOTIFICATION_ROLES },
  { to: '/pos', label: 'Caisse (POS)', icon: MonitorSmartphone, section: 'Franchise', roles: SELLING_ROLES },
  { to: '/sales', label: 'Ventes', icon: ShoppingCart, section: 'Franchise', roles: ERP_ROLES },
  { to: '/clients', label: 'Clients', icon: Users, section: 'Franchise', roles: ERP_ROLES },
  { to: '/services', label: 'Services', icon: Wrench, section: 'Franchise', roles: ERP_ROLES },
  { to: '/demands', label: 'Demandes stock', icon: ClipboardList, section: 'Franchise', roles: SELLING_ROLES },
  { to: '/returns', label: 'Retours', icon: RotateCcw, section: 'Franchise', roles: ERP_ROLES },
  { to: '/closings', label: 'Clotures caisse', icon: Lock, section: 'Franchise', roles: FRANCHISE_OPS_ROLES },
  { to: '/installments', label: 'Echeances clients', icon: CalendarDays, section: 'Franchise', roles: FRANCHISE_OPS_ROLES },
  { to: '/receptions', label: 'Bons de reception', icon: Truck, section: 'Contrats & Achats', roles: STOCK_OPS_ROLES },
  { to: '/suppliers', label: 'Fournisseurs', icon: Briefcase, section: 'Contrats & Achats', roles: ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer'] },
  { to: '/products', label: 'Produits', icon: Tag, section: 'Contrats & Achats', roles: STOCK_VIEW_ROLES },
  { to: '/categories', label: 'Categories', icon: Layers, section: 'Contrats & Achats', roles: ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer'] },
  { to: '/stock', label: 'Stock', icon: Package, section: 'Stock & Logistique', roles: STOCK_VIEW_ROLES },
  { to: '/transfers', label: 'Transferts', icon: ArrowRightLeft, section: 'Stock & Logistique', roles: STOCK_OPS_ROLES },
  { to: '/monthly-inventory', label: 'Inventaire mensuel', icon: ClipboardCheck, section: 'Stock & Logistique', roles: STOCK_OPS_ROLES },
  { to: '/cashflows', label: 'Tresorerie', icon: Wallet, section: 'Finance', roles: CASH_ROLES },
  { to: '/timelogs', label: 'Pointage', icon: Clock, section: 'RH', roles: STAFF_ROLES },
  { to: '/hr', label: 'Gestion RH', icon: Users, section: 'RH', roles: HR_ROLES },
  { to: '/network-points', label: 'Points reseau', icon: Network, section: 'Commercial terrain', roles: COMMERCIAL_ROLES },
  { to: '/map', label: 'Carte & zones', icon: MapPin, section: 'Commercial terrain', roles: COMMERCIAL_ROLES },
  { to: '/franchises', label: 'Franchises', icon: Store, section: 'Administration', roles: ['ceo', 'admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/users', label: 'Utilisateurs', icon: UserCog, section: 'Administration', roles: ['ceo', 'admin', 'superadmin', 'manager', 'hr_admin'] },
  { to: '/audit', label: 'Journal audit', icon: History, section: 'Administration', roles: ['ceo', 'admin', 'superadmin'] },
];

const navSectionOrder = [
  'Pilotage',
  'Franchise',
  'Contrats & Achats',
  'Stock & Logistique',
  'Finance',
  'RH',
  'Commercial terrain',
  'Administration',
];

const erpMobileTabs = ['/', '/pos', '/stock', '/receptions', '/notifications'];

function roleAllows(roles: Role[] | undefined, role: Role): boolean {
  return !roles || roles.includes(role);
}

type TimeLogType = 'entree' | 'sortie' | 'pause_debut' | 'pause_fin';

interface LayoutTimeLogRow {
  _id: string;
  type: TimeLogType;
  timestamp: string;
}

interface LayoutSaleRow {
  _id: string;
  total: number;
}

interface ProfileSummary {
  workedMinutes: number;
  salesCount: number;
  salesAmount: number;
  activeShift: boolean;
}

const PROFILE_TIMELOG_ROLES: Role[] = STAFF_ROLES;
const PROFILE_SALES_ROLES: Role[] = SELLING_ROLES;

function formatWorkedHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0h';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${String(remainingMinutes).padStart(2, '0')}`;
}

function formatCompactAmount(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  if (Math.abs(value) >= 1000) {
    const compact = value / 1000;
    return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1)}k TND`;
  }
  return `${Math.round(value)} TND`;
}

function computeWorkedMinutes(logs: LayoutTimeLogRow[]): { workedMinutes: number; activeShift: boolean } {
  const sorted = [...logs].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  let shiftStart: number | null = null;
  let breakStart: number | null = null;
  let pausedMs = 0;
  let totalMs = 0;

  for (const log of sorted) {
    const at = new Date(log.timestamp).getTime();
    if (!Number.isFinite(at)) continue;

    if (log.type === 'entree') {
      shiftStart = at;
      breakStart = null;
      pausedMs = 0;
      continue;
    }

    if (shiftStart === null) continue;

    if (log.type === 'pause_debut') {
      if (breakStart === null) breakStart = at;
      continue;
    }

    if (log.type === 'pause_fin') {
      if (breakStart !== null) {
        pausedMs += Math.max(0, at - breakStart);
        breakStart = null;
      }
      continue;
    }

    if (log.type === 'sortie') {
      const effectivePausedMs = pausedMs + (breakStart !== null ? Math.max(0, at - breakStart) : 0);
      totalMs += Math.max(0, at - shiftStart - effectivePausedMs);
      shiftStart = null;
      breakStart = null;
      pausedMs = 0;
    }
  }

  let activeShift = false;
  if (shiftStart !== null) {
    const now = Date.now();
    const eighteenHoursMs = 18 * 60 * 60 * 1000;
    if (now - shiftStart <= eighteenHoursMs) {
      const effectivePausedMs = pausedMs + (breakStart !== null ? Math.max(0, now - breakStart) : 0);
      totalMs += Math.max(0, now - shiftStart - effectivePausedMs);
      activeShift = true;
    }
  }

  return {
    workedMinutes: Math.round(totalMs / 60000),
    activeShift,
  };
}

function monthStartIso(): string {
  const value = new Date();
  value.setDate(1);
  value.setHours(0, 0, 0, 0);
  return value.toISOString();
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function ProfileStat({ label, value, accent = '' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">{label}</div>
      <div className={clsx('mt-1 truncate text-sm font-bold text-surface-900 dark:text-white', accent)}>{value}</div>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  if (!user) return null;

  const canViewNotifications = NOTIFICATION_ROLES.includes(user.role);
  const unread = useQuery({
    enabled: canViewNotifications,
    queryKey: ['notifications-unread-count'],
    queryFn: async () => (await api.get<{ count: number }>('/notifications/unread-count')).data.count,
    refetchInterval: 30000,
  });
  const canSeeWorkedHours = PROFILE_TIMELOG_ROLES.includes(user.role);
  const canSeeSalesSummary = PROFILE_SALES_ROLES.includes(user.role);
  const profileSummary = useQuery({
    queryKey: ['profile-summary', user.id, user.role, currentMonthKey()],
    queryFn: async (): Promise<ProfileSummary> => {
      const [salesResponse, timeLogsResponse] = await Promise.all([
        canSeeSalesSummary
          ? api.get<{ sales: LayoutSaleRow[] }>('/sales', {
              params: {
                userId: user.id,
                from: monthStartIso(),
                limit: 500,
              },
            })
          : Promise.resolve({ data: { sales: [] } }),
        canSeeWorkedHours
          ? api.get<{ logs: LayoutTimeLogRow[] }>('/timelogs', {
              params: {
                scope: 'self',
                month: currentMonthKey(),
                pageSize: 500,
              },
            })
          : Promise.resolve(null),
      ]);

      const sales = salesResponse.data.sales ?? [];
      const worked = timeLogsResponse ? computeWorkedMinutes(timeLogsResponse.data.logs ?? []) : { workedMinutes: 0, activeShift: false };

      return {
        workedMinutes: worked.workedMinutes,
        activeShift: worked.activeShift,
        salesCount: sales.length,
        salesAmount: sales.reduce((sum, sale) => sum + (sale.total ?? 0), 0),
      };
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const items = nav.filter((item) => roleAllows(item.roles, user.role));
  const currentItem = items.find((item) => (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)));
  const currentSection = currentItem?.section ?? 'Pilotage';
  const roleMobileTabs =
    user.role === 'siege_employee'
      ? ['/timelogs']
      : user.role === 'hr_admin'
        ? ['/', '/hr', '/timelogs', '/users']
      : user.role === 'commercial'
        ? ['/timelogs', '/network-points', '/map']
        : erpMobileTabs;
  const visibleMobileTabs = roleMobileTabs
    .map((path) => items.find((item) => item.to === path))
    .filter((item): item is (typeof items)[number] => Boolean(item));
  const navSections = navSectionOrder
    .map((section) => ({ section, items: items.filter((item) => item.section === section) }))
    .filter((section) => section.items.length > 0);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileMenuOpen]);

  const navContent = (
    <>
      <div className="flex-shrink-0 px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
            <Store className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight text-surface-900 dark:text-white">ASEL</div>
            <div className="text-xs font-medium text-brand-600 dark:text-brand-400">ERP Franchise</div>
          </div>
        </div>
      </div>
      
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-3 custom-scrollbar">
        {navSections.map((section) => (
          <div key={section.section} className="rounded-lg border border-transparent bg-transparent px-1 py-1">
            <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {section.section}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      clsx(
                        'group flex min-h-[44px] items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                          : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div className="flex min-w-0 items-center gap-3">
                          <Icon className={clsx("h-5 w-5 flex-shrink-0 transition-colors", isActive ? "text-brand-600 dark:text-brand-400" : "text-surface-400 group-hover:text-surface-600")} strokeWidth={isActive ? 2.5 : 2} />
                          <span className="truncate">{item.label}</span>
                        </div>
                        {item.to === '/notifications' && (unread.data ?? 0) > 0 && (
                          <span className="flex h-5 flex-shrink-0 items-center justify-center rounded-full bg-rose-500 px-2 text-[10px] font-bold text-white shadow-sm shadow-rose-500/20">
                            {(unread.data ?? 0) > 99 ? '99+' : unread.data}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      
      <div className="mt-auto flex-shrink-0 border-t border-surface-200 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-900/50">
        <div className="mb-3 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-surface-500">Theme & Profil</span>
          <button
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-200 text-surface-600 transition-colors hover:bg-surface-300 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
            aria-label="Changer theme"
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
          <div className="flex flex-col gap-3 rounded-lg border border-surface-200 bg-white p-3 shadow-sm dark:border-surface-700 dark:bg-surface-800">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                <span className="text-lg font-bold">{user.fullName.charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-bold text-surface-900 dark:text-white">{user.fullName}</div>
                <div className="flex items-center gap-1 mt-0.5 text-xs font-medium text-brand-600 dark:text-brand-400">
                  <ShieldCheck className="h-3 w-3" />
                  <span className="capitalize">{user.role}</span>
                </div>
                {profileSummary.data?.activeShift && (
                  <div className="mt-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Pointage actif</div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ProfileStat
                label="Heures"
                value={profileSummary.isLoading ? '...' : canSeeWorkedHours ? formatWorkedHours(profileSummary.data?.workedMinutes ?? 0) : '—'}
                accent={profileSummary.data?.activeShift ? 'text-emerald-700 dark:text-emerald-400' : ''}
              />
              <ProfileStat label="Ventes" value={profileSummary.isLoading ? '...' : String(profileSummary.data?.salesCount ?? 0)} />
              <ProfileStat label="CA" value={profileSummary.isLoading ? '...' : formatCompactAmount(profileSummary.data?.salesAmount ?? 0)} />
            </div>
            <button
              onClick={logout}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
          >
            <LogOut className="h-4 w-4" />
            Déconnexion
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-surface-50 dark:bg-surface-950 lg:h-[100dvh] lg:overflow-hidden">
      <AnimatePresence initial={false}>
        {desktopSidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="hidden flex-col overflow-hidden border-r border-surface-200 bg-white shadow-sm dark:border-surface-800 dark:bg-surface-900 lg:sticky lg:top-0 lg:flex lg:h-[100dvh]"
          >
            <div className="flex h-full w-[280px] min-h-0 flex-col">{navContent}</div>
          </motion.aside>
        )}
      </AnimatePresence>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-surface-200 bg-white/90 px-4 py-3 backdrop-blur-md dark:border-surface-800 dark:bg-surface-900/90 lg:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-surface-100 text-surface-600 transition-colors hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Ouvrir navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-surface-900 dark:text-white">{currentItem?.label ?? 'ASEL'}</div>
              <div className="truncate text-xs font-medium text-surface-500">ASEL Mobile</div>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Link
              to={canViewNotifications ? '/notifications' : '/timelogs'}
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg bg-surface-100 text-surface-600 transition-colors hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300"
              aria-label={canViewNotifications ? 'Notifications' : 'Pointage'}
            >
              {canViewNotifications ? <Bell className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
              {canViewNotifications && (unread.data ?? 0) > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-rose-500" />}
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-surface-100 text-surface-600 transition-colors hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300"
              aria-label="Changer theme"
            >
              {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </button>
          </div>
        </header>

        <header className="hidden border-b border-surface-200 bg-white/80 px-6 py-4 backdrop-blur-md dark:border-surface-800 dark:bg-surface-900/80 lg:block">
          <div className="flex items-center justify-between gap-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-surface-200 bg-white text-surface-600 shadow-sm transition-colors hover:bg-surface-50 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300 dark:hover:bg-surface-800"
                onClick={() => setDesktopSidebarOpen((value) => !value)}
                aria-label={desktopSidebarOpen ? 'Masquer le menu' : 'Afficher le menu'}
                title={desktopSidebarOpen ? 'Masquer le menu' : 'Afficher le menu'}
              >
                {desktopSidebarOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
              </button>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wider text-surface-400">{currentSection}</div>
                <div className="mt-1 flex items-center gap-2 text-lg font-bold text-surface-900 dark:text-white">
                  {currentItem?.label ?? 'ASEL Mobile'}
                  <ChevronRight className="h-4 w-4 text-surface-300" />
                  <span className="truncate text-sm font-semibold text-brand-600 dark:text-brand-400">{user.fullName}</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-surface-50/50 p-4 pb-28 custom-scrollbar dark:bg-surface-950 sm:p-5 lg:p-6 xl:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto max-w-7xl h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-200 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] backdrop-blur-xl dark:border-surface-800 dark:bg-surface-900/95 lg:hidden">
        <div className={clsx('grid gap-1', visibleMobileTabs.length <= 1 ? 'grid-cols-1' : visibleMobileTabs.length === 3 ? 'grid-cols-3' : visibleMobileTabs.length === 4 ? 'grid-cols-4' : 'grid-cols-5')}>
          {visibleMobileTabs.map((item) => {
            const Icon = item.icon;
            const isActive = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={clsx(
                  'flex min-h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[10px] font-bold transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'text-surface-500 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800',
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
                <span className="w-full truncate text-center">
                  {item.label.replace('Tableau de bord', 'Accueil').replace('Bons de reception', 'Reception')}
                </span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[100] bg-surface-900/60 backdrop-blur-sm lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="fixed inset-y-0 left-0 z-[110] flex h-[100dvh] w-[88%] max-w-[320px] flex-col overflow-hidden bg-white shadow-2xl dark:bg-surface-900 lg:hidden"
            >
              <div className="absolute right-4 top-4">
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-100 text-surface-600 transition-colors hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Fermer navigation"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {navContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
