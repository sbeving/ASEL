import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Award, Eraser, Eye, FileSignature, PackagePlus, ScanLine } from 'lucide-react';
import { CircleMarker, MapContainer, Polygon, Popup, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api, apiError, uploadUrl } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { ContactActions } from '../components/ContactActions';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { ScannerModal } from '../components/ScannerModal';
import { TablePagination } from '../components/TablePagination';
import { MapTileToggle, MapTiles, type MapTileMode } from '../components/MapTiles';
import { useDebouncedValue } from '../lib/hooks';
import { dateTime, money } from '../lib/money';
import type { CommercialZone, Franchise, NetworkPoint, NetworkPointAllocation, PageMeta, Product, User } from '../lib/types';

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

const networkMapLegendItems = [
  { label: typeLabel.franchise, color: typeColor.franchise },
  { label: typeLabel.activation, color: typeColor.activation },
  { label: typeLabel.recharge, color: typeColor.recharge },
  { label: typeLabel.activation_recharge, color: typeColor.activation_recharge },
];

const statusBadge: Record<NetworkPoint['status'], string> = {
  prospect: 'badge-muted',
  contact: 'badge-info',
  contrat_non_signe: 'badge-warning',
  contrat_signe: 'badge-info',
  actif: 'badge-success',
  suspendu: 'badge-warning',
  resilie: 'badge-danger',
};

const leadStatusLabel: Record<NonNullable<NetworkPoint['leadStatus']>, string> = {
  lead: 'Lead',
  contacted: 'Contacte',
  qualified: 'Qualifie',
  contract_given: 'Contrat donne',
  won: 'Gagne',
  lost: 'Perdu',
};

const allocationKindLabel: Record<NetworkPointAllocation['kind'], string> = {
  sim: 'SIM',
  recharge: 'Solde recharge',
  other: 'Autre',
};

type AllocationSummary = {
  quantity: number;
  amount: number;
  barcodeCount: number;
  byKind: Record<string, { quantity: number; amount: number; barcodeCount: number }>;
};

type NetworkPointOverview = {
  point: NetworkPoint;
  allocations: NetworkPointAllocation[];
  monthly: AllocationSummary;
  totals: AllocationSummary;
};

type PointRecommendation = NonNullable<NonNullable<NetworkPoint['allocationStats']>['recommendation']>;

type NetworkPointAnalyticsRow = {
  point: NetworkPoint;
  allocationStats: NonNullable<NetworkPoint['allocationStats']>;
  privilegeScore: number;
};

type NetworkPointAnalytics = {
  totals: {
    points: number;
    active: number;
    totalSims: number;
    totalRecharge: number;
    monthlySims: number;
    monthlyRecharge: number;
    dormant: number;
    toReview: number;
  };
  byRecommendation: Record<string, number>;
  bestPoints: NetworkPointAnalyticsRow[];
  dormantPoints: NetworkPointAnalyticsRow[];
  reviewPoints: NetworkPointAnalyticsRow[];
  dormantDays: number;
};

const recommendationLabel: Record<PointRecommendation, string> = {
  worthy: 'A renforcer',
  watch: 'A surveiller',
  review: 'A qualifier',
  dormant: 'Dormant',
  revoke_candidate: 'Retrait possible',
  revoked: 'Retire',
};

