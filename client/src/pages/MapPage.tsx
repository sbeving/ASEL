import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleMarker, MapContainer, Polygon, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api, apiError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import type { CommercialZone, Franchise, NetworkPoint, User } from '../lib/types';

const typeLabel: Record<NetworkPoint['type'], string> = {
  franchise: 'Franchise',
  activation: 'Activation',
  recharge: 'Recharge',
  activation_recharge: 'Activation + Recharge',
};

const statusLabel: Record<NetworkPoint['status'], string> = {
  prospect: 'Prospect',
  contact: 'Contacte',
  contrat_non_signe: 'Contrat non signe',
  contrat_signe: 'Contrat signe',
  actif: 'Actif',
  suspendu: 'Suspendu',
  resilie: 'Resilie',
};

const typeColor: Record<NetworkPoint['type'], string> = {
  franchise: '#2AABE2',
  activation: '#10B981',
  recharge: '#F59E0B',
  activation_recharge: '#6366F1',
};

const mapLegendItems = [
  { label: typeLabel.franchise, color: typeColor.franchise },
  { label: typeLabel.activation, color: typeColor.activation },
  { label: typeLabel.recharge, color: typeColor.recharge },
  { label: typeLabel.activation_recharge, color: typeColor.activation_recharge },
];

type MapPoint = NetworkPoint & { gps: { lat: number; lng: number } };

function userDisplay(user: User | string) {
  if (typeof user === 'string') return user;
  return user.fullName || user.username || user._id || user.id || '';
}

function franchiseDisplay(franchise?: Franchise | string | null) {
  if (!franchise) return '';
  if (typeof franchise === 'string') return franchise;
  return franchise.name;
}

function commercialLabels(zone: CommercialZone) {
  return (zone.assignedCommercialIds ?? [])
    .map((commercial) => userDisplay(commercial as User | string))
    .filter(Boolean);
}

function zoneHasOwner(zone: CommercialZone) {
  return Boolean(zone.franchiseId) || (zone.assignedCommercialIds?.length ?? 0) > 0;
}

