import { useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
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

interface TimeLogMapPoint {
  _id: string;
  type: TimeLogType;
  timestamp: string;
  note: string;
  gps: { lat: number; lng: number; address: string };
  user: { _id: string; fullName: string; role: string } | null;
  franchise: { _id: string; name: string; gps: { lat: number; lng: number } | null } | null;
  inZone: boolean | null;
  distanceMeters: number | null;
}

interface TimeLogZone {
  _id: string;
  name: string;
  gps: { lat: number; lng: number };
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

const mapTypeColor: Record<TimeLogType, string> = {
  entree: '#16A34A',
  sortie: '#DC2626',
  pause_debut: '#F59E0B',
  pause_fin: '#0284C7',
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
  const [live, setLive] = useState(true);
  const [radiusMeters, setRadiusMeters] = useState(300);
  const [selectedMapPointId, setSelectedMapPointId] = useState('');

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
    refetchInterval: live ? 12_000 : false,
  });

  const mapData = useQuery({
    queryKey: ['timelogs-map', scope, month, franchiseId, radiusMeters],
    queryFn: async () =>
      (
        await api.get<{
          points: TimeLogMapPoint[];
          zones: TimeLogZone[];
          summary: { total: number; inZone: number; outOfZone: number; unknownZone: number; radiusMeters: number };
        }>('/timelogs/map', {
          params: {
            scope,
            month: month || undefined,
            franchiseId: isGlobal ? franchiseId || undefined : undefined,
            radiusMeters,
            limit: 1200,
          },
        })
      ).data,
    refetchInterval: live ? 12_000 : false,
  });

  const selectedMapPoint = useMemo(
    () => mapData.data?.points.find((point) => point._id === selectedMapPointId) ?? null,
    [mapData.data?.points, selectedMapPointId],
  );

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
      qc.invalidateQueries({ queryKey: ['timelogs-map'] });
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

  const zoneSummary = mapData.data?.summary;

  return (
    <>
      <PageHeader
        title="Pointage employes"
        subtitle="Suivi realtime + carte in-zone / out-of-zone"
        actions={
          canExport ? (
            <button className="btn-secondary" onClick={exportCsv}>
              Export CSV
            </button>
          ) : undefined
        }
      />

      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Total pointages" value={String(summary.total)} />
        <MetricCard label="Entrees" value={String(summary.byType.entree)} />
        <MetricCard label="Sorties" value={String(summary.byType.sortie)} />
        <MetricCard label="Pauses" value={String(summary.byType.pause_debut)} />
        <MetricCard
          label={scope === 'team' ? 'Employes actifs' : 'Dernier pointage'}
          value={scope === 'team' ? String(summary.activeUsers) : summary.last ? labels[summary.last.type] : 'Aucun'}
        />
        <MetricCard
          label="In-zone"
          value={zoneSummary ? `${zoneSummary.inZone}/${zoneSummary.total}` : '0/0'}
          accent={zoneSummary && zoneSummary.outOfZone > 0 ? 'text-amber-700' : 'text-emerald-700'}
        />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[170px_170px_minmax(0,1fr)_150px_120px]">
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
                <option key={franchise._id} value={franchise._id}>
                  {franchise.name}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" disabled value={scope === 'team' ? 'Franchise scope' : 'Filtre equipe indisponible'} />
          )}
          <input
            type="number"
            min={50}
            max={1000}
            step={50}
            className="input"
            value={radiusMeters}
            onChange={(event) => setRadiusMeters(Math.max(50, Math.min(1000, Number(event.target.value) || 300)))}
          />
          <button
            type="button"
            className={`btn-secondary ${live ? '!bg-slate-800 !text-white' : ''}`}
            onClick={() => setLive((v) => !v)}
          >
            {live ? 'Live ON' : 'Live OFF'}
          </button>
        </div>
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <input className="input" placeholder="Note (optionnelle)" value={note} onChange={(event) => setNote(event.target.value)} />
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
          <button key={type} className="btn-primary !justify-start !px-4 !py-3" disabled={addLog.isPending} onClick={() => addLog.mutate(type)}>
            Pointer: {labels[type]}
          </button>
        ))}
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card overflow-hidden p-0">
          <div className="h-[420px]">
            {mapData.isLoading ? (
              <div className="flex h-full items-center justify-center bg-slate-50">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
              </div>
            ) : (
              <MapContainer center={[36.8, 10.1]} zoom={7} scrollWheelZoom className="h-full w-full">
                <MapViewport points={mapData.data?.points ?? []} selected={selectedMapPoint} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {(mapData.data?.zones ?? []).map((zone) => (
                  <Circle
                    key={zone._id}
                    center={[zone.gps.lat, zone.gps.lng]}
                    radius={radiusMeters}
                    pathOptions={{ color: '#2AABE2', weight: 1.5, fillColor: '#2AABE2', fillOpacity: 0.08 }}
                  />
                ))}
                {(mapData.data?.points ?? []).map((point) => (
                  <CircleMarker
                    key={point._id}
                    center={[point.gps.lat, point.gps.lng]}
                    radius={selectedMapPointId === point._id ? 9 : 7}
                    eventHandlers={{ click: () => setSelectedMapPointId(point._id) }}
                    pathOptions={{
                      color: '#ffffff',
                      weight: 1.5,
                      fillColor:
                        point.inZone == null
                          ? mapTypeColor[point.type]
                          : point.inZone
                            ? '#10B981'
                            : '#EF4444',
                      fillOpacity: 0.95,
                    }}
                  >
                    <Popup>
                      <div className="space-y-1 text-sm">
                        <div className="font-semibold text-slate-900">{point.user?.fullName || 'Employe'}</div>
                        <div className="text-xs text-slate-500">{labels[point.type]} - {dateTime(point.timestamp)}</div>
                        <div>{point.franchise?.name || 'Franchise inconnue'}</div>
                        <div className="text-xs">
                          {point.distanceMeters == null ? 'Zone inconnue' : `${point.distanceMeters} m du point franchise`}
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            )}
          </div>
        </div>

        <aside className="card p-3">
          <div className="mb-2 text-sm font-semibold text-slate-900">Incidents hors zone</div>
          <div className="max-h-[390px] space-y-2 overflow-y-auto">
            {(mapData.data?.points ?? [])
              .filter((point) => point.inZone === false)
              .slice(0, 80)
              .map((point) => (
                <button
                  key={point._id}
                  type="button"
                  onClick={() => setSelectedMapPointId(point._id)}
                  className={`w-full rounded-xl border px-3 py-2 text-left ${
                    selectedMapPointId === point._id ? 'border-rose-300 bg-rose-50' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-sm font-medium text-slate-900">{point.user?.fullName || 'Employe'}</div>
                  <div className="text-xs text-slate-500">{point.franchise?.name || '-'}</div>
                  <div className="mt-1 text-xs text-rose-600">{point.distanceMeters ?? '-'} m</div>
                </button>
              ))}
            {((mapData.data?.summary.outOfZone ?? 0) === 0) && (
              <div className="px-2 py-4 text-sm text-emerald-700">Aucun point hors zone.</div>
            )}
          </div>
        </aside>
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
                    {typeof log.userId === 'object' && log.userId ? log.userId.fullName || log.userId.username || '-' : '-'}
                  </td>
                )}
                {scope === 'team' && (
                  <td className="td text-slate-600">
                    {typeof log.franchiseId === 'object' && log.franchiseId ? log.franchiseId.name : '-'}
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

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ?? 'text-slate-900'}`}>{value}</div>
    </div>
  );
}

function MapViewport({
  points,
  selected,
}: {
  points: Array<{ gps: { lat: number; lng: number } }>;
  selected: { gps: { lat: number; lng: number } } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (selected) {
      map.flyTo([selected.gps.lat, selected.gps.lng], 14, { duration: 0.6 });
      return;
    }
    if (points.length === 0) return;
    const bounds = points.map((point) => [point.gps.lat, point.gps.lng]) as [number, number][];
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [map, points, selected]);

  return null;
}
