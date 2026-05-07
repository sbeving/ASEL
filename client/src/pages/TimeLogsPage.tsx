import { useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api, apiError } from '../lib/api';
import { dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { TablePagination } from '../components/TablePagination';
import { useAuth } from '../auth/AuthContext';
import type { CommercialZone, Franchise, PageMeta, Role, User } from '../lib/types';

type TimeLogType = 'entree' | 'sortie' | 'pause_debut' | 'pause_fin';
type ViewScope = 'self' | 'team';

interface TimeLogRow {
  _id: string;
  type: TimeLogType;
  timestamp: string;
  gps?: { lat?: number; lng?: number; accuracy?: number | null; address?: string };
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
  gps: { lat: number; lng: number; accuracy?: number | null; address: string };
  user: { _id: string; fullName: string; role: string } | null;
  franchise: { _id: string; name: string; gps: { lat: number; lng: number } | null } | null;
  inZone: boolean | null;
  distanceMeters: number | null;
  displayGps?: { lat: number; lng: number };
  clusterLabel?: string;
}

interface TimeLogZone {
  _id: string;
  name: string;
  kind: 'franchise' | 'siege';
  gps: { lat: number; lng: number };
  radiusMeters: number;
}

interface SiegeZone {
  _id: 'siege';
  name: string;
  gps: { lat: number; lng: number };
  radiusMeters: number;
}

interface CommercialTrackPoint {
  _id: string;
  timestamp: string;
  gps: { lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null };
  inZone: boolean | null;
  batteryPct: number | null;
}

interface CommercialTrack {
  user: { _id: string; fullName: string; role: string } | null;
  zone: { _id: string; name: string; color?: string } | null;
  points: CommercialTrackPoint[];
  latest?: CommercialTrackPoint;
}

type LeaveRequestType = 'conge_annuel' | 'maladie' | 'sans_solde' | 'exceptionnel' | 'autre';
type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface LeaveRequestRow {
  _id: string;
  type: LeaveRequestType;
  fromDate: string;
  toDate: string;
  reason?: string;
  status: LeaveRequestStatus;
  createdAt: string;
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

const workerRoles: Role[] = ['hr_admin', 'franchise', 'seller', 'vendeur', 'commercial', 'siege_employee'];
const roleLabel: Partial<Record<Role, string>> = {
  hr_admin: 'HR admin',
  franchise: 'Responsable franchise',
  seller: 'Vendeur',
  vendeur: 'Vendeur',
  commercial: 'Commercial',
  siege_employee: 'Employe siege',
};

const workingZoneLabel = {
  siege: 'Zone siege',
  franchise: 'Zone franchise',
  commercial_zone: 'Zone commerciale',
} as const;

const leaveTypeLabel: Record<LeaveRequestType, string> = {
  conge_annuel: 'Conge annuel',
  maladie: 'Maladie',
  sans_solde: 'Sans solde',
  exceptionnel: 'Exceptionnel',
  autre: 'Autre',
};

const leaveStatusBadge: Record<LeaveRequestStatus, string> = {
  pending: 'badge-warning',
  approved: 'badge-success',
  rejected: 'badge-danger',
  cancelled: 'badge-muted',
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function gpsAccuracyLabel(accuracy?: number | null) {
  if (accuracy == null || !Number.isFinite(accuracy)) return 'Precision inconnue';
  if (accuracy <= 30) return `Precision ${Math.round(accuracy)} m - bonne`;
  if (accuracy <= 100) return `Precision ${Math.round(accuracy)} m - moyenne`;
  return `Precision ${Math.round(accuracy)} m - faible`;
}

function gpsAccuracyTone(accuracy?: number | null) {
  if (accuracy == null || !Number.isFinite(accuracy)) return 'text-slate-500';
  if (accuracy <= 30) return 'text-emerald-700';
  if (accuracy <= 100) return 'text-amber-700';
  return 'text-rose-700';
}

function siteLabel(log: TimeLogRow) {
  if (typeof log.franchiseId === 'object' && log.franchiseId) return log.franchiseId.name;
  const role = typeof log.userId === 'object' && log.userId ? log.userId.role : '';
  if (role === 'siege_employee' || role === 'hr_admin') return 'Siege';
  return '-';
}

function initials(name?: string | null) {
  const parts = (name || 'Employe')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? 'E';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : parts[0]?.[1];
  return `${first}${last ?? ''}`.toUpperCase();
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function offsetCoordinate(lat: number, lng: number, index: number, total: number) {
  if (total <= 1) return { lat, lng };
  const ring = Math.floor(index / 8);
  const slot = index % 8;
  const radiusMeters = 14 + ring * 12;
  const angle = (slot / Math.min(total, 8)) * Math.PI * 2;
  const latOffset = (Math.sin(angle) * radiusMeters) / 111_320;
  const lngOffset = (Math.cos(angle) * radiusMeters) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + latOffset, lng: lng + lngOffset };
}

function spreadMapPoints(points: TimeLogMapPoint[]) {
  const groups = new Map<string, TimeLogMapPoint[]>();
  for (const point of points) {
    const key = `${point.gps.lat.toFixed(5)}:${point.gps.lng.toFixed(5)}`;
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  return points.map((point) => {
    const key = `${point.gps.lat.toFixed(5)}:${point.gps.lng.toFixed(5)}`;
    const group = groups.get(key) ?? [point];
    const index = group.findIndex((candidate) => candidate._id === point._id);
    return {
      ...point,
      displayGps: offsetCoordinate(point.gps.lat, point.gps.lng, Math.max(0, index), group.length),
      clusterLabel: group.length > 1 ? `${index + 1}/${group.length}` : undefined,
    };
  });
}

function employeeIcon(point: TimeLogMapPoint) {
  const commercial = point.user?.role === 'commercial';
  const status = point.inZone === false ? 'danger' : point.inZone === true ? 'ok' : 'neutral';
  const title = escapeHtml(point.user?.fullName ?? (commercial ? 'Commercial' : 'Employe'));
  return L.divIcon({
    className: '',
    html: commercial
      ? `<div class="pointage-car-marker pointage-marker--${status}" title="${title}"><span class="pointage-car-body"></span><span class="pointage-car-wheel pointage-car-wheel-a"></span><span class="pointage-car-wheel pointage-car-wheel-b"></span></div>`
      : `<div class="pointage-initial-marker pointage-marker--${status}" title="${title}">${escapeHtml(initials(point.user?.fullName))}</div>`,
    iconSize: commercial ? [34, 26] : [34, 34],
    iconAnchor: commercial ? [17, 13] : [17, 17],
    popupAnchor: [0, -15],
  });
}

function trackCarIcon(track: CommercialTrack, point?: CommercialTrackPoint) {
  const status = point?.inZone === false ? 'danger' : point?.inZone === true ? 'ok' : 'neutral';
  return L.divIcon({
    className: '',
    html: `<div class="pointage-car-marker pointage-car-marker--large pointage-marker--${status}" title="${escapeHtml(track.user?.fullName ?? 'Commercial')}"><span class="pointage-car-body"></span><span class="pointage-car-wheel pointage-car-wheel-a"></span><span class="pointage-car-wheel pointage-car-wheel-b"></span></div>`,
    iconSize: [42, 30],
    iconAnchor: [21, 15],
    popupAnchor: [0, -18],
  });
}

export function TimeLogsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canViewTeam =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'commercial_director' ||
    user?.role === 'hr_admin' ||
    user?.role === 'franchise';
  const canExport = canViewTeam;
  const canManageSiege =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager';
  const isGlobal =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'commercial_director' ||
    user?.role === 'hr_admin';
  const [scope, setScope] = useState<ViewScope>(canViewTeam ? 'team' : 'self');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [franchiseId, setFranchiseId] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [workingZone, setWorkingZone] = useState<'' | 'siege' | 'franchise' | 'commercial_zone'>('');
  const [commercialZoneId, setCommercialZoneId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [page, setPage] = useState(1);
  const [note, setNote] = useState('');
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number | null; capturedAt: string } | null>(null);
  const [gpsConfirmed, setGpsConfirmed] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [radiusMeters, setRadiusMeters] = useState(300);
  const [selectedMapPointId, setSelectedMapPointId] = useState('');
  const [selectedTrackUserId, setSelectedTrackUserId] = useState('');
  const [trackIndex, setTrackIndex] = useState(0);
  const [editingSiegeZone, setEditingSiegeZone] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveRequestType>('conge_annuel');
  const [leaveFromDate, setLeaveFromDate] = useState(todayDate());
  const [leaveToDate, setLeaveToDate] = useState(todayDate());
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const workers = useQuery({
    enabled: canViewTeam && scope === 'team',
    queryKey: ['timelog-workers', scope],
    queryFn: async () => (await api.get<{ users: User[] }>('/timelogs/workers')).data.users,
  });

  const commercialZones = useQuery({
    enabled: canViewTeam && scope === 'team',
    queryKey: ['commercial-zones', 'timelogs'],
    queryFn: async () => (await api.get<{ zones: CommercialZone[] }>('/network-points/zones')).data.zones,
  });

  const siegeZone = useQuery({
    queryKey: ['timelogs', 'siege-zone'],
    queryFn: async () => (await api.get<{ zone: SiegeZone }>('/timelogs/siege-zone')).data.zone,
  });

  const logs = useQuery({
    queryKey: ['timelogs', scope, month, fromDate, toDate, franchiseId, roleFilter, workingZone, commercialZoneId, workerId, page],
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
            month: fromDate || toDate ? undefined : month || undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
            franchiseId: isGlobal ? franchiseId || undefined : undefined,
            role: roleFilter || undefined,
            workingZone: workingZone || undefined,
            commercialZoneId: commercialZoneId || undefined,
            userId: workerId || undefined,
            page,
            pageSize: 50,
          },
        })
      ).data,
    refetchInterval: live ? 12_000 : false,
  });

  const mapData = useQuery({
    queryKey: ['timelogs-map', scope, month, fromDate, toDate, franchiseId, roleFilter, workingZone, commercialZoneId, workerId, radiusMeters],
    queryFn: async () =>
      (
        await api.get<{
          points: TimeLogMapPoint[];
          zones: TimeLogZone[];
          commercialZones: CommercialZone[];
          commercialTracks: CommercialTrack[];
          summary: { total: number; inZone: number; outOfZone: number; unknownZone: number; radiusMeters: number };
        }>('/timelogs/map', {
          params: {
            scope,
            month: fromDate || toDate ? undefined : month || undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
            franchiseId: isGlobal ? franchiseId || undefined : undefined,
            role: roleFilter || undefined,
            workingZone: workingZone || undefined,
            commercialZoneId: commercialZoneId || undefined,
            userId: workerId || undefined,
            radiusMeters,
            limit: 1200,
            trackLimit: 3000,
          },
        })
      ).data,
    refetchInterval: live ? 12_000 : false,
  });

  const leaveRequests = useQuery({
    queryKey: ['leave-requests-self', user?.id],
    queryFn: async () =>
      (
        await api.get<{
          leaveRequests: LeaveRequestRow[];
        }>('/leave-requests', {
          params: {
            scope: 'self',
            pageSize: 5,
          },
        })
      ).data.leaveRequests,
    refetchInterval: live ? 30_000 : false,
  });

  useEffect(() => {
    setPage(1);
  }, [scope, month, fromDate, toDate, franchiseId, roleFilter, workingZone, commercialZoneId, workerId]);

  const displayPoints = useMemo(() => spreadMapPoints(mapData.data?.points ?? []), [mapData.data?.points]);
  const selectedDisplayPoint = useMemo(
    () => displayPoints.find((point) => point._id === selectedMapPointId) ?? null,
    [displayPoints, selectedMapPointId],
  );
  const tracks = mapData.data?.commercialTracks ?? [];
  const activeTrack = useMemo(
    () => tracks.find((track) => track.user?._id === selectedTrackUserId) ?? tracks[0] ?? null,
    [selectedTrackUserId, tracks],
  );
  const activeTrackPoint = activeTrack?.points[Math.min(trackIndex, Math.max(0, activeTrack.points.length - 1))] ?? null;

  useEffect(() => {
    setTrackIndex(0);
  }, [activeTrack?.user?._id, month, fromDate, toDate]);

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
            accuracy: position.coords.accuracy == null ? null : Math.round(position.coords.accuracy),
            capturedAt: new Date().toISOString(),
          });
          setGpsConfirmed(false);
          resolve();
        },
        (error) => {
          setGeoError(error.message || 'Impossible de lire la position');
          resolve();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
  };

  const addLog = useMutation({
    mutationFn: async (type: TimeLogType) => {
      if (!gps) throw new Error('Capturez votre position avant le pointage');
      if (!gpsConfirmed) throw new Error('Confirmez la position affichee avant le pointage');
      await api.post('/timelogs', {
        type,
        note: note || undefined,
        gps: { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy },
      });
    },
    onSuccess: () => {
      setErr(null);
      setNote('');
      setGpsConfirmed(false);
      setGps(null);
      qc.invalidateQueries({ queryKey: ['timelogs'] });
      qc.invalidateQueries({ queryKey: ['timelogs-map'] });
    },
    onError: (error) => setErr(error instanceof Error ? error.message : apiError(error).message),
  });

  const createLeaveRequest = useMutation({
    mutationFn: async () => {
      await api.post('/leave-requests', {
        type: leaveType,
        fromDate: leaveFromDate,
        toDate: leaveToDate,
        reason: leaveReason || undefined,
      });
    },
    onSuccess: () => {
      setLeaveError(null);
      setLeaveReason('');
      setLeaveFromDate(todayDate());
      setLeaveToDate(todayDate());
      qc.invalidateQueries({ queryKey: ['leave-requests-self'] });
    },
    onError: (error) => setLeaveError(apiError(error).message),
  });

  const exportCsv = async () => {
    try {
      const response = await api.get('/timelogs/export', {
        params: {
          scope,
          month: fromDate || toDate ? undefined : month || undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
          franchiseId: isGlobal ? franchiseId || undefined : undefined,
          role: roleFilter || undefined,
          workingZone: workingZone || undefined,
          commercialZoneId: commercialZoneId || undefined,
          userId: workerId || undefined,
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
          <div className="flex flex-wrap items-center gap-2">
            {canManageSiege && (
              <button className="btn-secondary" onClick={() => setEditingSiegeZone(true)}>
                Config siege
              </button>
            )}
            {canExport && (
              <button className="btn-secondary" onClick={exportCsv}>
                Export CSV
              </button>
            )}
          </div>
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

      {siegeZone.data && (
        <section className="card mb-5 border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Zone pointage siege</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{siegeZone.data.name}</div>
              <div className="mt-1 text-xs text-slate-500">
                {siegeZone.data.gps.lat}, {siegeZone.data.gps.lng} - rayon {siegeZone.data.radiusMeters} m
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Les employes siege, HR et responsables centraux doivent pointer dans ce cercle.
            </div>
          </div>
        </section>
      )}

      <section className="card mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
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
            disabled={Boolean(fromDate || toDate)}
            onChange={(event) => {
              setMonth(event.target.value);
              setPage(1);
            }}
          />
          <input type="date" className="input" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <input type="date" className="input" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          {isGlobal && scope === 'team' ? (
            <select
              className="input"
              value={franchiseId}
              onChange={(event) => {
                setFranchiseId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous sites</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>
                  {franchise.name}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" disabled value={scope === 'team' ? 'Site equipe' : 'Filtre equipe indisponible'} />
          )}
          <select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as '' | Role)}>
            <option value="">Tous roles</option>
            {workerRoles.map((role) => (
              <option key={role} value={role}>{roleLabel[role] ?? role}</option>
            ))}
          </select>
          <select
            className="input"
            value={workingZone}
            onChange={(event) => {
              const value = event.target.value as '' | 'siege' | 'franchise' | 'commercial_zone';
              setWorkingZone(value);
              if (value !== 'commercial_zone') setCommercialZoneId('');
            }}
          >
            <option value="">Toutes zones travail</option>
            {(Object.keys(workingZoneLabel) as Array<keyof typeof workingZoneLabel>).map((zone) => (
              <option key={zone} value={zone}>{workingZoneLabel[zone]}</option>
            ))}
          </select>
          <select className="input" value={commercialZoneId} onChange={(event) => setCommercialZoneId(event.target.value)}>
            <option value="">Toutes zones commerciales</option>
            {(commercialZones.data ?? []).map((zone) => (
              <option key={zone._id} value={zone._id}>{zone.name}</option>
            ))}
          </select>
          <select className="input" value={workerId} onChange={(event) => setWorkerId(event.target.value)} disabled={!canViewTeam || scope !== 'team'}>
            <option value="">Tous workers</option>
            {(workers.data ?? [])
              .filter((worker) => workerRoles.includes(worker.role))
              .map((worker) => (
                <option key={worker.id || worker._id} value={worker.id || worker._id}>
                  {worker.fullName} - {roleLabel[worker.role] ?? worker.role}
                </option>
              ))}
          </select>
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
            Verifier GPS
          </button>
        </div>
        {gps && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-700">
                <div className="font-semibold text-slate-900">Position a verifier avant pointage</div>
                <div className="mt-1">
                  GPS: {gps.lat}, {gps.lng}
                  {gps.accuracy != null ? ` - precision ${gps.accuracy} m` : ''}
                </div>
                <div className="mt-1 text-xs text-slate-500">Capture: {dateTime(gps.capturedAt)}</div>
                <div className={`mt-1 text-xs font-semibold ${gpsAccuracyTone(gps.accuracy)}`}>
                  {gpsAccuracyLabel(gps.accuracy)}
                </div>
                {gps.accuracy != null && gps.accuracy > 100 && (
                  <div className="mt-2 text-xs font-semibold text-amber-700">
                    Precision faible. Recapturez si le point ne correspond pas a votre position.
                  </div>
                )}
              </div>
              <button
                type="button"
                className={`btn-secondary ${gpsConfirmed ? '!border-emerald-200 !bg-emerald-50 !text-emerald-700' : ''}`}
                onClick={() => setGpsConfirmed(true)}
              >
                {gpsConfirmed ? 'Position confirmee' : 'Confirmer position'}
              </button>
            </div>
            <div className="mt-3 h-[240px] overflow-hidden rounded-lg border border-slate-200">
              <GpsPreviewMap gps={gps} />
            </div>
          </div>
        )}
        {geoError && <div className="mt-2 text-sm text-rose-600">{geoError}</div>}
        {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
      </section>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(labels) as TimeLogType[]).map((type) => (
          <button
            key={type}
            className="btn-primary !justify-start !px-4 !py-3 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={addLog.isPending || !gps || !gpsConfirmed}
            onClick={() => addLog.mutate(type)}
          >
            Pointer: {labels[type]}
          </button>
        ))}
      </section>

      <section className="card mb-5 p-4">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Demande conge</h2>
            <p className="text-sm text-slate-500">Vos demandes restent dans le module pointage.</p>
          </div>
          {leaveRequests.isFetching && <span className="text-xs font-medium text-slate-400">Sync...</span>}
        </div>
        <div className="grid gap-3 lg:grid-cols-[170px_160px_160px_minmax(0,1fr)_auto]">
          <select className="input" value={leaveType} onChange={(event) => setLeaveType(event.target.value as LeaveRequestType)}>
            {(Object.keys(leaveTypeLabel) as LeaveRequestType[]).map((type) => (
              <option key={type} value={type}>{leaveTypeLabel[type]}</option>
            ))}
          </select>
          <input type="date" className="input" value={leaveFromDate} onChange={(event) => setLeaveFromDate(event.target.value)} />
          <input type="date" className="input" value={leaveToDate} onChange={(event) => setLeaveToDate(event.target.value)} />
          <input
            className="input"
            placeholder="Motif ou note"
            value={leaveReason}
            onChange={(event) => setLeaveReason(event.target.value)}
          />
          <button className="btn-primary" disabled={createLeaveRequest.isPending} onClick={() => createLeaveRequest.mutate()}>
            Envoyer
          </button>
        </div>
        {leaveError && <div className="mt-2 text-sm text-rose-600">{leaveError}</div>}
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {(leaveRequests.data ?? []).map((request) => (
            <div key={request._id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">{leaveTypeLabel[request.type]}</span>
                <span className={leaveStatusBadge[request.status]}>{request.status}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">{request.fromDate} {'->'} {request.toDate}</div>
            </div>
          ))}
          {!leaveRequests.isLoading && (leaveRequests.data?.length ?? 0) === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
              Aucune demande recente.
            </div>
          )}
        </div>
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
                <MapViewport
                  points={[
                    ...displayPoints.map((point) => ({ gps: point.displayGps ?? point.gps })),
                    ...(activeTrack?.points ?? []).map((point) => ({ gps: point.gps })),
                  ]}
                  selected={selectedDisplayPoint}
                />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {(mapData.data?.zones ?? []).map((zone) => (
                  <Circle
                    key={zone._id}
                    center={[zone.gps.lat, zone.gps.lng]}
                    radius={zone.radiusMeters ?? radiusMeters}
                    pathOptions={{
                      color: zone.kind === 'siege' ? '#0F172A' : '#2AABE2',
                      weight: 1.5,
                      fillColor: zone.kind === 'siege' ? '#0F172A' : '#2AABE2',
                      fillOpacity: 0.08,
                    }}
                  />
                ))}
                {(mapData.data?.commercialZones ?? []).map((zone) => (
                  <Polygon
                    key={zone._id}
                    positions={(zone.polygon ?? []).map((point) => [point.lat, point.lng])}
                    pathOptions={{
                      color: zone.color || '#16A34A',
                      weight: commercialZoneId === zone._id ? 3 : 1.5,
                      fillColor: zone.color || '#16A34A',
                      fillOpacity: commercialZoneId === zone._id ? 0.12 : 0.06,
                    }}
                  />
                ))}
                {activeTrack && activeTrack.points.length > 1 && (
                  <>
                    <Polyline
                      positions={activeTrack.points.map((point) => [point.gps.lat, point.gps.lng])}
                      pathOptions={{ color: '#94A3B8', weight: 3, opacity: 0.45 }}
                    />
                    <Polyline
                      positions={activeTrack.points.slice(0, Math.max(1, trackIndex + 1)).map((point) => [point.gps.lat, point.gps.lng])}
                      pathOptions={{ color: '#2563EB', weight: 4, opacity: 0.9 }}
                    />
                  </>
                )}
                {activeTrack && activeTrackPoint && (
                  <Marker position={[activeTrackPoint.gps.lat, activeTrackPoint.gps.lng]} icon={trackCarIcon(activeTrack, activeTrackPoint)}>
                    <Popup>
                      <div className="space-y-1 text-sm">
                        <div className="font-semibold text-slate-900">{activeTrack.user?.fullName || 'Commercial'}</div>
                        <div className="text-xs text-slate-500">{dateTime(activeTrackPoint.timestamp)}</div>
                        <div className="text-xs">{activeTrack.zone?.name || 'Zone commerciale non reconnue'}</div>
                        <div className={activeTrackPoint.inZone === false ? 'text-xs font-semibold text-rose-700' : 'text-xs font-semibold text-emerald-700'}>
                          {activeTrackPoint.inZone === false ? 'Hors zone' : activeTrackPoint.inZone === true ? 'Dans zone' : 'Zone inconnue'}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                )}
                {displayPoints.map((point) => (
                  <PointageMapMarker
                    key={point._id}
                    point={point}
                    selected={selectedMapPointId === point._id}
                    onSelect={() => setSelectedMapPointId(point._id)}
                  />
                ))}
              </MapContainer>
            )}
          </div>
        </div>

        <aside className="card p-3">
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-sm font-semibold text-slate-900">Circuit commerciaux</div>
            <select
              className="input !min-h-[40px] !py-2"
              value={activeTrack?.user?._id ?? ''}
              onChange={(event) => {
                setSelectedTrackUserId(event.target.value);
                setTrackIndex(0);
              }}
            >
              {tracks.length === 0 && <option value="">Aucun circuit</option>}
              {tracks.map((track) => (
                <option key={track.user?._id ?? track.points[0]?._id} value={track.user?._id ?? ''}>
                  {track.user?.fullName || 'Commercial'} ({track.points.length})
                </option>
              ))}
            </select>
            {activeTrack && activeTrack.points.length > 0 && (
              <div className="mt-3 space-y-2">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, activeTrack.points.length - 1)}
                  value={Math.min(trackIndex, Math.max(0, activeTrack.points.length - 1))}
                  onChange={(event) => setTrackIndex(Number(event.target.value))}
                  className="w-full accent-brand-600"
                  aria-label="Playback circuit commercial"
                />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-slate-400">Heure</div>
                    <div className="font-semibold text-slate-700">{activeTrackPoint ? dateTime(activeTrackPoint.timestamp) : '-'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-400">Point</div>
                    <div className="font-semibold text-slate-700">{Math.min(trackIndex + 1, activeTrack.points.length)} / {activeTrack.points.length}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
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
              {scope === 'team' && <th className="th">Site</th>}
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
                    {siteLabel(log)}
                  </td>
                )}
                <td className="td text-slate-600">
                  {log.gps?.lat != null && log.gps?.lng != null
                    ? `${log.gps.lat}, ${log.gps.lng}${log.gps.accuracy != null ? ` (${Math.round(log.gps.accuracy)} m)` : ''}`
                    : '-'}
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

      {editingSiegeZone && siegeZone.data && (
        <SiegeZoneModal
          zone={siegeZone.data}
          onClose={() => setEditingSiegeZone(false)}
          onSaved={() => {
            setEditingSiegeZone(false);
            qc.invalidateQueries({ queryKey: ['timelogs', 'siege-zone'] });
            qc.invalidateQueries({ queryKey: ['timelogs-map'] });
          }}
        />
      )}
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