export function MapPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<'all' | NetworkPoint['type']>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | NetworkPoint['status']>('all');
  const [selectedPointId, setSelectedPointId] = useState('');
  const [live, setLive] = useState(true);
  const [drawingZone, setDrawingZone] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState('');
  const [draftZoneName, setDraftZoneName] = useState('');
  const [draftZoneColor, setDraftZoneColor] = useState('#2563eb');
  const [draftZoneFranchiseId, setDraftZoneFranchiseId] = useState('');
  const [draftZoneCommercialIds, setDraftZoneCommercialIds] = useState<string[]>([]);
  const [draftZonePoints, setDraftZonePoints] = useState<Array<{ lat: number; lng: number }>>([]);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const canManageZones =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'commercial_director';
  const canAssignCommercials = canManageZones;

  const usersQuery = useQuery({
    enabled: canAssignCommercials,
    queryKey: ['users', 'commercials-for-zones'],
    queryFn: async () => (await api.get<{ users: User[] }>('/users')).data.users,
  });

  const franchisesQuery = useQuery({
    enabled: canManageZones,
    queryKey: ['franchises', 'zones'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const pointsQuery = useQuery({
    queryKey: ['network-map', typeFilter, statusFilter],
    queryFn: async () =>
      (
        await api.get<{ points: NetworkPoint[]; zones: CommercialZone[]; source: 'network_points' | 'franchises' }>('/network-points/map', {
          params: {
            fallbackFranchises: 'true',
            ...(typeFilter === 'all' ? {} : { type: typeFilter }),
            ...(statusFilter === 'all' ? {} : { status: statusFilter }),
          },
        })
      ).data,
    refetchInterval: live ? 15_000 : false,
  });

  const points = useMemo(
    () =>
      (pointsQuery.data?.points ?? [])
        .map((point) => {
          const lat = Number(point.gps?.lat);
          const lng = Number(point.gps?.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return { ...point, gps: { lat, lng } };
        })
        .filter(Boolean) as MapPoint[],
    [pointsQuery.data?.points],
  );
  const zones = pointsQuery.data?.zones ?? [];

  const saveZone = useMutation({
    mutationFn: async () => {
      if (!draftZoneName.trim()) throw new Error('Nom de zone requis');
      if (draftZonePoints.length < 3) throw new Error('Cliquez au moins 3 points sur la carte');
      if (!draftZoneFranchiseId && draftZoneCommercialIds.length === 0) {
        throw new Error('Liez la zone a au moins un commercial ou une franchise');
      }
      const payload = {
        name: draftZoneName.trim(),
        color: draftZoneColor,
        franchiseId: draftZoneFranchiseId || null,
        assignedCommercialIds: draftZoneCommercialIds,
        polygon: draftZonePoints,
        active: true,
      };
      if (editingZoneId) await api.patch(`/network-points/zones/${editingZoneId}`, payload);
      else await api.post('/network-points/zones', payload);
    },
    onSuccess: () => {
      setZoneError(null);
      setDrawingZone(false);
      setEditingZoneId('');
      setDraftZoneName('');
      setDraftZoneFranchiseId('');
      setDraftZoneCommercialIds([]);
      setDraftZonePoints([]);
      qc.invalidateQueries({ queryKey: ['network-map'] });
      qc.invalidateQueries({ queryKey: ['network-points-map'] });
    },
    onError: (err) => setZoneError(err instanceof Error ? err.message : apiError(err).message),
  });

  const archiveZone = useMutation({
    mutationFn: async (zoneId: string) => {
      await api.delete(`/network-points/zones/${zoneId}`);
    },
    onSuccess: () => {
      setZoneError(null);
      qc.invalidateQueries({ queryKey: ['network-map'] });
      qc.invalidateQueries({ queryKey: ['network-points-map'] });
    },
    onError: (err) => setZoneError(apiError(err).message),
  });

  const selectedPoint = useMemo(
    () => points.find((point) => point._id === selectedPointId) ?? null,
    [points, selectedPointId],
  );

  const countsByType = useMemo(() => {
    const counts: Record<NetworkPoint['type'], number> = {
      franchise: 0,
      activation: 0,
      recharge: 0,
      activation_recharge: 0,
    };
    for (const point of points) counts[point.type] += 1;
    return counts;
  }, [points]);

  const countsByStatus = useMemo(() => {
    const counts: Record<NetworkPoint['status'], number> = {
      prospect: 0,
      contact: 0,
      contrat_non_signe: 0,
      contrat_signe: 0,
      actif: 0,
      suspendu: 0,
      resilie: 0,
    };
    for (const point of points) counts[point.status] += 1;
    return counts;
  }, [points]);

  const orphanZoneCount = zones.filter((zone) => !zoneHasOwner(zone)).length;
  const zoneLinkReady = Boolean(draftZoneFranchiseId) || draftZoneCommercialIds.length > 0;

  const resetZoneDraft = () => {
    setEditingZoneId('');
    setDrawingZone(false);
    setDraftZoneName('');
    setDraftZoneFranchiseId('');
    setDraftZoneCommercialIds([]);
    setDraftZonePoints([]);
    setZoneError(null);
  };

  const startEditZone = (zone: CommercialZone) => {
    setEditingZoneId(zone._id);
    setDraftZoneName(zone.name);
    setDraftZoneColor(zone.color || '#2563eb');
    setDraftZoneFranchiseId(typeof zone.franchiseId === 'object' && zone.franchiseId ? zone.franchiseId._id : zone.franchiseId ?? '');
    setDraftZoneCommercialIds(
      (zone.assignedCommercialIds ?? []).map((commercial) =>
        typeof commercial === 'object' ? commercial._id || commercial.id || '' : commercial,
      ).filter(Boolean),
    );
    setDraftZonePoints(zone.polygon);
    setDrawingZone(true);
    setZoneError(null);
  };

  return (
    <>
      <PageHeader
        title="Carte du reseau"
        subtitle={`Points geolocalises: ${points.length} • Zones: ${zones.length}${pointsQuery.data?.source === 'franchises' ? ' (fallback franchises)' : ''}`}
      />

      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MapKpi
          label="Total points"
          value={String(points.length)}
          accent="bg-brand-50 text-brand-700 border-brand-100"
          icon={(
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="11" r="4" />
              <path d="M12 2c4.6 0 8 3.4 8 8 0 5-8 12-8 12S4 15 4 10c0-4.6 3.4-8 8-8z" />
            </svg>
          )}
        />
        <MapKpi label="Franchises" value={String(countsByType.franchise)} accent="bg-sky-50 text-sky-700 border-sky-100" />
        <MapKpi label="Actifs" value={String(countsByStatus.actif)} accent="bg-emerald-50 text-emerald-700 border-emerald-100" />
        <MapKpi label="Prospects" value={String(countsByStatus.prospect)} accent="bg-amber-50 text-amber-700 border-amber-100" />
        <MapKpi
          label="Zones a corriger"
          value={String(orphanZoneCount)}
          accent={
            orphanZoneCount > 0
              ? 'bg-rose-50 text-rose-700 border-rose-100'
              : 'bg-emerald-50 text-emerald-700 border-emerald-100'
          }
        />
      </section>

      <section className="mb-4 card p-4">
        <div className="grid gap-3 md:grid-cols-[220px_220px_minmax(0,1fr)_120px]">
          <select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
            <option value="all">Tous types</option>
            {(Object.keys(typeLabel) as NetworkPoint['type'][]).map((type) => (
              <option key={type} value={type}>
                {typeLabel[type]}
              </option>
            ))}
          </select>
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">Tous statuts</option>
            {(Object.keys(statusLabel) as NetworkPoint['status'][]).map((status) => (
              <option key={status} value={status}>
                {statusLabel[status]}
              </option>
            ))}
          </select>
          <div className="text-sm text-slate-500">
            {pointsQuery.isFetching ? 'Mise a jour en cours...' : `Derniere sync: ${new Date().toLocaleTimeString()}`}
          </div>
          <button
            type="button"
            className={`btn-secondary ${live ? '!bg-slate-800 !text-white' : ''}`}
            onClick={() => setLive((v) => !v)}
          >
            {live ? 'Live ON' : 'Live OFF'}
          </button>
        </div>
        {canManageZones && (
          <div className="mt-3 rounded-xl border border-surface-200 bg-surface-50 p-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_120px_220px_minmax(220px,280px)_auto_auto]">
              <input
                className="input"
                placeholder={editingZoneId ? 'Modifier zone commerciale' : 'Nom zone commerciale'}
                value={draftZoneName}
                onChange={(event) => setDraftZoneName(event.target.value)}
              />
              <input
                className="input h-11"
                type="color"
                value={draftZoneColor}
                onChange={(event) => setDraftZoneColor(event.target.value)}
              />
              <select
                className="input"
                value={draftZoneFranchiseId}
                onChange={(event) => setDraftZoneFranchiseId(event.target.value)}
              >
                <option value="">Aucune franchise</option>
                {(franchisesQuery.data ?? []).map((franchise) => (
                  <option key={franchise._id} value={franchise._id}>
                    {franchise.name}
                  </option>
                ))}
              </select>
              <select
                multiple
                className="input min-h-[44px] !py-1 text-xs"
                value={draftZoneCommercialIds}
                disabled={!canAssignCommercials}
                onChange={(event) =>
                  setDraftZoneCommercialIds(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
                }
              >
                {(usersQuery.data ?? [])
                  .filter((row) => row.role === 'commercial' && row.active !== false)
                  .map((row) => (
                    <option key={row._id || row.id} value={row._id || row.id}>
                      {row.fullName}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className={`btn-secondary ${drawingZone ? '!bg-slate-800 !text-white' : ''}`}
                onClick={() => {
                  setDrawingZone((value) => !value);
                  setZoneError(null);
                }}
              >
                {drawingZone ? 'Dessin actif' : 'Dessiner zone'}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={saveZone.isPending || draftZonePoints.length < 3 || !zoneLinkReady}
                onClick={() => saveZone.mutate()}
              >
                {editingZoneId ? 'Mettre a jour' : 'Enregistrer zone'}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium text-surface-500">
              {editingZoneId && <span className="badge-info">Edition zone</span>}
              <span>{draftZonePoints.length} point(s). Cliquer sur la carte ajoute un angle precis.</span>
              <span className={zoneLinkReady ? 'text-emerald-700' : 'text-amber-700'}>
                {zoneLinkReady ? 'Lien zone valide.' : 'Lien commercial ou franchise requis.'}
              </span>
              {draftZonePoints.length > 0 && (
                <button type="button" className="font-semibold text-rose-600" onClick={() => setDraftZonePoints([])}>
                  Vider
                </button>
              )}
              {(editingZoneId || draftZonePoints.length > 0 || draftZoneName) && (
                <button type="button" className="font-semibold text-slate-600" onClick={resetZoneDraft}>
                  Annuler
                </button>
              )}
              {zoneError && <span className="text-rose-600">{zoneError}</span>}
            </div>
          </div>
        )}
      </section>

      {pointsQuery.isLoading && (
        <section className="card p-6">
          <div className="grid gap-3">
            <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
            <div className="h-[420px] animate-pulse rounded-xl bg-slate-100" />
          </div>
        </section>
      )}

      {pointsQuery.isError && (
        <section className="card border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Erreur chargement carte reseau.
        </section>
      )}

      {!pointsQuery.isLoading && !pointsQuery.isError && (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          <div className="card overflow-hidden p-0">
            <div className="relative z-0 h-[calc(100vh-330px)] min-h-[480px]">
              <MapContainer center={[36.8, 10.1]} zoom={7} scrollWheelZoom className="h-full w-full">
                <FitBounds points={points} selectedPoint={selectedPoint} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {zones.map((zone) => (
                  <Polygon
                    key={zone._id}
                    positions={zone.polygon.map((point) => [point.lat, point.lng])}
                    pathOptions={{
                      color: zone.color || '#2563eb',
                      fillColor: zone.color || '#2563eb',
                      fillOpacity: 0.12,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <div className="font-semibold text-slate-900">{zone.name}</div>
                        <div className="text-xs text-slate-500">{zone.polygon.length} angles</div>
                        <div className="mt-1 text-xs text-slate-600">
                          Franchise: {franchiseDisplay(zone.franchiseId) || '-'}
                        </div>
                        <div className="text-xs text-slate-600">
                          Commercials: {commercialLabels(zone).join(', ') || '-'}
                        </div>
                      </div>
                    </Popup>
                  </Polygon>
                ))}
                {draftZonePoints.length >= 2 && (
                  <Polygon
                    positions={draftZonePoints.map((point) => [point.lat, point.lng])}
                    pathOptions={{ color: draftZoneColor, fillColor: draftZoneColor, fillOpacity: 0.08, dashArray: '6 4' }}
                  />
                )}
                {drawingZone && <ZoneClicker onAdd={(point) => setDraftZonePoints((current) => [...current, point])} />}
                {points.map((point) => (
                  <Fragment key={point._id}>
                    {selectedPointId === point._id && (
                      <CircleMarker
                        center={[point.gps.lat, point.gps.lng]}
                        radius={21}
                        pathOptions={{ color: typeColor[point.type], weight: 2, fillColor: typeColor[point.type], fillOpacity: 0.14 }}
                      />
                    )}
                    <CircleMarker
                      center={[point.gps.lat, point.gps.lng]}
                      radius={selectedPointId === point._id ? 14 : 11}
                      eventHandlers={{
                        click: () => setSelectedPointId(point._id),
                      }}
                      pathOptions={{
                        color: selectedPointId === point._id ? '#0F172A' : '#ffffff',
                        weight: selectedPointId === point._id ? 3 : 2,
                        fillColor: typeColor[point.type],
                        fillOpacity: selectedPointId === point._id ? 1 : 0.92,
                      }}
                    >
                      <Popup>
                        <div className="min-w-[220px] space-y-1 text-sm">
                          <div className="font-semibold text-slate-900">{point.name}</div>
                          <div className="text-xs text-slate-500">
                            {typeLabel[point.type]} - {statusLabel[point.status]}
                          </div>
                          {point.address && <div>{point.address}</div>}
                          {point.phone && <div>{point.phone}</div>}
                          {point.responsible && <div>{point.responsible}</div>}
                          {point.internalNotes && (
                            <div className="text-xs text-slate-500">{point.internalNotes.slice(0, 80)}</div>
                          )}
                        </div>
                      </Popup>
                    </CircleMarker>
                  </Fragment>
                ))}
              </MapContainer>
              <MapLegend items={mapLegendItems} />
            </div>
          </div>

          <aside className="card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">Maintenance zones</div>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${orphanZoneCount > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {orphanZoneCount > 0 ? `${orphanZoneCount} a lier` : 'OK'}
              </span>
            </div>
            <div className="mb-3 max-h-56 space-y-2 overflow-y-auto rounded-xl bg-surface-50 p-2">
              {zones.map((zone) => {
                const commercials = commercialLabels(zone);
                const hasOwner = zoneHasOwner(zone);
                return (
                  <div key={zone._id} className="rounded-lg border border-slate-200 bg-white p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: zone.color || '#2563eb' }} />
                          <span className="truncate text-xs font-semibold text-slate-900">{zone.name}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Franchise: {franchiseDisplay(zone.franchiseId) || '-'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Commercials: {commercials.join(', ') || '-'}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${hasOwner ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {hasOwner ? 'Liee' : 'A lier'}
                      </span>
                    </div>
                    {canManageZones && (
                      <div className="mt-2 flex gap-3">
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-brand-700"
                          onClick={() => startEditZone(zone)}
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-rose-600 disabled:opacity-50"
                          disabled={archiveZone.isPending}
                          onClick={() => {
                            if (window.confirm(`Archiver la zone ${zone.name} ?`)) archiveZone.mutate(zone._id);
                          }}
                        >
                          Archiver
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {zones.length === 0 && <div className="px-2 py-4 text-sm text-slate-400">Aucune zone active.</div>}
            </div>
            <div className="mb-2 text-sm font-semibold text-slate-900">Points visibles</div>
            <div className="max-h-[calc(100vh-360px)] space-y-2 overflow-y-auto pr-1">
              {points.map((point) => (
                <button
                  key={point._id}
                  type="button"
                  onClick={() => setSelectedPointId(point._id)}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                    selectedPointId === point._id
                      ? 'border-brand-300 bg-brand-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{point.name}</div>
                      <div className="text-xs text-slate-500">{point.city || point.address || '-'}</div>
                    </div>
                    <span
                      className="inline-flex h-3.5 w-3.5 rounded-full border border-white shadow"
                      style={{ backgroundColor: typeColor[point.type] }}
                    />
                  </div>
                </button>
              ))}
              {points.length === 0 && <div className="px-2 py-4 text-sm text-slate-400">Aucun point a afficher.</div>}
            </div>
          </aside>
        </section>
      )}
    </>
  );
}

function ZoneClicker({ onAdd }: { onAdd: (point: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(event) {
      onAdd({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) });
    },
  });
  return null;
}

function MapKpi({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent: string;
  icon?: ReactNode;
}) {
  return (
    <div className={`card border p-4 ${accent}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function MapLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-700 shadow-soft">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Legende</div>
      <div className="grid gap-1">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border border-white shadow" style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FitBounds({
  points,
  selectedPoint,
}: {
  points: Array<{ gps: { lat: number; lng: number } }>;
  selectedPoint: { gps: { lat: number; lng: number } } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (selectedPoint) {
      map.flyTo([selectedPoint.gps.lat, selectedPoint.gps.lng], 12, { duration: 0.6 });
      return;
    }
    if (points.length === 0) return;
    const bounds = points.map((point) => [point.gps.lat, point.gps.lng]) as [number, number][];
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [map, points, selectedPoint]);

  return null;
}
