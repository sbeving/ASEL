import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Plus, RotateCcw, X } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { dateTime } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { TablePagination } from '../components/TablePagination';
import { SearchableSelect, type SearchableSelectOption } from '../components/SearchableSelect';
import { useDebouncedValue } from '../lib/hooks';
import type { Franchise, PageMeta, Product, Transfer } from '../lib/types';

const schema = z.object({
  sourceFranchiseId: z.string().min(1),
  destFranchiseId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  note: z.string().max(500).optional(),
}).refine((v) => v.sourceFranchiseId !== v.destFranchiseId, {
  message: 'Source et destination doivent etre differents',
  path: ['destFranchiseId'],
});
type FormValues = z.infer<typeof schema>;

function statusBadge(status: Transfer['status']) {
  if (status === 'pending') return <span className="badge-warning">en attente</span>;
  if (status === 'accepted') return <span className="badge-success">accepte</span>;
  if (status === 'rejected') return <span className="badge-danger">rejete</span>;
  return <span className="badge-muted">annule</span>;
}

export function TransfersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canCreate = user?.role !== 'seller' && user?.role !== 'vendeur' && user?.role !== 'viewer';
  const isGlobal = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'superadmin';
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'' | Transfer['status']>('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [selectedFranchiseId, setSelectedFranchiseId] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedSearch, selectedFranchiseId]);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const list = useQuery({
    queryKey: ['transfers', statusFilter, debouncedSearch, selectedFranchiseId, page],
    queryFn: async () =>
      (
        await api.get<{ transfers: Transfer[]; meta: PageMeta }>('/transfers', {
          params: {
            status: statusFilter || undefined,
            q: debouncedSearch || undefined,
            franchiseId: selectedFranchiseId || undefined,
            page,
            pageSize: 25,
          },
        })
      ).data,
  });

  const resolve = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      api.post(`/transfers/${id}/${action}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transfers'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const franchiseOptions: SearchableSelectOption[] = useMemo(
    () =>
      (franchises.data ?? []).map((franchise) => ({
        value: franchise._id,
        label: franchise.name,
        subtitle: franchise.address || undefined,
      })),
    [franchises.data],
  );

  const transferSummary = useMemo(() => {
    const rows = list.data?.transfers ?? [];
    return {
      pending: rows.filter((transfer) => transfer.status === 'pending').length,
      accepted: rows.filter((transfer) => transfer.status === 'accepted').length,
      rejected: rows.filter((transfer) => transfer.status === 'rejected').length,
      quantity: rows.reduce((sum, transfer) => sum + transfer.quantity, 0),
    };
  }, [list.data?.transfers]);

  const hasFilters = Boolean(statusFilter || search || selectedFranchiseId);
  const resetFilters = () => {
    setStatusFilter('');
    setSelectedFranchiseId('');
    setSearch('');
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Transferts"
        subtitle="Mouvements de stock inter-franchise"
        actions={
          canCreate && (
            <button className="btn-primary" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              Nouveau transfert
            </button>
          )
        }
      />

      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="En attente" value={String(transferSummary.pending)} />
        <MetricCard label="Acceptes" value={String(transferSummary.accepted)} />
        <MetricCard label="Rejetes" value={String(transferSummary.rejected)} />
        <MetricCard label="Quantite" value={String(transferSummary.quantity)} />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[180px_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
          <select
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as '' | Transfer['status'])}
          >
            <option value="">Tous statuts</option>
            <option value="pending">En attente</option>
            <option value="accepted">Acceptes</option>
            <option value="rejected">Rejetes</option>
            <option value="cancelled">Annules</option>
          </select>
          {isGlobal && (
            <SearchableSelect
              value={selectedFranchiseId}
              options={franchiseOptions}
              onChange={setSelectedFranchiseId}
              allowClear
              placeholder="Filtrer par franchise"
            />
          )}
          <input
            className="input md:col-span-2"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher produit ou note..."
          />
          <button type="button" className="btn-secondary xl:whitespace-nowrap" disabled={!hasFilters} onClick={resetFilters}>
            <RotateCcw className="h-4 w-4" />
            Effacer
          </button>
        </div>
      </section>

      <section className="mb-5 grid gap-3 lg:hidden">
        {(list.data?.transfers ?? []).map((t) => {
          const isDest =
            typeof t.destFranchiseId === 'object'
              ? t.destFranchiseId._id === user?.franchiseId
              : t.destFranchiseId === user?.franchiseId;
          const canResolve =
            t.status === 'pending' &&
            (user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager' || (user?.role === 'franchise' && isDest));
          const source = typeof t.sourceFranchiseId === 'object' ? t.sourceFranchiseId.name : '-';
          const destination = typeof t.destFranchiseId === 'object' ? t.destFranchiseId.name : '-';
          const product = typeof t.productId === 'object' ? t.productId.name : '-';
          const requester = typeof t.requestedBy === 'object' ? t.requestedBy.fullName : '-';

          return (
            <article key={t._id} className="mobile-record-card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-surface-900">{product}</div>
                  <div className="mt-1 text-xs text-surface-500">{dateTime(t.createdAt)}</div>
                </div>
                {statusBadge(t.status)}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="mobile-record-label">Source</div>
                  <div className="mt-1 font-medium text-surface-800">{source}</div>
                </div>
                <div className="text-right">
                  <div className="mobile-record-label">Destination</div>
                  <div className="mt-1 font-medium text-surface-800">{destination}</div>
                </div>
                <div>
                  <div className="mobile-record-label">Demande par</div>
                  <div className="mt-1 font-medium text-surface-800">{requester}</div>
                </div>
                <div className="text-right">
                  <div className="mobile-record-label">Quantite</div>
                  <div className="mt-1 font-semibold text-surface-900">{t.quantity}</div>
                </div>
              </div>
              {t.note && <div className="rounded-lg bg-surface-50 px-3 py-2 text-sm text-surface-600">{t.note}</div>}
              {canResolve && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="btn-secondary text-emerald-700"
                    onClick={() => resolve.mutate({ id: t._id, action: 'accept' })}
                  >
                    <Check className="h-4 w-4" />
                    Accepter
                  </button>
                  <button
                    className="btn-secondary text-rose-700"
                    onClick={() => resolve.mutate({ id: t._id, action: 'reject' })}
                  >
                    <X className="h-4 w-4" />
                    Rejeter
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {!list.isLoading && (list.data?.transfers.length ?? 0) === 0 && (
          <div className="mobile-record-card text-sm text-surface-500">Aucun transfert.</div>
        )}
        <TablePagination meta={list.data?.meta} onPageChange={setPage} className="px-1 py-2" />
      </section>

      <div className="card hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Source</th>
              <th className="th">Destination</th>
              <th className="th">Produit</th>
              <th className="th text-right">Qte</th>
              <th className="th">Statut</th>
              <th className="th">Demande par</th>
              <th className="th-action">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.transfers ?? []).map((t) => {
              const isDest =
                typeof t.destFranchiseId === 'object'
                  ? t.destFranchiseId._id === user?.franchiseId
                  : t.destFranchiseId === user?.franchiseId;
              const canResolve =
                t.status === 'pending' &&
                (user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager' || (user?.role === 'franchise' && isDest));
              return (
                <tr key={t._id}>
                  <td className="td text-slate-500">{dateTime(t.createdAt)}</td>
                  <td className="td">{typeof t.sourceFranchiseId === 'object' ? t.sourceFranchiseId.name : '-'}</td>
                  <td className="td">{typeof t.destFranchiseId === 'object' ? t.destFranchiseId.name : '-'}</td>
                  <td className="td">{typeof t.productId === 'object' ? t.productId.name : '-'}</td>
                  <td className="td text-right">{t.quantity}</td>
                  <td className="td">{statusBadge(t.status)}</td>
                  <td className="td text-slate-500">
                    {typeof t.requestedBy === 'object' ? t.requestedBy.fullName : '-'}
                  </td>
                  <td className="td-action">
                    {canResolve && (
                      <div className="flex justify-end gap-2">
                        <button
                          className="btn-secondary !min-h-[36px] !px-3 !py-1.5 text-emerald-700"
                          onClick={() => resolve.mutate({ id: t._id, action: 'accept' })}
                        >
                          <Check className="h-4 w-4" />
                          Accepter
                        </button>
                        <button
                          className="btn-secondary !min-h-[36px] !px-3 !py-1.5 text-rose-700"
                          onClick={() => resolve.mutate({ id: t._id, action: 'reject' })}
                        >
                          <X className="h-4 w-4" />
                          Rejeter
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!list.isLoading && (list.data?.transfers.length ?? 0) === 0 && (
              <tr><td className="td text-slate-400" colSpan={8}>Aucun transfert.</td></tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={list.data?.meta} onPageChange={setPage} className="px-4 py-3" />
      </div>

      {open && (
        <NewTransferModal
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ['transfers'] });
          }}
        />
      )}
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-surface-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-surface-900">{value}</div>
    </div>
  );
}

function NewTransferModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const franchises = useQuery({
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });
  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: async () => (await api.get<{ products: Product[] }>('/products', { params: { active: 'true', limit: 500 } })).data.products,
  });

  const { control, register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sourceFranchiseId: user?.franchiseId ?? '',
      destFranchiseId: '',
      productId: '',
      quantity: 1,
    },
  });

  const save = useMutation({
    mutationFn: async (values: FormValues) => api.post('/transfers', values),
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  const franchiseOptions: SearchableSelectOption[] = useMemo(
    () =>
      (franchises.data ?? []).map((franchise) => ({
        value: franchise._id,
        label: franchise.name,
        subtitle: franchise.address || undefined,
      })),
    [franchises.data],
  );

  const productOptions: SearchableSelectOption[] = useMemo(
    () =>
      (products.data ?? []).map((product) => ({
        value: product._id,
        label: product.name,
        subtitle: [product.reference, product.brand].filter(Boolean).join(' | ') || undefined,
        keywords: [product.reference, product.barcode, product.brand].filter(Boolean).join(' '),
      })),
    [products.data],
  );

  return (
    <Modal
      open
      title="Nouveau transfert"
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="transfer-form" disabled={isSubmitting}>Demander</button>
        </div>
      }
    >
      <form id="transfer-form" className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <div>
          <label className="label">Source</label>
          <Controller
            control={control}
            name="sourceFranchiseId"
            render={({ field }) => (
              <SearchableSelect
                value={field.value}
                options={franchiseOptions}
                onChange={field.onChange}
                placeholder="Choisir source"
              />
            )}
          />
        </div>
        <div>
          <label className="label">Destination</label>
          <Controller
            control={control}
            name="destFranchiseId"
            render={({ field }) => (
              <SearchableSelect
                value={field.value}
                options={franchiseOptions}
                onChange={field.onChange}
                placeholder="Choisir destination"
              />
            )}
          />
          {errors.destFranchiseId && <p className="mt-1 text-xs text-rose-600">{errors.destFranchiseId.message}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="label">Produit</label>
          <Controller
            control={control}
            name="productId"
            render={({ field }) => (
              <SearchableSelect
                value={field.value}
                options={productOptions}
                onChange={field.onChange}
                placeholder="Rechercher produit"
              />
            )}
          />
        </div>
        <div>
          <label className="label">Quantite</label>
          <input type="number" min={1} inputMode="numeric" className="input" {...register('quantity')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Note</label>
          <textarea rows={2} className="input" {...register('note')} />
        </div>
        {error && <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
