import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import type { Role } from '../lib/types';

const nav: { to: string; label: string; roles?: Role[] }[] = [
  { to: '/', label: 'Tableau de bord' },
  { to: '/stock', label: 'Stock' },
  { to: '/sales', label: 'Ventes' },
  { to: '/pos', label: 'Caisse (POS)' },
  { to: '/clients', label: 'Clients' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/services', label: 'Services', roles: ['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer'] },
  { to: '/transfers', label: 'Transferts' },
  { to: '/demands', label: 'Demandes', roles: ['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer'] },
  { to: '/network-points', label: 'Reseau', roles: ['admin', 'superadmin', 'manager'] },
  { to: '/returns', label: 'Retours', roles: ['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer'] },
  { to: '/timelogs', label: 'Pointage', roles: ['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur'] },
  { to: '/cashflows', label: 'Tresorerie', roles: ['admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/receptions', label: 'Bons de reception', roles: ['admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/monthly-inventory', label: 'Inventaire mensuel', roles: ['admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/closings', label: 'Clotures', roles: ['admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/installments', label: 'Echeances', roles: ['admin', 'superadmin', 'manager', 'franchise'] },
  { to: '/products', label: 'Produits' },
  { to: '/categories', label: 'Categories', roles: ['admin', 'superadmin', 'manager'] },
  { to: '/suppliers', label: 'Fournisseurs', roles: ['admin', 'superadmin', 'manager'] },
  { to: '/franchises', label: 'Franchises', roles: ['admin', 'superadmin'] },
  { to: '/map', label: 'Carte', roles: ['admin', 'superadmin', 'manager'] },
  { to: '/users', label: 'Utilisateurs', roles: ['admin', 'superadmin'] },
  { to: '/audit', label: 'Journal audit', roles: ['admin', 'superadmin'] },
];

export function Layout() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const unread = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => (await api.get<{ count: number }>('/notifications/unread-count')).data.count,
    refetchInterval: 30000,
  });

  const items = nav.filter((item) => !item.roles || item.roles.includes(user.role));

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 flex-col bg-slate-900 text-slate-100 md:flex">
        <div className="border-b border-slate-800 px-5 py-6">
          <div className="text-lg font-semibold">ASEL Mobile</div>
          <div className="text-xs text-slate-400">Gestion de stock</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center justify-between gap-2 px-5 py-2 text-sm',
                  isActive
                    ? 'border-l-2 border-brand-500 bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                )
              }
            >
              <span>{item.label}</span>
              {item.to === '/notifications' && (unread.data ?? 0) > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {(unread.data ?? 0) > 99 ? '99+' : unread.data}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-5 py-4">
          <div className="text-sm font-medium">{user.fullName}</div>
          <div className="text-xs capitalize text-slate-400">{user.role}</div>
          <button
            type="button"
            onClick={logout}
            className="btn btn-secondary mt-3 w-full !border-slate-700 !bg-slate-800 !text-slate-200 hover:!bg-slate-700"
          >
            Se deconnecter
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white md:hidden">
          <div className="font-semibold">ASEL Mobile</div>
          <button onClick={logout} className="text-sm underline">
            Quitter
          </button>
        </header>
        <div className="flex-1 p-5 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
