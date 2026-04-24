import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import type { Role } from '../lib/types';
import {
  LayoutDashboard, Package, ShoppingCart, MonitorSmartphone, Users,
  Bell, Wrench, ArrowRightLeft, ClipboardList, Network, RotateCcw, Clock,
  Wallet, Truck, ClipboardCheck, Lock, CalendarDays, Tag, Layers,
  Briefcase, Store, MapPin, UserCog, History, LogOut, Menu, X
} from 'lucide-react';

const nav: { to: string; label: string; icon: any; roles?: Role[] }[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/stock', label: 'Stock', icon: Package },
  { to: '/sales', label: 'Ventes', icon: ShoppingCart },
  { to: '/pos', label: 'Caisse (POS)', icon: MonitorSmartphone },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/services', label: 'Services', icon: Wrench, roles: ['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer'] },
  { to: '/transfers', label: 'Transferts', icon: ArrowRightLeft },
  { to: '/demands', label: 'Demandes', icon: ClipboardList, roles: ['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer'] },
  { to: '/network-points', label: 'Reseau', icon: Network, roles: ['admin', 'superadmin', 'manager'] },
  { to: '/returns', label: 'Retours', icon: RotateCcw, roles: ['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer'] },
  { to: '/timelogs', label: 'Pointage', icon: Clock, roles: ['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur'] },
  { to: '/cashflows', label: 'Tresorerie', icon: Wallet, roles: ['admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/receptions', label: 'Bons de reception', icon: Truck, roles: ['admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/monthly-inventory', label: 'Inventaire mensuel', icon: ClipboardCheck, roles: ['admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/closings', label: 'Clotures', icon: Lock, roles: ['admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/installments', label: 'Echeances', icon: CalendarDays, roles: ['admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/products', label: 'Produits', icon: Tag },
  { to: '/categories', label: 'Categories', icon: Layers, roles: ['admin', 'superadmin', 'manager'] },
  { to: '/suppliers', label: 'Fournisseurs', icon: Briefcase, roles: ['admin', 'superadmin', 'manager'] },
  { to: '/franchises', label: 'Franchises', icon: Store, roles: ['admin', 'superadmin'] },
  { to: '/map', label: 'Carte', icon: MapPin, roles: ['admin', 'superadmin', 'manager'] },
  { to: '/users', label: 'Utilisateurs', icon: UserCog, roles: ['admin', 'superadmin'] },
  { to: '/audit', label: 'Journal audit', icon: History, roles: ['admin', 'superadmin'] },
];

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  if (!user) return null;

  const unread = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => (await api.get<{ count: number }>('/notifications/unread-count')).data.count,
    refetchInterval: 30000,
  });

  const items = nav.filter((item) => !item.roles || item.roles.includes(user.role));

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
      <div className="px-6 py-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-lg shadow-brand-500/30">
            <Store className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight text-surface-900 dark:text-white">ASEL</div>
            <div className="text-xs font-medium text-brand-600 dark:text-brand-400">Stock & Ventes</div>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-4 custom-scrollbar">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'group flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div className="flex items-center gap-3">
                    <Icon className={clsx("h-5 w-5 transition-colors", isActive ? "text-brand-600 dark:text-brand-400" : "text-surface-400 group-hover:text-surface-600")} strokeWidth={isActive ? 2.5 : 2} />
                    <span>{item.label}</span>
                  </div>
                  {item.to === '/notifications' && (unread.data ?? 0) > 0 && (
                    <span className="flex h-5 items-center justify-center rounded-full bg-rose-500 px-2 text-[10px] font-bold text-white shadow-sm shadow-rose-500/20">
                      {(unread.data ?? 0) > 99 ? '99+' : unread.data}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
      
      <div className="mt-auto border-t border-surface-200 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-900/50">
        <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm dark:bg-surface-800">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
            <span className="text-sm font-bold">{user.fullName.charAt(0).toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-bold text-surface-900 dark:text-white">{user.fullName}</div>
            <div className="truncate text-xs font-medium text-surface-500 capitalize">{user.role}</div>
          </div>
          <button
            onClick={logout}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
            title="Se déconnecter"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-surface-50 dark:bg-surface-950">
      <aside className="hidden w-[280px] flex-col border-r border-surface-200 bg-white shadow-sm transition-all dark:border-surface-800 dark:bg-surface-900 md:flex">
        {navContent}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-surface-200 bg-white/80 px-4 py-3 backdrop-blur-md dark:border-surface-800 dark:bg-surface-900/80 md:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-100 text-surface-600 transition-colors hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Ouvrir navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white shadow-sm">
                <Store className="h-4 w-4" />
              </div>
              <span className="font-bold text-surface-900 dark:text-white">ASEL</span>
            </div>
          </div>
          <button 
            type="button" 
            onClick={logout} 
            className="inline-flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400"
          >
            <LogOut className="h-3 w-3" />
            <span>Quitter</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto bg-surface-50/50 p-4 custom-scrollbar dark:bg-surface-950 md:p-8">
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

      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[100] bg-surface-900/60 backdrop-blur-sm md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="fixed inset-y-0 left-0 z-[110] flex w-[85%] max-w-[300px] flex-col bg-white shadow-2xl dark:bg-surface-900 md:hidden"
            >
              <div className="absolute right-4 top-4">
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-100 text-surface-600 transition-colors hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300"
                  onClick={() => setMobileMenuOpen(false)}
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