const recommendationBadge: Record<PointRecommendation, string> = {
  worthy: 'badge-success',
  watch: 'badge-info',
  review: 'badge-warning',
  dormant: 'badge-warning',
  revoke_candidate: 'badge-danger',
  revoked: 'badge-muted',
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
  responsibleFirstName: z.string().trim().max(80).optional(),
  responsibleLastName: z.string().trim().max(80).optional(),
  cin: z.string().trim().max(40).optional(),
  leadStatus: z.enum(['lead', 'contacted', 'qualified', 'contract_given', 'won', 'lost']).optional(),
  contractGiven: z.boolean().optional(),
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
  lastContactedAt: z.string().optional(),
  contractDate: z.string().optional(),
  activationDate: z.string().optional(),
  internalNotes: z.string().trim().max(3000).optional(),
  franchiseId: z.string().optional(),
  commercialId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

type PointFormValues = z.infer<typeof pointSchema>;

export function NetworkPointsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 250);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [dormantDays, setDormantDays] = useState(30);
  const [mapTileMode, setMapTileMode] = useState<MapTileMode>('street');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<NetworkPoint | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<NetworkPoint | null>(null);
  const [allocating, setAllocating] = useState<NetworkPoint | null>(null);
  const [viewing, setViewing] = useState<NetworkPoint | null>(null);
  const [documenting, setDocumenting] = useState<NetworkPoint | null>(null);
  const highAccess =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'commercial_director';
  const canCreatePoints = highAccess || user?.role === 'franchise' || user?.role === 'commercial';
  const canEditPoints = canCreatePoints;
  const canManageDotations = highAccess || user?.role === 'franchise';
  const canArchivePoints = highAccess;

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
        await api.get<{ points: NetworkPoint[]; zones: CommercialZone[]; source: 'network_points' | 'franchises' }>('/network-points/map', {
          params: {
            type: typeFilter || undefined,
            status: statusFilter || undefined,
            fallbackFranchises: 'true',
          },
        })
      ).data,
    refetchInterval: 15_000,
  });

  const analytics = useQuery({
    queryKey: ['network-points-analytics', typeFilter, statusFilter, cityFilter, dormantDays],
    queryFn: async () =>
      (
        await api.get<NetworkPointAnalytics>('/network-points/analytics', {
          params: {
            type: typeFilter || undefined,
            status: statusFilter || undefined,
            city: cityFilter || undefined,
            dormantDays,
          },
        })
      ).data,
    refetchInterval: 30_000,
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
          canCreatePoints ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + Nouveau point
            </button>
          ) : null
        }
      />

      <section className="card mb-5 overflow-hidden p-0">
        <div className="relative h-[420px]">
          {mapData.isLoading && (
            <div className="flex h-full items-center justify-center bg-slate-50">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
            </div>
          )}
          {!mapData.isLoading && (
          <MapContainer center={[36.8, 10.1]} zoom={7} scrollWheelZoom className="h-full w-full">
            <FitBounds points={pointsWithGps} />
            <MapTiles mode={mapTileMode} />
            {(mapData.data?.zones ?? []).map((zone) => (
              <Polygon
                key={zone._id}
                positions={zone.polygon.map((point) => [point.lat, point.lng])}
                pathOptions={{
                  color: zone.color || '#2563eb',
                  fillColor: zone.color || '#2563eb',
                  fillOpacity: 0.1,
                  weight: 2,
                }}
              />
            ))}
            {pointsWithGps.map((point) => (
              <CircleMarker
                key={point._id}
                center={[point.gps.lat, point.gps.lng]}
                radius={12}
                pathOptions={{
                  color: '#0F172A',
                  weight: 2.5,
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
          <MapTileToggle value={mapTileMode} onChange={setMapTileMode} className="absolute right-3 top-3" />
          <NetworkMapLegend items={networkMapLegendItems} />
        </div>
      </section>

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <MetricCard label="Points reseau" value={String(analytics.data?.totals.points ?? list.data?.summary.total ?? 0)} />
        <MetricCard label="SIM ce mois" value={String(analytics.data?.totals.monthlySims ?? 0)} />
        <MetricCard label="Recharge ce mois" value={money(analytics.data?.totals.monthlyRecharge ?? 0)} />
        <MetricCard label="A revoir" value={String(analytics.data?.totals.toReview ?? 0)} tone={(analytics.data?.totals.toReview ?? 0) > 0 ? 'danger' : 'default'} />
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Award className="h-4 w-4 text-emerald-600" />
                Meilleurs points
              </div>
              <div className="text-xs text-slate-500">Plus forte dotation SIM/recharge recente</div>
            </div>
            <span className="badge-success">{analytics.data?.totals.totalSims ?? 0} SIM total</span>
          </div>
          <AnalyticsRows rows={analytics.data?.bestPoints ?? []} empty="Aucune dotation analysee." />
        </div>
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Dormants / privileges a revoir
              </div>
              <div className="text-xs text-slate-500">Points sans dotation recente ou statut a risque</div>
            </div>
            <select
              className="input h-9 w-32 !py-1 text-xs"
              value={dormantDays}
              onChange={(event) => setDormantDays(Number(event.target.value) || 30)}
            >
              <option value={30}>30 jours</option>
              <option value={60}>60 jours</option>
              <option value={90}>90 jours</option>
            </select>
          </div>
          <AnalyticsRows rows={analytics.data?.reviewPoints ?? []} empty="Aucun point a risque sur ce filtre." />
        </div>
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
        {list.isError && (
          <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
            {apiError(list.error).message}
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Point</th>
              <th className="th">Type</th>
              <th className="th">Statut</th>
              <th className="th">Ville</th>
              <th className="th">Contact</th>
              <th className="th text-right">SIM mois</th>
              <th className="th text-right">Recharge mois</th>
              <th className="th">Derniere dotation</th>
              <th className="th">Decision</th>
              <th className="th">Coordonnees</th>
              <th className="th-action">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.points ?? []).map((point) => {
              const stats = point.allocationStats;
              const recommendation = stats?.recommendation ?? 'watch';
              return (
                <tr key={point._id}>
                  <td className="td-action">
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
                    <div className="mt-1 text-xs font-medium text-slate-500">
                      {leadStatusLabel[point.leadStatus ?? 'lead']}
                      {point.contractGiven ? ' • Contrat donne' : ''}
                    </div>
                  </td>
                  <td className="td text-slate-600">{[point.city, point.governorate].filter(Boolean).join(', ') || '—'}</td>
                  <td className="td text-slate-600">
                    <div>{point.phone || point.email || '—'}</div>
                    <ContactActions
                      phone={point.phone}
                      phone2={point.phone2}
                      message={`Bonjour ${point.responsible || point.name}, ici ASEL Mobile Tunisie.`}
                      compact
                      className="mt-2"
                    />
                  </td>
                  <td className="td text-right font-semibold text-slate-900">{stats?.monthlySims ?? 0}</td>
                  <td className="td text-right font-semibold text-slate-900">{money(stats?.monthlyRecharge ?? 0)}</td>
                  <td className="td text-slate-600">
                    {stats?.lastAllocationAt ? dateTime(stats.lastAllocationAt) : 'Jamais'}
                    {stats?.daysSinceAllocation != null && (
                      <div className="text-xs text-slate-400">{stats.daysSinceAllocation} j</div>
                    )}
                  </td>
                  <td className="td">
                    <span className={recommendationBadge[recommendation]}>{recommendationLabel[recommendation]}</span>
                  </td>
                  <td className="td text-slate-600">
                    {point.gps?.lat != null && point.gps?.lng != null ? `${point.gps.lat}, ${point.gps.lng}` : '—'}
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-2">
                      <button className="btn-secondary !px-3 !py-1.5" onClick={() => setViewing(point)}>
                        <Eye className="h-4 w-4" />
                        <span className="hidden lg:inline">Voir</span>
                      </button>
                      {canEditPoints && (
                        <button className="btn-secondary !px-3 !py-1.5" onClick={() => setDocumenting(point)}>
                          <FileSignature className="h-4 w-4" />
                          <span className="hidden lg:inline">Fiche</span>
                        </button>
                      )}
                      {canManageDotations && (
                        <button className="btn-secondary !px-3 !py-1.5" onClick={() => setAllocating(point)}>
                          <PackagePlus className="h-4 w-4" />
                          <span className="hidden lg:inline">Dotation</span>
                        </button>
                      )}
                      {canEditPoints && (
                        <button className="btn-secondary !px-3 !py-1.5" onClick={() => setEditing(point)}>
                          Modifier
                        </button>
                      )}
                      {canArchivePoints && (
                        <button className="btn-danger !px-3 !py-1.5" onClick={() => setDeleting(point)}>
                          Desactiver
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {list.isLoading && (
              <tr>
                <td className="td text-slate-400" colSpan={11}>Chargement des points reseau...</td>
              </tr>
            )}
            {!list.isLoading && (list.data?.points.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={11}>Aucun point reseau pour ce filtre.</td>
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
          onSaved={(savedPoint) => {
            qc.invalidateQueries({ queryKey: ['network-points'] });
            qc.invalidateQueries({ queryKey: ['network-points-map'] });
            if (!editing && savedPoint) setDocumenting(savedPoint);
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

      {allocating && (
        <AllocationModal
          point={allocating}
          onClose={() => setAllocating(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['network-point-allocations', allocating._id] });
            qc.invalidateQueries({ queryKey: ['network-point-overview', allocating._id] });
            qc.invalidateQueries({ queryKey: ['network-points'] });
            qc.invalidateQueries({ queryKey: ['stock'] });
            setAllocating(null);
          }}
        />
      )}

      {viewing && (
        <PointDetailModal
          point={viewing}
          onClose={() => setViewing(null)}
          onEditDocuments={(pointToDocument) => {
            setViewing(null);
            setDocumenting(pointToDocument);
          }}
        />
      )}

      {documenting && (
        <PointDocumentsModal
          point={documenting}
          onClose={() => setDocumenting(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['network-points'] });
            qc.invalidateQueries({ queryKey: ['network-points-map'] });
            qc.invalidateQueries({ queryKey: ['network-point-overview', documenting._id] });
            setDocumenting(null);
          }}
        />
      )}
    </>
  );
}

function pointFranchiseId(point: NetworkPoint) {
  if (!point.franchiseId) return '';
  return typeof point.franchiseId === 'object' ? point.franchiseId._id : point.franchiseId;
}

function productDisplay(product?: Product | string | null) {
  if (!product) return 'Solde recharge';
  if (typeof product === 'string') return product;
  return [product.name, product.reference || product.barcode].filter(Boolean).join(' - ');
}

function franchiseDisplay(franchise: Franchise | string) {
  return typeof franchise === 'string' ? franchise : franchise.name;
}

function uniqueCodesFromText(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,;\s]+/)
        .map((code) => code.trim())
        .filter(Boolean),
    ),
  ];
}

function AllocationModal({
  point,
  onClose,
  onSaved,
}: {
  point: NetworkPoint;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const isGlobalAllocator =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'commercial_director';
  const [franchiseId, setFranchiseId] = useState(pointFranchiseId(point));
  const [productId, setProductId] = useState('');
  const [kind, setKind] = useState<NetworkPointAllocation['kind']>('sim');
  const [quantity, setQuantity] = useState('1');
  const [amount, setAmount] = useState('');
  const [barcodesText, setBarcodesText] = useState('');
  const [note, setNote] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const barcodes = useMemo(() => uniqueCodesFromText(barcodesText), [barcodesText]);
  const effectiveQuantity = kind === 'sim' ? barcodes.length : Math.max(0, Number(quantity) || 0);

  const products = useQuery({
    enabled: kind === 'sim',
    queryKey: ['products', 'allocation-products'],
    queryFn: async () =>
      (
        await api.get<{ products: Product[] }>('/products', {
          params: { active: 'true', pageSize: 500 },
        })
      ).data.products,
  });

  const franchises = useQuery({
    enabled: isGlobalAllocator,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const allocations = useQuery({
    queryKey: ['network-point-allocations', point._id],
    queryFn: async () =>
      (await api.get<{ allocations: NetworkPointAllocation[] }>(`/network-points/${point._id}/allocations`)).data
        .allocations,
  });

  const createAllocation = useMutation({
    mutationFn: async () => {
      if (isGlobalAllocator && !franchiseId) throw new Error('Franchise source requise');
      if (kind === 'sim') {
        if (!productId) throw new Error('Produit SIM requis');
        if (barcodes.length === 0) throw new Error('Scannez au moins une SIM');
      }
      if (kind === 'recharge' && Number(amount) <= 0) throw new Error('Montant solde requis');

      await api.post(`/network-points/${point._id}/allocations`, {
        franchiseId: isGlobalAllocator ? franchiseId : undefined,
        productId: kind === 'sim' ? productId : undefined,
        kind,
        quantity: effectiveQuantity,
        amount: kind === 'recharge' ? Number(amount) : undefined,
        barcodes: kind === 'sim' ? barcodes : [],
        note,
      });
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : apiError(err).message),
  });

  const appendBarcode = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const next = [...new Set([...barcodes, code])];
    setBarcodesText(next.join('\n'));
    setScannerError(next.length === barcodes.length ? 'Code deja scanne, scanner toujours ouvert.' : null);
  };

  return (
    <Modal
      open
      size="lg"
      title={`Dotation - ${point.name}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Fermer</button>
          <button className="btn-primary" onClick={() => createAllocation.mutate()} disabled={createAllocation.isPending}>
            {createAllocation.isPending ? 'Enregistrement...' : 'Enregistrer dotation'}
          </button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="space-y-3">
          {isGlobalAllocator && (
            <div>
              <label className="label">Franchise source</label>
              <select className="input" value={franchiseId} onChange={(event) => setFranchiseId(event.target.value)}>
                <option value="">Selectionner</option>
                {(franchises.data ?? []).map((franchise) => (
                  <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Type</label>
              <select
                className="input"
                value={kind}
                onChange={(event) => {
                  const nextKind = event.target.value as NetworkPointAllocation['kind'];
                  setKind(nextKind);
                  setError(null);
                }}
              >
                {(Object.keys(allocationKindLabel) as NetworkPointAllocation['kind'][]).map((value) => (
                  <option key={value} value={value}>{allocationKindLabel[value]}</option>
                ))}
              </select>
            </div>
            {kind === 'recharge' ? (
              <div>
                <label className="label">Solde donne (TND)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.001"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
            ) : (
              <div>
                <label className="label">Quantite</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={kind === 'sim' ? String(effectiveQuantity) : quantity}
                  readOnly={kind === 'sim'}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>
            )}
          </div>
          {kind === 'sim' && (
            <div>
              <label className="label">Produit SIM</label>
              <select className="input" value={productId} onChange={(event) => setProductId(event.target.value)}>
                <option value="">Selectionner un produit SIM</option>
                {(products.data ?? []).map((product) => (
                  <option key={product._id} value={product._id}>
                    {productDisplay(product)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {kind === 'sim' && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="label mb-0">Codes barres SIM</label>
              <button
                type="button"
                className="btn-secondary !px-3 !py-1.5"
                onClick={() => {
                  setScannerError(null);
                  setScannerOpen(true);
                }}
              >
                <ScanLine className="h-4 w-4" />
                Scanner
              </button>
            </div>
            <textarea
              rows={6}
              className="input font-mono text-xs"
              placeholder="Un code par ligne"
              value={barcodesText}
              onChange={(event) => setBarcodesText(event.target.value)}
            />
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{barcodes.length} code(s) unique(s)</span>
              {kind === 'sim' && <span className="badge-info">1 code = 1 SIM</span>}
            </div>
            {scannerError && <p className="mt-1 text-xs text-amber-700">{scannerError}</p>}
          </div>
          )}
          <div>
            <label className="label">Note</label>
            <textarea rows={3} className="input" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">Historique dotations</div>
              <div className="text-xs text-slate-500">SIM, recharge et notes du point</div>
            </div>
            <span className="badge-muted">{allocations.data?.length ?? 0}</span>
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {(allocations.data ?? []).map((allocation) => (
              <div key={allocation._id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">
                      {allocation.kind === 'recharge' ? money(allocation.amount) : productDisplay(allocation.productId)}
                    </div>
                    <div className="text-xs text-slate-500">{franchiseDisplay(allocation.franchiseId)}</div>
                  </div>
                  <span className="badge-info">
                    {allocation.kind === 'recharge'
                      ? allocationKindLabel[allocation.kind]
                      : `${allocationKindLabel[allocation.kind]} x${allocation.quantity}`}
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-500">{dateTime(allocation.createdAt)}</div>
                {allocation.barcodes.length > 0 && (
                  <div className="mt-2 line-clamp-2 font-mono text-xs text-slate-600">
                    {allocation.barcodes.join(', ')}
                  </div>
                )}
                {allocation.note && <div className="mt-2 text-xs text-slate-600">{allocation.note}</div>}
              </div>
            ))}
            {!allocations.isLoading && (allocations.data?.length ?? 0) === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                Aucune dotation enregistree pour ce point.
              </div>
            )}
          </div>
        </div>
      </div>

      {scannerOpen && (
        <ScannerModal
          onClose={() => setScannerOpen(false)}
          onError={setScannerError}
          onScan={appendBarcode}
        />
      )}
    </Modal>
  );
}

function PointDetailModal({
  point,
  onClose,
  onEditDocuments,
}: {
  point: NetworkPoint;
  onClose: () => void;
  onEditDocuments: (point: NetworkPoint) => void;
}) {
  const overview = useQuery({
    queryKey: ['network-point-overview', point._id],
    queryFn: async () => (await api.get<NetworkPointOverview>(`/network-points/${point._id}/overview`)).data,
  });
  const current = overview.data?.point ?? point;
  const documents = current.documents ?? {};
  const monthlySims = overview.data?.monthly.byKind.sim?.barcodeCount ?? overview.data?.monthly.byKind.sim?.quantity ?? 0;
  const totalSims = overview.data?.totals.byKind.sim?.barcodeCount ?? overview.data?.totals.byKind.sim?.quantity ?? 0;
  const monthlySolde = overview.data?.monthly.byKind.recharge?.amount ?? 0;
  const totalSolde = overview.data?.totals.byKind.recharge?.amount ?? 0;

  return (
    <Modal
      open
      size="xl"
      title={`Voir - ${current.name}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => onEditDocuments(current)}>
            <FileSignature className="h-4 w-4" />
            Fiche
          </button>
          <button className="btn-primary" onClick={onClose}>Fermer</button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailItem label="Type" value={typeLabel[current.type]} />
            <DetailItem label="Statut" value={statusLabel[current.status]} />
            <DetailItem label="Responsable" value={current.responsible} />
            <DetailItem label="CIN" value={current.cin} />
            <DetailItem label="Telephone 1" value={current.phone} />
            <DetailItem label="Telephone 2" value={current.phone2} />
            <DetailItem label="Email" value={current.email} />
            <DetailItem label="Adresse" value={[current.address, current.city, current.governorate].filter(Boolean).join(', ')} />
            <DetailItem
              label="GPS"
              value={current.gps?.lat != null && current.gps?.lng != null ? `${current.gps.lat}, ${current.gps.lng}` : ''}
            />
            <DetailItem label="Horaires" value={current.schedule} />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <MetricCard label="SIMs ce mois" value={String(monthlySims)} />
            <MetricCard label="Solde ce mois" value={money(monthlySolde)} />
            <MetricCard label="SIMs total" value={String(totalSims)} />
            <MetricCard label="Solde total" value={money(totalSolde)} />
          </div>

          <div className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
              Dotations recentes
            </div>
            <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {(overview.data?.allocations ?? []).map((allocation) => (
                <div key={allocation._id} className="px-3 py-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">
                        {allocation.kind === 'recharge' ? money(allocation.amount) : productDisplay(allocation.productId)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {allocationKindLabel[allocation.kind]} - {franchiseDisplay(allocation.franchiseId)}
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div>{dateTime(allocation.createdAt)}</div>
                      {allocation.kind !== 'recharge' && <div>{allocation.quantity} unite(s)</div>}
                    </div>
                  </div>
                  {allocation.barcodes.length > 0 && (
                    <div className="mt-1 line-clamp-2 font-mono text-xs text-slate-600">
                      {allocation.barcodes.join(', ')}
                    </div>
                  )}
                  {allocation.note && <div className="mt-1 text-xs text-slate-600">{allocation.note}</div>}
                </div>
              ))}
              {!overview.isLoading && (overview.data?.allocations.length ?? 0) === 0 && (
                <div className="px-3 py-4 text-sm text-slate-500">Aucune dotation rattachee a ce point.</div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <DocumentPreview label="Fiche PDF signee" path={documents.infoSheetPdfPath} />
          <DocumentPreview label="Preuve CIN" path={documents.cinImagePath} image />
          <DocumentPreview label="Image boutique" path={documents.shopImagePath} image />
          <DocumentPreview label="Signature" path={documents.signaturePath} image />
          {documents.signedAt && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Signe le {dateTime(documents.signedAt)}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PointDocumentsModal({
  point,
  onClose,
  onSaved,
}: {
  point: NetworkPoint;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [responsible, setResponsible] = useState(point.responsible ?? '');
  const [responsibleFirstName, setResponsibleFirstName] = useState(point.responsibleFirstName ?? '');
  const [responsibleLastName, setResponsibleLastName] = useState(point.responsibleLastName ?? '');
  const [cin, setCin] = useState(point.cin ?? '');
  const [cinImage, setCinImage] = useState<File | null>(null);
  const [shopImage, setShopImage] = useState<File | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const saveDocuments = useMutation({
    mutationFn: async () => {
      if (!signatureDataUrl && !point.documents?.signaturePath) throw new Error('Signature electronique requise');
      const formData = new FormData();
      formData.append('responsible', responsible);
      formData.append('responsibleFirstName', responsibleFirstName);
      formData.append('responsibleLastName', responsibleLastName);
      formData.append('cin', cin);
      formData.append('signatureText', responsible || [responsibleFirstName, responsibleLastName].filter(Boolean).join(' ') || point.name);
      if (cinImage) formData.append('cinImage', cinImage);
      if (shopImage) formData.append('shopImage', shopImage);
      if (signatureDataUrl) formData.append('signatureDataUrl', signatureDataUrl);
      await api.post(`/network-points/${point._id}/documents`, formData);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : apiError(err).message),
  });

  return (
    <Modal
      open
      size="lg"
      title={`Fiche de renseignement - ${point.name}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="point-documents-form" disabled={saveDocuments.isPending}>
            {saveDocuments.isPending ? 'Generation...' : 'Generer fiche PDF'}
          </button>
        </div>
      }
    >
      <form
        id="point-documents-form"
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          saveDocuments.mutate();
        }}
      >
        <div>
          <label className="label">Prenom responsable</label>
          <input className="input" value={responsibleFirstName} onChange={(event) => setResponsibleFirstName(event.target.value)} />
        </div>
        <div>
          <label className="label">Nom responsable</label>
          <input className="input" value={responsibleLastName} onChange={(event) => setResponsibleLastName(event.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Responsable affiche</label>
          <input className="input" value={responsible} onChange={(event) => setResponsible(event.target.value)} />
        </div>
        <div>
          <label className="label">Numero CIN</label>
          <input className="input" value={cin} onChange={(event) => setCin(event.target.value)} />
        </div>
        <div>
          <label className="label">Preuve CIN</label>
          <input
            className="input"
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => setCinImage(event.target.files?.[0] ?? null)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Image boutique</label>
          <input
            className="input"
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => setShopImage(event.target.files?.[0] ?? null)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Signature electronique du responsable</label>
          <SignaturePad onChange={setSignatureDataUrl} />
          {point.documents?.signaturePath && !signatureDataUrl && (
            <p className="mt-1 text-xs text-slate-500">Signature existante conservee si vous ne signez pas a nouveau.</p>
          )}
        </div>
        {error && <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const prepareCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.floor(176 * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, rect.width, 176);
    context.strokeStyle = '#0f172a';
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
  };

  useEffect(() => {
    prepareCanvas();
  }, []);

  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = pointFromEvent(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const stopDrawing = () => {
    const canvas = canvasRef.current;
    if (!drawingRef.current || !canvas) return;
    drawingRef.current = false;
    onChange(canvas.toDataURL('image/png'));
  };

  const clear = () => {
    prepareCanvas();
    onChange('');
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2">
      <canvas
        ref={canvasRef}
        className="h-44 w-full touch-none rounded-md border border-dashed border-slate-300"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
      />
      <div className="mt-2 flex justify-end">
        <button type="button" className="btn-secondary !px-3 !py-1.5" onClick={clear}>
          <Eraser className="h-4 w-4" />
          Effacer
        </button>
      </div>
    </div>
  );
}

function PointLocationPicker({
  value,
  onChange,
}: {
  value: { lat: number; lng: number } | null;
  onChange: (value: { lat: number; lng: number }) => void;
}) {
  const [tileMode, setTileMode] = useState<MapTileMode>('satellite');
  const center: [number, number] = value ? [value.lat, value.lng] : [36.8065, 10.1815];
  return (
    <div className="relative h-72 overflow-hidden rounded-lg border border-slate-200">
      <MapContainer center={center} zoom={value ? 14 : 7} scrollWheelZoom className="h-full w-full">
        <MapTiles mode={tileMode} />
        <PointPickerClicker onChange={onChange} />
        <PointPickerSync value={value} />
        {value && (
          <CircleMarker
            center={[value.lat, value.lng]}
            radius={10}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }}
          />
        )}
      </MapContainer>
      <MapTileToggle value={tileMode} onChange={setTileMode} className="absolute right-3 top-3" />
    </div>
  );
}

function PointPickerClicker({ onChange }: { onChange: (value: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(event) {
      onChange({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function PointPickerSync({ value }: { value: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!value) return;
    map.setView([value.lat, value.lng], Math.max(map.getZoom(), 14));
  }, [map, value]);
  return null;
}

function DetailItem({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-slate-900">{value || '-'}</div>
    </div>
  );
}

function DocumentPreview({ label, path, image }: { label: string; path?: string | null; image?: boolean }) {
  if (!path) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-500">
        {label}: non joint
      </div>
    );
  }
  const url = uploadUrl(path);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 text-sm font-semibold text-slate-900">{label}</div>
      {image && !path.toLowerCase().endsWith('.pdf') && (
        <img src={url} alt={label} className="mb-2 max-h-40 w-full rounded-md object-contain bg-slate-50" />
      )}
      <a className="text-sm font-medium text-brand-700 hover:text-brand-800" href={url} target="_blank" rel="noreferrer">
        Ouvrir le document
      </a>
    </div>
  );
}

function PointFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: NetworkPoint | null;
  onClose: () => void;
  onSaved: (point?: NetworkPoint) => void;
}) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const canAssignCommercial =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'commercial_director';
  const franchises = useQuery({
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });
  const users = useQuery({
    enabled: canAssignCommercial,
    queryKey: ['users', 'commercials-for-point-form'],
    queryFn: async () => (await api.get<{ users: User[] }>('/users')).data.users,
  });

  const {
    register,
    watch,
    handleSubmit,
    setValue,
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
          responsibleFirstName: initial.responsibleFirstName ?? '',
          responsibleLastName: initial.responsibleLastName ?? '',
          cin: initial.cin ?? '',
          leadStatus: initial.leadStatus ?? 'lead',
          contractGiven: initial.contractGiven ?? false,
          schedule: initial.schedule ?? '',
          gpsLat: initial.gps?.lat != null ? String(initial.gps.lat) : '',
          gpsLng: initial.gps?.lng != null ? String(initial.gps.lng) : '',
          commissionPct: initial.commissionPct ?? 0,
          contactDate: initial.contactDate ? initial.contactDate.slice(0, 10) : '',
          lastContactedAt: initial.lastContactedAt ? initial.lastContactedAt.slice(0, 10) : '',
          contractDate: initial.contractDate ? initial.contractDate.slice(0, 10) : '',
          activationDate: initial.activationDate ? initial.activationDate.slice(0, 10) : '',
          internalNotes: initial.internalNotes ?? '',
          franchiseId:
            typeof initial.franchiseId === 'object' && initial.franchiseId
              ? initial.franchiseId._id
              : initial.franchiseId ?? '',
          commercialId:
            typeof initial.commercialId === 'object' && initial.commercialId
              ? initial.commercialId._id || initial.commercialId.id
              : initial.commercialId ?? '',
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
          responsibleFirstName: '',
          responsibleLastName: '',
          cin: '',
          leadStatus: 'lead',
          contractGiven: false,
          schedule: 'Lun-Sam: 09:00-19:00',
          gpsLat: '',
          gpsLng: '',
          commissionPct: 0,
          contactDate: '',
          lastContactedAt: '',
          contractDate: '',
          activationDate: '',
          internalNotes: '',
          franchiseId: '',
          commercialId: '',
          active: true,
        },
  });

  const pointType = watch('type');
  const watchedLat = watch('gpsLat');
  const watchedLng = watch('gpsLng');
  const selectedGps = useMemo(() => {
    const lat = Number(watchedLat);
    const lng = Number(watchedLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [watchedLat, watchedLng]);

  const fillCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocalisation non disponible sur cet appareil');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setValue('gpsLat', position.coords.latitude.toFixed(6), { shouldDirty: true, shouldValidate: true });
        setValue('gpsLng', position.coords.longitude.toFixed(6), { shouldDirty: true, shouldValidate: true });
        setError(null);
      },
      () => setError('Impossible de recuperer la position actuelle'),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  };

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
        responsibleFirstName: values.responsibleFirstName || '',
        responsibleLastName: values.responsibleLastName || '',
        cin: values.cin || '',
        leadStatus: values.contractGiven ? 'contract_given' : values.leadStatus || 'lead',
        contractGiven: values.contractGiven ?? false,
        schedule: values.schedule || '',
        gps: hasLat && hasLng ? { lat: Number(latRaw), lng: Number(lngRaw) } : null,
        internalNotes: values.internalNotes || '',
        franchiseId: values.franchiseId || null,
        commercialId: values.commercialId || null,
        contactDate: values.contactDate || undefined,
        lastContactedAt: values.lastContactedAt || undefined,
        contractDate: values.contractDate || undefined,
        activationDate: values.activationDate || undefined,
        commissionPct: values.commissionPct ?? 0,
        active: values.active,
      };

      const response = initial
        ? await api.patch<{ point: NetworkPoint }>(`/network-points/${initial._id}`, payload)
        : await api.post<{ point: NetworkPoint }>('/network-points', payload);
      return response.data.point;
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
        {canAssignCommercial && (
          <div className="sm:col-span-2">
            <label className="label">Commercial responsable</label>
            <select className="input" {...register('commercialId')}>
              <option value="">-</option>
              {(users.data ?? [])
                .filter((row) => row.role === 'commercial' && row.active !== false)
                .map((commercial) => (
                  <option key={commercial._id || commercial.id} value={commercial._id || commercial.id}>
                    {commercial.fullName}
                  </option>
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
          <label className="label">Prenom responsable</label>
          <input className="input" {...register('responsibleFirstName')} />
        </div>
        <div>
          <label className="label">Nom responsable</label>
          <input className="input" {...register('responsibleLastName')} />
        </div>
        <div>
          <label className="label">CIN</label>
          <input className="input" {...register('cin')} />
        </div>
        <div>
          <label className="label">Statut lead</label>
          <select className="input" {...register('leadStatus')}>
            {(Object.keys(leadStatusLabel) as NonNullable<NetworkPoint['leadStatus']>[]).map((status) => (
              <option key={status} value={status}>{leadStatusLabel[status]}</option>
            ))}
          </select>
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
        <div className="sm:col-span-2">
          <button type="button" className="btn-secondary w-full" onClick={fillCurrentLocation}>
            Utiliser position actuelle
          </button>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Choisir sur la carte</label>
          <PointLocationPicker
            value={selectedGps}
            onChange={(gps) => {
              setValue('gpsLat', gps.lat.toFixed(6), { shouldDirty: true, shouldValidate: true });
              setValue('gpsLng', gps.lng.toFixed(6), { shouldDirty: true, shouldValidate: true });
            }}
          />
          <p className="mt-1 text-xs text-slate-500">Cliquez sur la carte pour positionner exactement le point de vente ou recharge.</p>
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
          <label className="label">Dernier contact</label>
          <input className="input" type="date" {...register('lastContactedAt')} />
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
        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('contractGiven')} />
          Contrat donne au point
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

function AnalyticsRows({ rows, empty }: { rows: NetworkPointAnalyticsRow[]; empty: string }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        {empty}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const recommendation = row.allocationStats.recommendation ?? 'watch';
        return (
          <div key={row.point._id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{row.point.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {[row.point.city, typeof row.point.commercialId === 'object' ? row.point.commercialId?.fullName : '']
                    .filter(Boolean)
                    .join(' | ') || typeLabel[row.point.type]}
                </div>
              </div>
              <span className={recommendationBadge[recommendation]}>{recommendationLabel[recommendation]}</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-md bg-slate-50 px-2 py-1">
                <div className="font-bold text-slate-900">{row.allocationStats.monthlySims}</div>
                <div className="text-slate-500">SIM mois</div>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-1">
                <div className="font-bold text-slate-900">{money(row.allocationStats.monthlyRecharge)}</div>
                <div className="text-slate-500">Recharge</div>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-1">
                <div className="font-bold text-slate-900">{row.allocationStats.totalSims}</div>
                <div className="text-slate-500">SIM total</div>
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-1">
                <div className="font-bold text-slate-900">
                  {row.allocationStats.daysSinceAllocation == null ? '-' : `${row.allocationStats.daysSinceAllocation}j`}
                </div>
                <div className="text-slate-500">Inactif</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={tone === 'danger' ? 'mt-1 text-2xl font-semibold text-rose-700' : 'mt-1 text-2xl font-semibold text-slate-900'}>
        {value}
      </div>
    </div>
  );
}

function NetworkMapLegend({ items }: { items: Array<{ label: string; color: string }> }) {
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
