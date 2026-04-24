import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { TablePagination } from '../components/TablePagination';
import { useDebouncedValue } from '../lib/hooks';
import type { Franchise, NetworkPoint, PageMeta } from '../lib/types';

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

const statusBadge: Record<NetworkPoint['status'], string> = {
  prospect: 'badge-muted',
  contact: 'badge-info',
  contrat_non_signe: 'badge-warning',
  contrat_signe: 'badge-info',
  actif: 'badge-success',
  suspendu: 'badge-warning',
  resilie: 'badge-danger',
};

const pointSchema = z.object({
  name: z.string().trim().min(1, 'Nom requis').max(200),
  type: z.enum(['franchise', 'activation', 'recharge', 'activation_recharge']),
  status: z.enum(['prospect', 'contact', 'contrat_non_signe', 'contrat_signe', 'actif', 'suspendu', 'resilie']),
  address: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  governorate: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(50).optional(),
  phone2: z.string().trim().max(50).optional(),
  email: z.string().trim().email('Email invalide').max(150).optional().or(z.literal('')),
  responsible: z.string().trim().max(150).optional(),
  schedule: z.string().trim().max(255).optional(),
  gpsLat: z
    .string()
    .optional()
    .refine(
      (value) =>
        value == null ||
        value === '' ||
        (!Number.isNaN(Number(value)) && Number(value) >= -90 && Number(value) <= 90),
      { message: 'Latitude invalide' },
    ),
  gpsLng: z
    .string()
    .optional()
    .refine(
      (value) =>
        value == null ||
        value === '' ||
        (!Number.isNaN(Number(value)) && Number(value) >= -180 && Number(value) <= 180),
      { message: 'Longitude invalide' },
    ),
  commissionPct: z.coerce.number().min(0).max(100).optional(),
  contactDate: z.string().optional(),
  contractDate: z.string().optional(),
  activationDate: z.string().optional(),
  internalNotes: z.string().trim().max(3000).optional(),
  franchiseId: z.string().optional(),
  active: z.boolean().optional(),
});

type PointFormValues = z.infer<typeof pointSchema>;

