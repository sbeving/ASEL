import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { dateTime } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { TablePagination } from '../components/TablePagination';
import { useDebouncedValue } from '../lib/hooks';
import type { Demand, DemandSummary, Franchise, PageMeta, Product } from '../lib/types';

const createSchema = z.object({
  franchiseId: z.string().optional(),
  productId: z.string().optional(),
  productName: z.string().max(200).optional(),
  quantity: z.coerce.number().int().positive(),
  urgency: z.enum(['normal', 'urgent', 'critical']),
  note: z.string().max(1000).optional(),
});
type CreateValues = z.infer<typeof createSchema>;

const processSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'delivered']),
  sourceFranchiseId: z.string().optional(),
  response: z.string().max(1000).optional(),
});
type ProcessValues = z.infer<typeof processSchema>;

export function DemandsPage() {
  const { user } = useAuth();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager';
  const canProcess = user?.role === 'admin' || user?.role === 'manager';
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [franchiseId, setFranchiseId] = useState(isGlobal ? '' : (user?.franchiseId ?? ''));
  const [status, setStatus] = useState<'' | Demand['status']>('');
  const [urgency, setUrgency] = useState<'' | Demand['urgency']>('');
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [creating, setCreating] = useState(false);
  const [processing, setProcessing] = useState<Demand | null>(null);

  const franchises = useQuery({
    enabled: isGlobal || canProcess,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const products = useQuery({
    queryKey: ['products', 'demands-select'],
    queryFn: async () => (await api.get<{ products: Product[] }>('/products', { params: { active: 'true', limit: 500 } })).data.products,
  });

  const demands = useQuery({
    queryKey: ['demands', debouncedSearch, franchiseId, status, urgency, page],
    queryFn: async () =>
      (
        await api.get<{ demands: Demand[]; summary: DemandSummary; meta: PageMeta }>('/demands', {
          params: {
            q: debouncedSearch || undefined,
            franchiseId: franchiseId || undefined,
            status: status || undefined,
            urgency: urgency || undefined,
            page,
            pageSize,
          },
        })
      ).data,
  });

  return (
    <>
      <PageHeader
        title="Demandes produits"
        subtitle="Workflow demande, validation et livraison depuis une franchise source"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + Nouvelle demande
          </button>
        }
      />

      <section className="mb-5 grid gap-4 md:grid-cols-4">
        <MetricCard label="En attente" value={String(demands.data?.summary.pending ?? 0)} />
        <MetricCard label="Urgentes" value={String(demands.data?.summary.urgent ?? 0)} />
        <MetricCard label="Critiques" value={String(demands.data?.summary.critical ?? 0)} />
        <MetricCard label="Total" value={String(demands.data?.meta.total ?? 0)} />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_220px_180px_180px]">
          <input
            type="search"
            className="input"
            placeholder="Produit, note, reponse..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {isGlobal ? (
            <select
              className="input"
              value={franchiseId}
              onChange={(e) => {
                setFranchiseId(e.target.value);
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
            <input className="input" disabled value="Franchise courante" />
          )}
          <select
            className="input"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | Demand['status']);
              setPage(1);
            }}
          >
            <option value="">Tous statuts</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="delivered">Delivered</option>
          </select>
          <select
            className="input"
            value={urgency}
            onChange={(e) => {
              setUrgency(e.target.value as '' | Demand['urgency']);
              setPage(1);
            }}
          >
            <option value="">Toutes urgences</option>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Franchise</th>
              <th className="th">Produit</th>
              <th className="th text-right">Quantite</th>
              <th className="th">Urgence</th>
              <th className="th">Statut</th>
              <th className="th">Demandeur</th>
              <th className="th">Reponse</th>
              <th className="th text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {(demands.data?.demands ?? []).map((demand) => {
              const franchiseName =
                typeof demand.franchiseId === 'object' && demand.franchiseId ? demand.franchiseId.name : '-';
              const productName =
                typeof demand.productId === 'object' && demand.productId
                  ? demand.productId.name
                  : demand.productName || 'Produit libre';
              const requester =
                typeof demand.requestedBy === 'object' && demand.requestedBy
                  ? demand.requestedBy.fullName || demand.requestedBy.username || '-'
                  : '-';
              return (
                <tr key={demand._id}>
                  <td className="td text-slate-500">{dateTime(demand.createdAt)}</td>
                  <td className="td">{franchiseName}</td>
                  <td className="td font-medium">{productName}</td>
                  <td className="td text-right">{demand.quantity}</td>
                  <td className="td"><span className={urgencyBadge(demand.urgency)}>{demand.urgency}</span></td>
                  <td className="td"><span className={statusBadge(demand.status)}>{demand.status}</span></td>
                  <td className="td text-slate-600">{requester}</td>
                  <td className="td text-slate-600">{demand.response || demand.note || '-'}</td>
                  <td className="td">
                    <div className="flex justify-end">
                      {canProcess && demand.status === 'pending' && (
                        <button className="btn-secondary !px-3 !py-1.5" onClick={() => setProcessing(demand)}>
                          Traiter
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!demands.isLoading && (demands.data?.demands.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={9}>Aucune demande.</td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={demands.data?.meta} onPageChange={setPage} className="px-4 py-3" />
      </section>

      {creating && (
        <CreateDemandModal
          isGlobal={isGlobal}
          defaultFranchiseId={franchiseId}
          franchises={franchises.data ?? []}
          products={products.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['demands'] });
          }}
        />
      )}

      {processing && (
        <ProcessDemandModal
          demand={processing}
          franchises={franchises.data ?? []}
          onClose={() => setProcessing(null)}
          onProcessed={() => {
            setProcessing(null);
            qc.invalidateQueries({ queryKey: ['demands'] });
            qc.invalidateQueries({ queryKey: ['stock'] });
          }}
        />
      )}
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

function statusBadge(status: Demand['status']) {
  if (status === 'pending') return 'badge-warning';
  if (status === 'approved') return 'badge-info';
  if (status === 'delivered') return 'badge-success';
  return 'badge-danger';
}

function urgencyBadge(urgency: Demand['urgency']) {
  if (urgency === 'critical') return 'badge-danger';
  if (urgency === 'urgent') return 'badge-warning';
  return 'badge-muted';
}

function CreateDemandModal({
  isGlobal,
  defaultFranchiseId,
  franchises,
  products,
  onClose,
  onCreated,
}: {
  isGlobal: boolean;
  defaultFranchiseId: string;
  franchises: Franchise[];
  products: Product[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFormError,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      franchiseId: defaultFranchiseId,
      productId: '',
      productName: '',
      quantity: 1,
      urgency: 'normal',
      note: '',
    },
  });

  const createDemand = useMutation({
    mutationFn: async (values: CreateValues) => {
      if (!values.productId && !values.productName?.trim()) {
        setFormError('productName', { message: 'Produit ou nom libre requis' });
        throw new Error('missing product');
      }
      await api.post('/demands', {
        franchiseId: isGlobal ? values.franchiseId || undefined : undefined,
        productId: values.productId || null,
        productName: values.productName || undefined,
        quantity: values.quantity,
        urgency: values.urgency,
        note: values.note || undefined,
      });
    },
    onSuccess: onCreated,
    onError: (e) => setError(apiError(e).message),
  });

  return (
    <Modal
      open
      title="Nouvelle demande"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="create-demand" disabled={isSubmitting}>Enregistrer</button>
        </div>
      }
    >
      <form id="create-demand" className="space-y-3" onSubmit={handleSubmit((v) => createDemand.mutate(v))}>
        {isGlobal && (
          <div>
            <label className="label">Franchise</label>
            <select className="input" {...register('franchiseId')}>
              <option value="">- Selectionner -</option>
              {franchises.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
            </select>
            {errors.franchiseId && <p className="mt-1 text-xs text-rose-600">{errors.franchiseId.message}</p>}
          </div>
        )}
        <div>
          <label className="label">Produit catalogue (optionnel)</label>
          <select className="input" {...register('productId')}>
            <option value="">Sans liaison produit</option>
            {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Nom produit libre (optionnel)</label>
          <input className="input" {...register('productName')} placeholder="Ex: Accessoire specifique non catalogue" />
          {errors.productName && <p className="mt-1 text-xs text-rose-600">{errors.productName.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Quantite</label>
            <input type="number" min={1} className="input" {...register('quantity')} />
          </div>
          <div>
            <label className="label">Urgence</label>
            <select className="input" {...register('urgency')}>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Note</label>
          <textarea rows={3} className="input" {...register('note')} />
        </div>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}

function ProcessDemandModal({
  demand,
  franchises,
  onClose,
  onProcessed,
}: {
  demand: Demand;
  franchises: Franchise[];
  onClose: () => void;
  onProcessed: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    watch,
    handleSubmit,
    setError: setFormError,
    formState: { errors, isSubmitting },
  } = useForm<ProcessValues>({
    resolver: zodResolver(processSchema),
    defaultValues: {
      decision: 'approved',
      response: '',
      sourceFranchiseId: '',
    },
  });
  const decision = watch('decision');

  const processDemand = useMutation({
    mutationFn: async (values: ProcessValues) => {
      if (values.decision === 'delivered' && !values.sourceFranchiseId) {
        setFormError('sourceFranchiseId', { message: 'Franchise source requise pour livrer' });
        throw new Error('missing source');
      }
      await api.post(`/demands/${demand._id}/process`, {
        decision: values.decision,
        response: values.response || undefined,
        sourceFranchiseId: values.sourceFranchiseId || undefined,
      });
    },
    onSuccess: onProcessed,
    onError: (e) => setError(apiError(e).message),
  });

  return (
    <Modal
      open
      title="Traiter demande"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="process-demand" disabled={isSubmitting}>Valider</button>
        </div>
      }
    >
      <form id="process-demand" className="space-y-3" onSubmit={handleSubmit((v) => processDemand.mutate(v))}>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Quantite demandee: <b>{demand.quantity}</b>
        </div>
        <div>
          <label className="label">Decision</label>
          <select className="input" {...register('decision')}>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="delivered">Delivered (avec mouvement stock)</option>
          </select>
        </div>
        {decision === 'delivered' && (
          <div>
            <label className="label">Franchise source</label>
            <select className="input" {...register('sourceFranchiseId')}>
              <option value="">- Selectionner -</option>
              {franchises.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
            </select>
            {errors.sourceFranchiseId && <p className="mt-1 text-xs text-rose-600">{errors.sourceFranchiseId.message}</p>}
          </div>
        )}
        <div>
          <label className="label">Reponse</label>
          <textarea rows={3} className="input" {...register('response')} />
        </div>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