function SiegeZoneModal({
  zone,
  onClose,
  onSaved,
}: {
  zone: SiegeZone;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(zone.name);
  const [lat, setLat] = useState(zone.gps.lat);
  const [lng, setLng] = useState(zone.gps.lng);
  const [radiusMeters, setRadiusMeters] = useState(zone.radiusMeters);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Nom du siege requis');
      await api.patch('/timelogs/siege-zone', {
        name: name.trim(),
        lat,
        lng,
        radiusMeters,
      });
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title="Configurer zone siege"
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Enregistrement...' : 'Enregistrer zone'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Cette position controle le cercle autorise pour le pointage siege.
        </div>
        <div>
          <label className="label">Nom</label>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Latitude</label>
            <input
              type="number"
              step="0.000001"
              className="input"
              value={lat}
              onChange={(event) => setLat(Number(event.target.value))}
            />
          </div>
          <div>
            <label className="label">Longitude</label>
            <input
              type="number"
              step="0.000001"
              className="input"
              value={lng}
              onChange={(event) => setLng(Number(event.target.value))}
            />
          </div>
        </div>
        <div>
          <label className="label">Rayon autorise (metres)</label>
          <input
            type="number"
            min={20}
            max={5000}
            step={10}
            className="input"
            value={radiusMeters}
            onChange={(event) => setRadiusMeters(Math.max(20, Math.min(5000, Number(event.target.value) || 20)))}
          />
        </div>
        <div className="h-[260px] overflow-hidden rounded-lg border border-slate-200">
          <MapContainer
            key={`${lat}-${lng}-${radiusMeters}`}
            center={[lat, lng]}
            zoom={16}
            scrollWheelZoom
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Circle
              center={[lat, lng]}
              radius={radiusMeters}
              pathOptions={{ color: '#0F172A', fillColor: '#0F172A', fillOpacity: 0.1, weight: 2 }}
            />
            <CircleMarker
              center={[lat, lng]}
              radius={8}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#0F172A', fillOpacity: 1 }}
            />
          </MapContainer>
        </div>
        {error && <div className="text-sm text-rose-600">{error}</div>}
      </div>
    </Modal>
  );
}

