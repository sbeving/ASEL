import { useEffect, useMemo, useState } from 'react';
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
  activation_recharge: '#8B5CF6',
};

export function MapPage() {
  const [typeFilter, setTypeFilter] = useState<'all' | NetworkPoint['type']>('all');
  const pointsQuery = useQuery({
    queryKey: ['network-map', typeFilter],
    queryFn: async () =>
      (
        await api.get<{ points: NetworkPoint[]; source: 'network_points' | 'franchises' }>('/network-points/map', {
          params: {
            fallbackFranchises: 'true',
            ...(typeFilter === 'all' ? {} : { type: typeFilter }),
          },
        })
      ).data,
  });

  const points = useMemo(
    () =>
      (pointsQuery.data?.points ?? []).filter(
        (point) => point.gps?.lat != null && point.gps?.lng != null,
      ) as Array<NetworkPoint & { gps: { lat: number; lng: number } }>,
    [pointsQuery.data?.points],
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

  return (
    <>
      <PageHeader
        title="Carte du reseau"
        subtitle={`Vue geographique des points (${points.length}) ${pointsQuery.data?.source === 'franchises' ? '- fallback franchises' : ''}`}
      />

      <section className="mb-4 flex flex-wrap gap-2">
        <button
          className={`btn-secondary !py-1.5 !px-3 ${typeFilter === 'all' ? '!bg-slate-800 !text-white' : ''}`}
          onClick={() => setTypeFilter('all')}
        >
          Tous
        </button>
        {(Object.keys(typeLabel) as NetworkPoint['type'][]).map((type) => (
          <button
            key={type}
            className={`btn-secondary !py-1.5 !px-3 ${typeFilter === type ? '!bg-slate-800 !text-white' : ''}`}
            onClick={() => setTypeFilter(type)}
          >
            {typeLabel[type]}
          </button>
        ))}
      </section>

      <section className="mb-4 grid gap-3 md:grid-cols-4">
        {(Object.keys(typeLabel) as NetworkPoint['type'][]).map((type) => (
          <div key={type} className="card p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">{typeLabel[type]}</div>
            <div className="mt-1 text-2xl font-semibold" style={{ color: typeColor[type] }}>
              {countsByType[type]}
            </div>
          </div>
        ))}
      </section>

      <section className="card overflow-hidden p-0">
        <div className="relative z-0 h-[calc(100vh-290px)] min-h-[460px]">
          <MapContainer center={[36.8, 10.1]} zoom={7} scrollWheelZoom className="h-full w-full">
            <FitBounds points={points} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {points.map((point) => (
              <CircleMarker
                key={point._id}
                center={[point.gps.lat, point.gps.lng]}
                radius={10}
                pathOptions={{
                  color: typeColor[point.type],
                  fillColor: typeColor[point.type],
                  fillOpacity: 0.9,
                }}
              >
                <Popup>
                  <div className="min-w-[220px] space-y-1 text-sm">
                    <div className="font-semibold text-slate-900">{point.name}</div>
                    <div className="text-xs text-slate-500">{typeLabel[point.type]} - {statusLabel[point.status]}</div>
                    {point.address && <div>{point.address}</div>}
                    {point.phone && <div>{point.phone}</div>}
                    {point.responsible && <div>{point.responsible}</div>}
                    {point.internalNotes && <div className="text-xs text-slate-500">{point.internalNotes.slice(0, 80)}</div>}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </section>
    </>
  );
}

function FitBounds({
  points,
}: {
  points: Array<{ gps: { lat: number; lng: number } }>;
}) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const bounds = points.map((point) => [point.gps.lat, point.gps.lng]) as [number, number][];
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [map, points]);

  return null;
}
