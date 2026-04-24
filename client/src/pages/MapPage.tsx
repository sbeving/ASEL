import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import type { NetworkPoint } from '../lib/types';

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

type MapPoint = NetworkPoint & { gps: { lat: number; lng: number } };

export function MapPage() {
  const [typeFilter, setTypeFilter] = useState<'all' | NetworkPoint['type']>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | NetworkPoint['status']>('all');
  const [selectedPointId, setSelectedPointId] = useState('');
  const [live, setLive] = useState(true);

  const pointsQuery = useQuery({
    queryKey: ['network-map', typeFilter, statusFilter],
    queryFn: async () =>
      (
        await api.get<{ points: NetworkPoint[]; source: 'network_points' | 'franchises' }>('/network-points/map', {
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

  return (
    <>
      <PageHeader
        title="Carte du reseau"
        subtitle={`Points geolocalises: ${points.length}${pointsQuery.data?.source === 'franchises' ? ' (fallback franchises)' : ''}`}
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
        <MapKpi label="Suspendus" value={String(countsByStatus.suspendu)} accent="bg-rose-50 text-rose-700 border-rose-100" />
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
                {points.map((point) => (
                  <CircleMarker
                    key={point._id}
                    center={[point.gps.lat, point.gps.lng]}
                    radius={selectedPointId === point._id ? 14 : 10}
                    eventHandlers={{
                      click: () => setSelectedPointId(point._id),
                    }}
                    pathOptions={{
                      color: '#ffffff',
                      weight: 2,
                      fillColor: typeColor[point.type],
                      fillOpacity: selectedPointId === point._id ? 1 : 0.9,
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
                ))}
              </MapContainer>
            </div>
          </div>

          <aside className="card p-3">
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
