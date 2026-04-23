import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/AuthContext';
import type { Role } from '../lib/types';

const nav: { to: string; label: string; roles?: Role[] }[] = [
  { to: '/', label: 'Tableau de bord' },
  { to: '/stock', label: 'Stock' },
  { to: '/sales', label: 'Ventes' },
  { to: '/pos', label: 'Caisse (POS)' },
  { to: '/transfers', label: 'Transferts' },
  { to: '/products', label: 'Produits' },
  { to: '/categories', label: 'Catégories', roles: ['admin', 'manager'] },
  { to: '/suppliers', label: 'Fournisseurs', roles: ['admin', 'manager'] },
  { to: '/franchises', label: 'Franchises', roles: ['admin'] },
  { to: '/users', label: 'Utilisateurs', roles: ['admin'] },
  { to: '/audit', label: 'Journal d’audit', roles: ['admin'] },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Auto-close the drawer on route change so it doesn't linger after
  // a nav click on mobile.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  if (!user) return null;

  const items = nav.filter((n) => !n.roles || n.roles.includes(user.role));

  const navBody = (
    <>
      <div className="px-5 py-6 border-b border-slate-800">
        <div className="text-lg font-semibold">ASEL Mobile</div>
        <div className="text-xs text-slate-400">Gestion de stock</div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3">
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              clsx(
                'block px-5 py-2 text-sm',
                isActive
                  ? 'bg-slate-800 text-white border-l-2 border-brand-500'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white',
              )
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-800 px-5 py-4">
        <div className="text-sm font-medium">{user.fullName}</div>
        <div className="text-xs text-slate-400 capitalize">{user.role}</div>
        <button
          type="button"
          onClick={logout}
          className="mt-3 btn btn-secondary w-full !bg-slate-800 !text-slate-200 !border-slate-700 hover:!bg-slate-700"
        >
          Se déconnecter
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-slate-900 text-slate-100">
        {navBody}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-slate-900/60"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute left-0 top-0 bottom-0 w-64 flex flex-col bg-slate-900 text-slate-100">
            {navBody}
          </aside>
        </div>
      )}

      <main className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Ouvrir la navigation"
            className="p-1 -ml-1"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>
          <div className="font-semibold">ASEL Mobile</div>
          <button onClick={logout} className="text-sm underline">Quitter</button>
        </header>
        <div className="flex-1 p-5 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