function GpsPreviewMap({ gps }: { gps: { lat: number; lng: number; accuracy: number | null } }) {
  const radius = Math.max(12, Math.min(500, gps.accuracy ?? 25));

  return (
    <MapContainer
      key={`${gps.lat}-${gps.lng}-${gps.accuracy ?? 'x'}`}
      center={[gps.lat, gps.lng]}
      zoom={17}
      scrollWheelZoom={false}
      dragging={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Circle
        center={[gps.lat, gps.lng]}
        radius={radius}
        pathOptions={{
          color: gps.accuracy != null && gps.accuracy > 100 ? '#DC2626' : gps.accuracy != null && gps.accuracy > 30 ? '#F59E0B' : '#10B981',
          weight: 1.5,
          fillOpacity: 0.12,
        }}
      />
      <CircleMarker
        center={[gps.lat, gps.lng]}
        radius={7}
        pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#0F172A', fillOpacity: 1 }}
      />
    </MapContainer>
  );
}

function PointageMapMarker({
  point,
  selected,
  onSelect,
}: {
  point: TimeLogMapPoint;
  selected: boolean;
  onSelect: () => void;
}) {
  const accuracy = point.gps.accuracy;
  const accuracyRadius = accuracy == null ? 0 : Math.max(10, Math.min(500, accuracy));
  const accuracyColor = accuracy == null ? '#64748B' : accuracy > 100 ? '#DC2626' : accuracy > 30 ? '#F59E0B' : '#10B981';
  const displayGps = point.displayGps ?? point.gps;

  return (
    <>
      {accuracyRadius > 0 && (
        <Circle
          center={[point.gps.lat, point.gps.lng]}
          radius={accuracyRadius}
          pathOptions={{
            color: accuracyColor,
            weight: selected ? 2 : 1,
            fillOpacity: selected ? 0.14 : 0.08,
          }}
        />
      )}
      <Marker
        position={[displayGps.lat, displayGps.lng]}
        icon={employeeIcon(point)}
        eventHandlers={{ click: onSelect }}
      >
        <Popup>
          <div className="space-y-1 text-sm">
            <div className="font-semibold text-slate-900">{point.user?.fullName || 'Employe'}</div>
            {point.clusterLabel && <div className="text-xs font-semibold text-brand-700">Position partagee {point.clusterLabel}</div>}
            <div className="text-xs text-slate-500">{labels[point.type]} - {dateTime(point.timestamp)}</div>
            <div>{point.franchise?.name || 'Site inconnu'}</div>
            <div className={`text-xs font-semibold ${gpsAccuracyTone(accuracy)}`}>
              {gpsAccuracyLabel(accuracy)}
            </div>
            <div className="text-xs">
              {point.distanceMeters == null ? 'Zone inconnue' : `${point.distanceMeters} m du site`}
            </div>
          </div>
        </Popup>
      </Marker>
    </>
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
