import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { TablePagination } from '../components/TablePagination';
import { useAuth } from '../auth/AuthContext';
import type { Franchise, PageMeta } from '../lib/types';

type TimeLogType = 'entree' | 'sortie' | 'pause_debut' | 'pause_fin';
type ViewScope = 'self' | 'team';

interface TimeLogRow {
  _id: string;
  type: TimeLogType;
  timestamp: string;
  gps?: { lat?: number; lng?: number; address?: string };
  note?: string;
  device?: string;
  userId?: { _id: string; fullName?: string; username?: string; role?: string } | string;
  franchiseId?: { _id: string; name: string } | string;
}

const labels: Record<TimeLogType, string> = {
  entree: 'Entree',
  sortie: 'Sortie',
  pause_debut: 'Pause debut',
  pause_fin: 'Pause fin',
};

const badgeByType: Record<TimeLogType, string> = {
  entree: 'badge-success',
  sortie: 'badge-danger',
  pause_debut: 'badge-warning',
  pause_fin: 'badge-info',
};

export function TimeLogsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canViewTeam =
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'franchise';
  const canExport = canViewTeam;
  const isGlobal = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager';

  const [scope, setScope] = useState<ViewScope>(canViewTeam ? 'team' : 'self');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [franchiseId, setFranchiseId] = useState('');
  const [page, setPage] = useState(1);
  const [note, setNote] = useState('');
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const logs = useQuery({
    queryKey: ['timelogs', scope, month, franchiseId, page],
    queryFn: async () =>
      (
        await api.get<{
          logs: TimeLogRow[];
          meta: PageMeta;
          summary: {
            total: number;
            activeUsers: number;
            byType: Record<TimeLogType, number>;
          };
        }>('/timelogs', {
          params: {
            scope,
            month: month || undefined,
            franchiseId: isGlobal ? franchiseId || undefined : undefined,
            page,
            pageSize: 50,
          },
        })
      ).data,
  });

  const summary = useMemo(() => {
    const fallback = { entree: 0, sortie: 0, pause_debut: 0, pause_fin: 0 };
    return {
      total: logs.data?.summary.total ?? 0,
      activeUsers: logs.data?.summary.activeUsers ?? 0,
      byType: {
        ...fallback,
        ...(logs.data?.summary.byType ?? {}),
      },
      last: logs.data?.logs[0] ?? null,
    };
  }, [logs.data]);

  const capturePosition = async () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocalisation indisponible sur ce navigateur');
      return;
    }
    setGeoError(null);
    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGps({
            lat: Number(position.coords.latitude.toFixed(6)),
            lng: Number(position.coords.longitude.toFixed(6)),
          });
          resolve();
        },
        (error) => {
          setGeoError(error.message || 'Impossible de lire la position');
          resolve();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    });
  };

  const addLog = useMutation({
    mutationFn: async (type: TimeLogType) => {
      await api.post('/timelogs', {
        type,
        note: note || undefined,
        gps: gps ? { lat: gps.lat, lng: gps.lng } : undefined,
      });
    },
    onSuccess: () => {
      setErr(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['timelogs'] });
    },
    onError: (error) => setErr(apiError(error).message),
  });

  const exportCsv = async () => {
    try {
      const response = await api.get('/timelogs/export', {
        params: {
          scope,
          month: month || undefined,
          franchiseId: isGlobal ? franchiseId || undefined : undefined,
        },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `pointage_${month}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setErr(apiError(error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Pointage employes"
        subtitle="Entree, sortie et pauses avec reporting equipe + export CSV"
        actions={
          canExport ? (
            <button className="btn-secondary" onClick={exportCsv}>
              Export CSV
            </button>
          ) : undefined
        }
      />

      <section className="mb-5 grid gap-4 md:grid-cols-5">
        <MetricCard label="Total pointages" value={String(summary.total)} />
        <MetricCard label="Entrees" value={String(summary.byType.entree)} />
        <MetricCard label="Sorties" value={String(summary.byType.sortie)} />
        <MetricCard label="Pauses" value={String(summary.byType.pause_debut)} />
        <MetricCard
          label={scope === 'team' ? 'Employes actifs' : 'Dernier pointage'}
          value={
            scope === 'team'
              ? String(summary.activeUsers)
              : summary.last
                ? labels[summary.last.type]
                : 'Aucun'
          }
        />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[170px_170px_minmax(0,1fr)]">
          <select
            className="input"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as ViewScope);
              setPage(1);
            }}
          >
            <option value="self">Mon pointage</option>
            {canViewTeam && <option value="team">Equipe</option>}
          </select>
          <input
            type="month"
            className="input"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              setPage(1);
            }}
          />
          {isGlobal && scope === 'team' ? (
            <select
              className="input"
              value={franchiseId}
              onChange={(event) => {
                setFranchiseId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Toutes franchises</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
              ))}
            </select>
          ) : (
            <input className="input" disabled value={scope === 'team' ? 'Franchise scope' : 'Filtre equipe indisponible'} />
          )}
        </div>
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <input
            className="input"
            placeholder="Note (optionnelle)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button className="btn-secondary" onClick={capturePosition}>
            Capturer GPS
          </button>
        </div>
        {gps && <div className="mt-2 text-sm text-slate-600">GPS: {gps.lat}, {gps.lng}</div>}
        {geoError && <div className="mt-2 text-sm text-rose-600">{geoError}</div>}
        {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
      </section>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(labels) as TimeLogType[]).map((type) => (
          <button
            key={type}
            className="btn-primary !justify-start !px-4 !py-3"
            disabled={addLog.isPending}
            onClick={() => addLog.mutate(type)}
          >
            Pointer: {labels[type]}
          </button>
        ))}
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Type</th>
              {scope === 'team' && <th className="th">Employe</th>}
              {scope === 'team' && <th className="th">Franchise</th>}
              <th className="th">GPS</th>
              <th className="th">Note</th>
              <th className="th">Appareil</th>
            </tr>
          </thead>
          <tbody>
            {(logs.data?.logs ?? []).map((log) => (
              <tr key={log._id}>
                <td className="td">{dateTime(log.timestamp)}</td>
                <td className="td">
                  <span className={badgeByType[log.type]}>{labels[log.type]}</span>
                </td>
                {scope === 'team' && (
                  <td className="td text-slate-600">
                    {typeof log.userId === 'object' && log.userId
                      ? log.userId.fullName || log.userId.username || '—'
                      : '—'}
                  </td>
                )}
                {scope === 'team' && (
                  <td className="td text-slate-600">
                    {typeof log.franchiseId === 'object' && log.franchiseId ? log.franchiseId.name : '—'}
                  </td>
                )}
                <td className="td text-slate-600">
                  {log.gps?.lat != null && log.gps?.lng != null ? `${log.gps.lat}, ${log.gps.lng}` : '-'}
                </td>
                <td className="td text-slate-600">{log.note || '-'}</td>
                <td className="td text-xs text-slate-500">{log.device || '-'}</td>
              </tr>
            ))}
            {!logs.isLoading && (logs.data?.logs.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={scope === 'team' ? 7 : 5}>
                  Aucun pointage pour ce filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={logs.data?.meta} onPageChange={setPage} className="px-4 py-3" />
      </section>
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
