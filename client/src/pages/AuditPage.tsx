import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { TablePagination } from '../components/TablePagination';
import { useAuth } from '../auth/AuthContext';
import type { AuditLog, Franchise, PageMeta } from '../lib/types';

interface AuditResponse {
  logs: AuditLog[];
  meta: PageMeta;
  filters: {
    actions: string[];
    entities: string[];
  };
}

function detailText(details: unknown) {
  if (!details) return '';
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

export function AuditPage() {
  const { user } = useAuth();
  const canFilterFranchise =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager';
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [entityId, setEntityId] = useState('');
  const [franchiseId, setFranchiseId] = useState('');
  const [username, setUsername] = useState('');
  const [ip, setIp] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const debouncedQ = useDebouncedValue(q.trim(), 250);
  const filterKey = [
    debouncedQ,
    action,
    entity,
    entityId,
    franchiseId,
    username,
    ip,
    fromDate,
    toDate,
    pageSize,
  ].join('|');

  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      ...(debouncedQ ? { q: debouncedQ } : {}),
      ...(action ? { action } : {}),
      ...(entity ? { entity } : {}),
      ...(entityId.trim() ? { entityId: entityId.trim() } : {}),
      ...(franchiseId ? { franchiseId } : {}),
      ...(username.trim() ? { username: username.trim() } : {}),
      ...(ip.trim() ? { ip: ip.trim() } : {}),
      ...(fromDate ? { from: fromDate } : {}),
      ...(toDate ? { to: toDate } : {}),
    }),
    [
      action,
      debouncedQ,
      entity,
      entityId,
      franchiseId,
      fromDate,
      ip,
      page,
      pageSize,
      toDate,
      username,
    ],
  );

  const franchises = useQuery({
    enabled: canFilterFranchise,
    queryKey: ['franchises', 'audit-filter'],
    queryFn: async () =>
      (await api.get<{ franchises: Franchise[] }>('/franchises')).data
        .franchises,
  });

  const audit = useQuery({
    queryKey: ['audit', params],
    queryFn: async () =>
      (await api.get<AuditResponse>('/audit', { params })).data,
    placeholderData: (previous) => previous,
  });
  const rows = audit.data?.logs ?? [];
  const hasFilters = Boolean(
    q ||
      action ||
      entity ||
      entityId ||
      franchiseId ||
      username ||
      ip ||
      fromDate ||
      toDate,
  );

  const resetFilters = () => {
    setQ('');
    setAction('');
    setEntity('');
    setEntityId('');
    setFranchiseId('');
    setUsername('');
    setIp('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Journal d’audit"
        subtitle="Événements sensibles, filtres et traçabilité"
      />

      <section className="card mb-5 p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-surface-800">
              <ShieldCheck className="h-4 w-4 text-brand-600" />
              Vue audit
            </div>
            <p className="mt-1 text-xs text-surface-500">
              {audit.data?.meta.total ?? 0} événement(s) visible(s). Les refresh
              techniques d’échéances sont masqués.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="input !min-h-[40px] !w-28 !py-2"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              aria-label="Taille de page"
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary !min-h-[40px] !px-3 !py-2"
              disabled={!hasFilters}
              onClick={resetFilters}
            >
              <RotateCcw className="h-4 w-4" />
              Réinitialiser
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-10">
          <label className="xl:col-span-2">
            <span className="label">Recherche</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
              <input
                className="input pl-10"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Action, entité, user, IP..."
              />
            </div>
          </label>
          <label>
            <span className="label">Action</span>
            <select
              className="input"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              <option value="">Toutes</option>
              {(audit.data?.filters.actions ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Entité</span>
            <select
              className="input"
              value={entity}
              onChange={(event) => setEntity(event.target.value)}
            >
              <option value="">Toutes</option>
              {(audit.data?.filters.entities ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">ID entité</span>
            <input
              className="input font-mono"
              value={entityId}
              onChange={(event) => setEntityId(event.target.value)}
              placeholder="...a1b2c3"
            />
          </label>
          {canFilterFranchise && (
            <label>
              <span className="label">Franchise</span>
              <select
                className="input"
                value={franchiseId}
                onChange={(event) => setFranchiseId(event.target.value)}
              >
                <option value="">Toutes</option>
                {(franchises.data ?? []).map((franchise) => (
                  <option key={franchise._id} value={franchise._id}>
                    {franchise.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span className="label">Utilisateur</span>
            <input
              className="input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
            />
          </label>
          <label>
            <span className="label">IP</span>
            <input
              className="input font-mono"
              value={ip}
              onChange={(event) => setIp(event.target.value)}
              placeholder="127.0.0.1"
            />
          </label>
          <label>
            <span className="label">Du</span>
            <input
              type="date"
              className="input"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>
          <label>
            <span className="label">Au</span>
            <input
              type="date"
              className="input"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label>
        </div>
      </section>

      {audit.isError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          Impossible de charger le journal d’audit.
        </div>
      )}

      <section className="grid gap-3 lg:hidden">
        {rows.map((log) => (
          <article key={log._id} className="mobile-record-card space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-surface-500">
                  {dateTime(log.createdAt)}
                </div>
                <div className="mt-1 font-semibold text-surface-900">
                  {log.username ?? 'Système'}
                </div>
              </div>
              <span className="badge-info max-w-[56%] justify-center text-center">
                {log.action}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-surface-400">Entité</div>
                <div className="font-semibold text-surface-700">
                  {log.entity ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-surface-400">IP</div>
                <div className="font-mono font-semibold text-surface-700">
                  {log.ip ?? '—'}
                </div>
              </div>
            </div>
            {log.details ? (
              <details className="rounded-lg bg-surface-50 p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-surface-600">
                  Détails
                </summary>
                <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap font-mono text-surface-500">
                  {detailText(log.details)}
                </pre>
              </details>
            ) : null}
          </article>
        ))}
        {!audit.isLoading && rows.length === 0 && (
          <div className="mobile-record-card text-sm text-surface-500">
            Aucun événement.
          </div>
        )}
      </section>

      <div className="card hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Utilisateur</th>
              <th className="th">Action</th>
              <th className="th">Entité</th>
              <th className="th">IP</th>
              <th className="th">Détails</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((log) => (
              <tr key={log._id}>
                <td className="td whitespace-nowrap text-slate-500">
                  {dateTime(log.createdAt)}
                </td>
                <td className="td">
                  <div className="font-semibold">
                    {log.username ?? 'Système'}
                  </div>
                  {log.userAgent && (
                    <div className="mt-1 max-w-48 truncate text-xs font-normal text-surface-400">
                      {log.userAgent}
                    </div>
                  )}
                </td>
                <td className="td">
                  <span className="badge-info">{log.action}</span>
                </td>
                <td className="td text-slate-500">
                  {log.entity
                    ? `${log.entity}${log.entityId ? ` · ${log.entityId.slice(-6)}` : ''}`
                    : '—'}
                </td>
                <td className="td font-mono text-xs text-slate-500">
                  {log.ip ?? '—'}
                </td>
                <td className="td max-w-xl text-xs text-slate-500">
                  {log.details ? (
                    <details>
                      <summary className="cursor-pointer font-semibold text-surface-600">
                        Voir détails
                      </summary>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 font-mono">
                        {detailText(log.details)}
                      </pre>
                    </details>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {audit.isLoading && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>
                  Chargement...
                </td>
              </tr>
            )}
            {!audit.isLoading && rows.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>
                  Aucun événement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TablePagination meta={audit.data?.meta} onPageChange={setPage} />
    </>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}