export function NetworkPointsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 250);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<NetworkPoint | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<NetworkPoint | null>(null);

  const list = useQuery({
    queryKey: ['network-points', debouncedQ, typeFilter, statusFilter, cityFilter, page],
    queryFn: async () =>
      (
        await api.get<{
          points: NetworkPoint[];
          summary: { total: number; mapped: number; byType: Record<string, number> };
          meta: PageMeta;
        }>('/network-points', {
          params: {
            q: debouncedQ || undefined,
            type: typeFilter || undefined,
            status: statusFilter || undefined,
            city: cityFilter || undefined,
            page,
            pageSize: 25,
          },
        })
      ).data,
    refetchInterval: 15_000,
  });

  const mapData = useQuery({
    queryKey: ['network-points-map', typeFilter, statusFilter],
    queryFn: async () =>
      (
        await api.get<{ points: NetworkPoint[]; source: 'network_points' | 'franchises' }>('/network-points/map', {
          params: {
            type: typeFilter || undefined,
            status: statusFilter || undefined,
            fallbackFranchises: 'true',
          },
        })
      ).data,
    refetchInterval: 15_000,
  });

  const pointsWithGps = useMemo(
    () =>
      (mapData.data?.points ?? [])
        .map((point) => {
          const lat = Number(point.gps?.lat);
          const lng = Number(point.gps?.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return { ...point, gps: { lat, lng } };
        })
        .filter(Boolean) as Array<NetworkPoint & { gps: { lat: number; lng: number } }>,
    [mapData.data?.points],
  );

  return (
    <>
      <PageHeader
        title="Reseau & Carte"
        subtitle="Parite points_reseau: filtres, carte, CRUD points commerciaux"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + Nouveau point
          </button>
        }
      />

      <section className="card mb-5 p-0 overflow-hidden">
        <div className="h-[420px]">
          {mapData.isLoading && (
            <div className="flex h-full items-center justify-center bg-slate-50">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
            </div>
          )}
          {!mapData.isLoading && (
          <MapContainer center={[36.8, 10.1]} zoom={7} scrollWheelZoom className="h-full w-full">
            <FitBounds points={pointsWithGps} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {pointsWithGps.map((point) => (
              <CircleMarker
                key={point._id}
                center={[point.gps.lat, point.gps.lng]}
                radius={11}
                pathOptions={{
                  color: '#ffffff',
                  weight: 2,
                  fillColor: typeColor[point.type],
                  fillOpacity: 0.95,
                }}
              >
                <Popup>
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold text-slate-900">{point.name}</div>
                    <div className="text-xs text-slate-500">{typeLabel[point.type]} - {statusLabel[point.status]}</div>
                    {point.address && <div>{point.address}</div>}
                    {point.phone && <div>{point.phone}</div>}
                    {point.responsible && <div>{point.responsible}</div>}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
          )}
        </div>
      </section>

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <MetricCard label="Points actifs" value={String(list.data?.summary.total ?? 0)} />
        <MetricCard label="Points geolocalises" value={String(list.data?.summary.mapped ?? 0)} />
        <MetricCard label="Franchises" value={String(list.data?.summary.byType.franchise ?? 0)} />
        <MetricCard label="Activation+Recharge" value={String(list.data?.summary.byType.activation_recharge ?? 0)} />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_190px_190px_190px]">
          <input
            className="input"
            placeholder="Nom, adresse, responsable..."
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          <select
            className="input"
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous types</option>
            <option value="franchise">Franchise</option>
            <option value="activation">Activation</option>
            <option value="recharge">Recharge</option>
            <option value="activation_recharge">Activation + Recharge</option>
          </select>
          <select
            className="input"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous statuts</option>
            {(Object.keys(statusLabel) as NetworkPoint['status'][]).map((status) => (
              <option key={status} value={status}>{statusLabel[status]}</option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Ville"
            value={cityFilter}
            onChange={(event) => {
              setCityFilter(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Point</th>
              <th className="th">Type</th>
              <th className="th">Statut</th>
              <th className="th">Ville</th>
              <th className="th">Contact</th>
              <th className="th">Coordonnees</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.points ?? []).map((point) => (
              <tr key={point._id}>
                <td className="td">
                  <div className="font-medium text-slate-900">{point.name}</div>
                  <div className="text-xs text-slate-500">{point.responsible || point.address || '—'}</div>
                </td>
                <td className="td">
                  <span className="badge-info" style={{ backgroundColor: `${typeColor[point.type]}22`, color: typeColor[point.type] }}>
                    {typeLabel[point.type]}
                  </span>
                </td>
                <td className="td">
                  <span className={statusBadge[point.status]}>{statusLabel[point.status]}</span>
                </td>
                <td className="td text-slate-600">{[point.city, point.governorate].filter(Boolean).join(', ') || '—'}</td>
                <td className="td text-slate-600">{point.phone || point.email || '—'}</td>
                <td className="td text-slate-600">
                  {point.gps?.lat != null && point.gps?.lng != null ? `${point.gps.lat}, ${point.gps.lng}` : '—'}
                </td>
                <td className="td">
                  <div className="flex justify-end gap-2">
                    <button className="btn-secondary !px-3 !py-1.5" onClick={() => setEditing(point)}>
                      Modifier
                    </button>
                    <button className="btn-danger !px-3 !py-1.5" onClick={() => setDeleting(point)}>
                      Desactiver
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!list.isLoading && (list.data?.points.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={7}>Aucun point reseau pour ce filtre.</td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={list.data?.meta} onPageChange={setPage} className="px-4 py-3" />
      </section>

      {(creating || editing) && (
        <PointFormModal
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['network-points'] });
            qc.invalidateQueries({ queryKey: ['network-points-map'] });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ArchivePointModal
          point={deleting}
          onClose={() => setDeleting(null)}
          onArchived={() => {
            qc.invalidateQueries({ queryKey: ['network-points'] });
            qc.invalidateQueries({ queryKey: ['network-points-map'] });
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}

function PointFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: NetworkPoint | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const franchises = useQuery({
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const {
    register,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PointFormValues>({
    resolver: zodResolver(pointSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          type: initial.type,
          status: initial.status,
          address: initial.address ?? '',
          city: initial.city ?? '',
          governorate: initial.governorate ?? '',
          phone: initial.phone ?? '',
          phone2: initial.phone2 ?? '',
          email: initial.email ?? '',
          responsible: initial.responsible ?? '',
          schedule: initial.schedule ?? '',
          gpsLat: initial.gps?.lat != null ? String(initial.gps.lat) : '',
          gpsLng: initial.gps?.lng != null ? String(initial.gps.lng) : '',
          commissionPct: initial.commissionPct ?? 0,
          contactDate: initial.contactDate ? initial.contactDate.slice(0, 10) : '',
          contractDate: initial.contractDate ? initial.contractDate.slice(0, 10) : '',
          activationDate: initial.activationDate ? initial.activationDate.slice(0, 10) : '',
          internalNotes: initial.internalNotes ?? '',
          franchiseId:
            typeof initial.franchiseId === 'object' && initial.franchiseId
              ? initial.franchiseId._id
              : initial.franchiseId ?? '',
          active: initial.active,
        }
      : {
          name: '',
          type: 'activation_recharge',
          status: 'prospect',
          address: '',
          city: '',
          governorate: '',
          phone: '',
          phone2: '',
          email: '',
          responsible: '',
          schedule: 'Lun-Sam: 09:00-19:00',
          gpsLat: '',
          gpsLng: '',
          commissionPct: 0,
          contactDate: '',
          contractDate: '',
          activationDate: '',
          internalNotes: '',
          franchiseId: '',
          active: true,
        },
  });

  const pointType = watch('type');

  const save = useMutation({
    mutationFn: async (values: PointFormValues) => {
      const latRaw = values.gpsLat?.trim() ?? '';
      const lngRaw = values.gpsLng?.trim() ?? '';
      const hasLat = latRaw.length > 0;
      const hasLng = lngRaw.length > 0;
      if (hasLat !== hasLng) throw new Error('Latitude et longitude doivent etre renseignees ensemble');
      if (values.type === 'franchise' && !values.franchiseId) throw new Error('Franchise requise pour ce type');

      const payload = {
        name: values.name,
        type: values.type,
        status: values.status,
        address: values.address || '',
        city: values.city || '',
        governorate: values.governorate || '',
        phone: values.phone || '',
        phone2: values.phone2 || '',
        email: values.email || '',
        responsible: values.responsible || '',
        schedule: values.schedule || '',
        gps: hasLat && hasLng ? { lat: Number(latRaw), lng: Number(lngRaw) } : null,
        internalNotes: values.internalNotes || '',
        franchiseId: values.franchiseId || null,
        contactDate: values.contactDate || undefined,
        contractDate: values.contractDate || undefined,
        activationDate: values.activationDate || undefined,
        commissionPct: values.commissionPct ?? 0,
        active: values.active,
      };

      if (initial) await api.patch(`/network-points/${initial._id}`, payload);
      else await api.post('/network-points', payload);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : apiError(err).message),
  });

  return (
    <Modal
      open
      size="lg"
      title={initial ? 'Modifier le point reseau' : 'Nouveau point reseau'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="point-form" disabled={isSubmitting || save.isPending}>
            {isSubmitting || save.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <form id="point-form" onSubmit={handleSubmit((values) => save.mutate(values))} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Nom</label>
          <input className="input" {...register('name')} />
          {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>}
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" {...register('type')}>
            <option value="activation_recharge">Activation + Recharge</option>
            <option value="activation">Activation</option>
            <option value="recharge">Recharge</option>
            <option value="franchise">Franchise</option>
          </select>
        </div>
        <div>
          <label className="label">Statut</label>
          <select className="input" {...register('status')}>
            {(Object.keys(statusLabel) as NetworkPoint['status'][]).map((status) => (
              <option key={status} value={status}>{statusLabel[status]}</option>
            ))}
          </select>
        </div>
        {pointType === 'franchise' && (
          <div className="sm:col-span-2">
            <label className="label">Franchise liee</label>
            <select className="input" {...register('franchiseId')}>
              <option value="">Selectionner</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="label">Adresse</label>
          <input className="input" {...register('address')} />
        </div>
        <div>
          <label className="label">Ville</label>
          <input className="input" {...register('city')} />
        </div>
        <div>
          <label className="label">Gouvernorat</label>
          <input className="input" {...register('governorate')} />
        </div>
        <div>
          <label className="label">Telephone</label>
          <input className="input" {...register('phone')} />
        </div>
        <div>
          <label className="label">Telephone 2</label>
          <input className="input" {...register('phone2')} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" {...register('email')} />
          {errors.email && <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>}
        </div>
        <div>
          <label className="label">Responsable</label>
          <input className="input" {...register('responsible')} />
        </div>
        <div>
          <label className="label">Latitude</label>
          <input className="input" {...register('gpsLat')} placeholder="36.861940" />
          {errors.gpsLat && <p className="mt-1 text-xs text-rose-600">{errors.gpsLat.message}</p>}
        </div>
        <div>
          <label className="label">Longitude</label>
          <input className="input" {...register('gpsLng')} placeholder="10.241604" />
          {errors.gpsLng && <p className="mt-1 text-xs text-rose-600">{errors.gpsLng.message}</p>}
        </div>
        <div>
          <label className="label">Commission (%)</label>
          <input className="input" type="number" min={0} max={100} step="0.1" {...register('commissionPct')} />
        </div>
        <div>
          <label className="label">Horaires</label>
          <input className="input" {...register('schedule')} />
        </div>
        <div>
          <label className="label">Date contact</label>
          <input className="input" type="date" {...register('contactDate')} />
        </div>
        <div>
          <label className="label">Date contrat</label>
          <input className="input" type="date" {...register('contractDate')} />
        </div>
        <div>
          <label className="label">Date activation</label>
          <input className="input" type="date" {...register('activationDate')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Notes internes</label>
          <textarea rows={3} className="input" {...register('internalNotes')} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('active')} />
          Point actif
        </label>
        {error && <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}

function ArchivePointModal({
  point,
  onClose,
  onArchived,
}: {
  point: NetworkPoint;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const archive = useMutation({
    mutationFn: async () => {
      await api.delete(`/network-points/${point._id}`);
    },
    onSuccess: onArchived,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      size="sm"
      title="Desactiver ce point"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-danger" onClick={() => archive.mutate()} disabled={archive.isPending}>
            {archive.isPending ? 'Traitement...' : 'Desactiver'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          Le point <span className="font-semibold text-slate-900">{point.name}</span> sera desactive du reseau.
        </p>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{error}</div>}
      </div>
    </Modal>
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
