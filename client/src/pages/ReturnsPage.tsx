import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { dateTime, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { TablePagination } from '../components/TablePagination';
import { useDebouncedValue } from '../lib/hooks';
import type { Franchise, PageMeta, Product, ReturnRecord, ReturnSummary } from '../lib/types';

type ReturnTypeFilter = '' | 'return' | 'exchange';

const createSchema = z.object({
  franchiseId: z.string().optional(),
  productId: z.string().min(1, 'Produit requis'),
  quantity: z.coerce.number().int().positive('Quantite > 0'),
  returnType: z.enum(['return', 'exchange']),
  reason: z.string().max(500).optional(),
});

type CreateValues = z.infer<typeof createSchema>;

export function ReturnsPage() {
  const { user } = useAuth();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager';
  const canCreate = user?.role !== 'viewer';
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [selectedFranchiseId, setSelectedFranchiseId] = useState(isGlobal ? '' : (user?.franchiseId ?? ''));
  const [typeFilter, setTypeFilter] = useState<ReturnTypeFilter>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [creating, setCreating] = useState(false);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const products = useQuery({
    queryKey: ['products', 'returns-select'],
    queryFn: async () => (await api.get<{ products: Product[] }>('/products', { params: { active: 'true', limit: 500 } })).data.products,
  });

  const returnsQuery = useQuery({
    queryKey: ['returns', debouncedSearch, selectedFranchiseId, typeFilter, fromDate, toDate, page],
    queryFn: async () =>
      (
        await api.get<{ returns: ReturnRecord[]; summary: ReturnSummary; meta: PageMeta }>('/returns', {
          params: {
            q: debouncedSearch || undefined,
            franchiseId: selectedFranchiseId || undefined,
            returnType: typeFilter || undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
            page,
            pageSize,
          },
        })
      ).data,
  });

  return (
    <>
      <PageHeader
        title="Retours & echanges"
        subtitle="Gestion des retours clients et echanges, avec impact stock conforme au legacy"
        actions={
          canCreate ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + Nouveau retour
            </button>
          ) : undefined
        }
      />

      <section className="mb-5 grid gap-4 md:grid-cols-4">
        <MetricCard label="Retours" value={String(returnsQuery.data?.summary.returnCount ?? 0)} />
        <MetricCard label="Echanges" value={String(returnsQuery.data?.summary.exchangeCount ?? 0)} />
        <MetricCard label="Quantite totale" value={String(returnsQuery.data?.summary.totalQuantity ?? 0)} />
        <MetricCard label="Valeur retournee" value={money(returnsQuery.data?.summary.returnedValue ?? 0)} />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_220px_180px_170px_170px]">
          <input
            type="search"
            className="input"
            placeholder="Produit, reference, code-barres..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {isGlobal ? (
            <select
              className="input"
              value={selectedFranchiseId}
              onChange={(e) => {
                setSelectedFranchiseId(e.target.value);
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
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value as ReturnTypeFilter);
              setPage(1);
            }}
          >
            <option value="">Tous types</option>
            <option value="return">Retour</option>
            <option value="exchange">Echange</option>
          </select>
          <input
            type="date"
            className="input"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
          />
          <input
            type="date"
            className="input"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Produit</th>
              <th className="th">Franchise</th>
              <th className="th">Type</th>
              <th className="th text-right">Quantite</th>
              <th className="th text-right">Prix unit.</th>
              <th className="th text-right">Valeur</th>
              <th className="th">Par</th>
              <th className="th">Raison</th>
            </tr>
          </thead>
          <tbody>
            {(returnsQuery.data?.returns ?? []).map((row) => {
              const productName =
                typeof row.productId === 'object' && row.productId ? row.productId.name : 'Produit supprime';
              const productRef =
                typeof row.productId === 'object' && row.productId ? row.productId.reference || row.productId.barcode || '' : '';
              const franchiseName =
                typeof row.franchiseId === 'object' && row.franchiseId ? row.franchiseId.name : '-';
              const author =
                typeof row.userId === 'object' && row.userId ? row.userId.fullName || row.userId.username || '-' : '-';
              const value = row.returnType === 'return' ? row.quantity * row.unitPrice : 0;
              return (
                <tr key={row._id}>
                  <td className="td text-slate-500">{dateTime(row.createdAt)}</td>
                  <td className="td">
                    <div className="font-medium text-slate-900">{productName}</div>
                    <div className="text-xs text-slate-500">{productRef || 'Sans reference'}</div>
                  </td>
                  <td className="td">{franchiseName}</td>
                  <td className="td">
                    {row.returnType === 'return' ? (
                      <span className="badge-warning">Retour</span>
                    ) : (
                      <span className="badge-info">Echange</span>
                    )}
                  </td>
                  <td className="td text-right font-medium">{row.quantity}</td>
                  <td className="td text-right">{money(row.unitPrice)}</td>
                  <td className="td text-right font-medium">{money(value)}</td>
                  <td className="td text-slate-600">{author}</td>
                  <td className="td text-slate-500">{row.reason || '-'}</td>
                </tr>
              );
            })}
            {!returnsQuery.isLoading && (returnsQuery.data?.returns.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={9}>
                  Aucun retour.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={returnsQuery.data?.meta} onPageChange={setPage} className="px-4 py-3" />
      </section>

      {creating && (
        <CreateReturnModal
          isGlobal={isGlobal}
          defaultFranchiseId={selectedFranchiseId}
          franchises={franchises.data ?? []}
          products={products.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['returns'] });
            qc.invalidateQueries({ queryKey: ['stock'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
            setCreating(false);
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

function CreateReturnModal({
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
    watch,
    setError: setFormError,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      franchiseId: defaultFranchiseId,
      productId: '',
      quantity: 1,
      returnType: 'return',
      reason: '',
    },
  });

  const createReturn = useMutation({
    mutationFn: async (values: CreateValues) => {
      if (isGlobal && !values.franchiseId) {
        setFormError('franchiseId', { message: 'Franchise requise' });
        throw new Error('Franchise required');
      }
      await api.post('/returns', {
        franchiseId: isGlobal ? values.franchiseId : undefined,
        productId: values.productId,
        quantity: values.quantity,
        returnType: values.returnType,
        reason: values.reason || undefined,
      });
    },
    onSuccess: onCreated,
    onError: (err) => setError(apiError(err).message),
  });

  const returnType = watch('returnType');

  return (
    <Modal
      open
      title="Nouveau retour / echange"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" form="create-return" disabled={isSubmitting}>
            Enregistrer
          </button>
        </div>
      }
    >
      <form id="create-return" className="space-y-3" onSubmit={handleSubmit((values) => createReturn.mutate(values))}>
        {isGlobal && (
          <div>
            <label className="label">Franchise</label>
            <select className="input" {...register('franchiseId')}>
              <option value="">- Selectionner -</option>
              {franchises.map((franchise) => (
                <option key={franchise._id} value={franchise._id}>
                  {franchise.name}
                </option>
              ))}
            </select>
            {errors.franchiseId && <p className="mt-1 text-xs text-rose-600">{errors.franchiseId.message}</p>}
          </div>
        )}
        <div>
          <label className="label">Produit</label>
          <select className="input" {...register('productId')}>
            <option value="">- Selectionner -</option>
            {products.map((product) => (
              <option key={product._id} value={product._id}>
                {product.name}
                {product.reference ? ` (${product.reference})` : ''}
              </option>
            ))}
          </select>
          {errors.productId && <p className="mt-1 text-xs text-rose-600">{errors.productId.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Quantite</label>
            <input type="number" min={1} className="input" {...register('quantity')} />
            {errors.quantity && <p className="mt-1 text-xs text-rose-600">{errors.quantity.message}</p>}
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" {...register('returnType')}>
              <option value="return">Retour (stock +)</option>
              <option value="exchange">Echange (sans mouvement stock)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Raison</label>
          <textarea rows={3} className="input" {...register('reason')} />
        </div>
        <div
          className={
            returnType === 'return'
              ? 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700'
              : 'rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700'
          }
        >
          {returnType === 'return'
            ? 'Retour: la quantite sera reintegree dans le stock.'
            : 'Echange: operation commerciale sans reintegration automatique de stock.'}
        </div>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
