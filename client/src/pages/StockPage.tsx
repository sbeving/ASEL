import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { TablePagination } from '../components/TablePagination';
import { SearchableSelect, type SearchableSelectOption } from '../components/SearchableSelect';
import { useDebouncedValue } from '../lib/hooks';
import type { Franchise, PageMeta, Product, StockItem } from '../lib/types';

export function StockPage() {
  const { user } = useAuth();
  const isGlobal =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    user?.role === 'superadmin' ||
    user?.role === 'stock_central_maintainer';
  const queryClient = useQueryClient();

  const franchises = useQuery({
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const [selectedFranchiseId, setSelectedFranchiseId] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [page, setPage] = useState(1);
  const [lowOnly, setLowOnly] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [editingStockItem, setEditingStockItem] = useState<StockItem | null>(null);
  const pageSize = 25;

  const effectiveFranchiseId = isGlobal ? selectedFranchiseId : user?.franchiseId ?? '';
  const stock = useQuery({
    enabled: !!effectiveFranchiseId,
    queryKey: ['stock', effectiveFranchiseId, debouncedSearch, lowOnly, page],
    queryFn: async () =>
      (
        await api.get<{ items: StockItem[]; meta: PageMeta }>('/stock', {
          params: {
            franchiseId: effectiveFranchiseId,
            q: debouncedSearch || undefined,
            lowOnly: lowOnly || undefined,
            page,
            pageSize,
          },
        })
      ).data,
  });

  const canCreateStockEntry =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    user?.role === 'superadmin' ||
    user?.role === 'stock_central_maintainer' ||
    user?.role === 'franchise';
  const canAdminStock =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'stock_central_maintainer';

  const deleteStockLine = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/stock/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stock'] }),
  });

  const stockSummary = useMemo(() => {
    const items = stock.data?.items ?? [];
    return {
      totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
      lowCount: items.filter((item) => item.quantity <= item.product.lowStockThreshold).length,
      stockValue: items.reduce((sum, item) => sum + item.quantity * item.product.sellPrice, 0),
    };
  }, [stock.data?.items]);

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle="Inventaire par franchise avec visibilite sur les seuils bas"
        actions={
          canCreateStockEntry && effectiveFranchiseId ? (
            <button className="btn-primary" onClick={() => setEntryOpen(true)}>
              + Entree stock
            </button>
          ) : undefined
        }
      />

      <section className="card mb-5 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)_auto]">
        {isGlobal && (
          <select
            className="input"
            value={selectedFranchiseId}
            onChange={(event) => setSelectedFranchiseId(event.target.value)}
          >
              <option value="">Selectionner une franchise</option>
            {(franchises.data ?? []).map((franchise) => (
              <option key={franchise._id} value={franchise._id}>
                {franchise.name}
              </option>
            ))}
          </select>
        )}

        <input
          type="search"
          placeholder="Rechercher un produit..."
          className="input"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />

        <label className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(event) => {
              setLowOnly(event.target.checked);
              setPage(1);
            }}
          />
          Stock faible uniquement
        </label>
        </div>
        {(search || lowOnly) && (
          <div className="mt-3">
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 !text-xs"
              onClick={() => {
                setSearch('');
                setLowOnly(false);
                setPage(1);
              }}
            >
              Effacer recherche et filtre
            </button>
          </div>
        )}
      </section>

      {!effectiveFranchiseId && (
        <div className="card p-8 text-center text-slate-500">Selectionnez une franchise pour afficher le stock.</div>
      )}

      {effectiveFranchiseId && (
        <>
        <section className="mb-5 grid gap-3 md:grid-cols-3">
          <StockMetric label="Unites affichees" value={String(stockSummary.totalUnits)} helper="Selon les filtres courants" />
          <StockMetric label="Alertes stock" value={String(stockSummary.lowCount)} helper="Produits sous seuil" tone={stockSummary.lowCount > 0 ? 'danger' : 'good'} />
          <StockMetric label="Valeur vente" value={money(stockSummary.stockValue)} helper="Estimation sur page" />
        </section>

        <div className="grid gap-3 md:hidden">
          {(stock.data?.items ?? []).map((item) => {
            const lowStock = item.quantity <= item.product.lowStockThreshold;
            return (
              <article key={item._id} className={lowStock ? 'card border-rose-200 bg-rose-50/70 p-4' : 'card p-4'}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{item.product.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {[item.product.reference, item.category?.name].filter(Boolean).join(' | ') || 'Sans reference'}
                    </div>
                  </div>
                  {lowStock && <span className="badge-danger">faible</span>}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-white px-2 py-2">
                    <div className="text-lg font-bold text-slate-900">{item.quantity}</div>
                    <div className="text-slate-500">Qty</div>
                  </div>
                  <div className="rounded-xl bg-white px-2 py-2">
                    <div className="text-lg font-bold text-slate-900">{item.product.lowStockThreshold}</div>
                    <div className="text-slate-500">Seuil</div>
                  </div>
                  <div className="rounded-xl bg-white px-2 py-2">
                    <div className="text-sm font-bold text-slate-900">{money(item.product.sellPrice)}</div>
                    <div className="text-slate-500">Prix</div>
                  </div>
                </div>
                {canAdminStock && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button className="btn-secondary" onClick={() => setEditingStockItem(item)}>Corriger</button>
                    <button
                      className="btn-danger"
                      disabled={deleteStockLine.isPending}
                      onClick={() => {
                        if (window.confirm('Supprimer cette ligne de stock ?')) deleteStockLine.mutate(item._id);
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                )}
              </article>
            );
          })}
          {!stock.isLoading && (stock.data?.items.length ?? 0) === 0 && (
            <div className="card p-5 text-sm text-slate-400">Aucun stock pour cette franchise.</div>
          )}
        </div>

        <div className="card hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Produit</th>
                <th className="th">Categorie</th>
                <th className="th">Reference</th>
                <th className="th text-right">Prix vente</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Seuil</th>
                <th className="th-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {(stock.data?.items ?? []).map((item) => {
                const lowStock = item.quantity <= item.product.lowStockThreshold;
                return (
                  <tr key={item._id} className={lowStock ? 'bg-rose-50/50' : undefined}>
                    <td className="td font-medium">{item.product.name}</td>
                    <td className="td text-slate-500">{item.category?.name ?? '-'}</td>
                    <td className="td text-slate-500">{item.product.reference ?? '-'}</td>
                    <td className="td text-right">{money(item.product.sellPrice)}</td>
                    <td className="td text-right font-semibold">{item.quantity}</td>
                    <td className="td text-right text-slate-500">{item.product.lowStockThreshold}</td>
                    <td className="td-action">
                      <div className="flex justify-end gap-2">
                        {lowStock && <span className="badge-danger">stock faible</span>}
                        {canAdminStock && (
                          <>
                            <button className="btn-secondary !min-h-[34px] !px-3 !py-1" onClick={() => setEditingStockItem(item)}>
                              Corriger
                            </button>
                            <button
                              className="btn-danger !min-h-[34px] !px-3 !py-1"
                              disabled={deleteStockLine.isPending}
                              onClick={() => {
                                if (window.confirm('Supprimer cette ligne de stock ?')) deleteStockLine.mutate(item._id);
                              }}
                            >
                              Supprimer
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!stock.isLoading && (stock.data?.items.length ?? 0) === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={7}>
                    Aucun stock pour cette franchise.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}

      <TablePagination meta={stock.data?.meta} onPageChange={setPage} />

      {entryOpen && effectiveFranchiseId && (
        <StockEntryModal
          franchiseId={effectiveFranchiseId}
          onClose={() => setEntryOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['stock'] });
            setEntryOpen(false);
          }}
        />
      )}

      {editingStockItem && (
        <StockCorrectionModal
          item={editingStockItem}
          onClose={() => setEditingStockItem(null)}
          onSaved={() => {
            setEditingStockItem(null);
            queryClient.invalidateQueries({ queryKey: ['stock'] });
          }}
        />
      )}
    </>
  );
}

function StockMetric({
  label,
  value,
  helper,
  tone = 'default',
}: {
  label: string;
  value: string;
  helper: string;
  tone?: 'default' | 'danger' | 'good';
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={tone === 'danger' ? 'mt-2 text-2xl font-bold text-rose-700' : tone === 'good' ? 'mt-2 text-2xl font-bold text-emerald-700' : 'mt-2 text-2xl font-bold text-slate-900'}>
        {value}
      </div>
      <div className="mt-1 text-sm text-slate-500">{helper}</div>
    </div>
  );
}

const entrySchema = z.object({
  productId: z.string().min(1, 'Produit requis'),
  quantity: z.coerce.number().int().positive('Quantite > 0'),
  unitPrice: z.coerce.number().min(0).optional(),
  note: z.string().max(500).optional(),
});

type EntryValues = z.infer<typeof entrySchema>;

function StockCorrectionModal({
  item,
  onClose,
  onSaved,
}: {
  item: StockItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState(item.quantity);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (quantity < 0) throw new Error('Quantite invalide');
      await api.patch(`/stock/${item._id}`, {
        quantity,
        note: note || undefined,
      });
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : apiError(err).message),
  });

  return (
    <Modal
      open
      title="Correction stock admin"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <div className="font-bold text-slate-900">{item.product.name}</div>
          <div className="text-slate-500">Quantite actuelle: {item.quantity}</div>
        </div>
        <div>
          <label className="label">Nouvelle quantite</label>
          <input
            type="number"
            min={0}
            className="input"
            value={quantity}
            onChange={(event) => setQuantity(Math.max(0, Number(event.target.value) || 0))}
          />
        </div>
        <div>
          <label className="label">Motif correction</label>
          <textarea rows={2} className="input" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </div>
    </Modal>
  );
}

function StockEntryModal({
  franchiseId,
  onClose,
  onSaved,
}: {
  franchiseId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [productId, setProductId] = useState('');

  const products = useQuery({
    queryKey: ['products', 'stock-entry'],
    queryFn: async () => (await api.get<{ products: Product[] }>('/products', { params: { active: 'true', limit: 500 } })).data.products,
  });

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EntryValues>({
    resolver: zodResolver(entrySchema),
    defaultValues: {
      productId: '',
      quantity: 1,
      unitPrice: 0,
      note: '',
    },
  });

  useEffect(() => {
    setValue('productId', productId, { shouldValidate: true });
  }, [productId, setValue]);

  const productOptions: SearchableSelectOption[] = useMemo(
    () =>
      [...(products.data ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((product) => ({
          value: product._id,
          label: product.name,
          subtitle: [product.reference, product.brand].filter(Boolean).join(' | ') || undefined,
          keywords: [product.reference, product.barcode, product.brand].filter(Boolean).join(' '),
        })),
    [products.data],
  );

  const save = useMutation({
    mutationFn: async (values: EntryValues) => api.post('/stock/entry', { ...values, franchiseId, productId }),
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title="Entree de stock"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" form="stock-entry-form" disabled={isSubmitting || save.isPending}>
            Enregistrer
          </button>
        </div>
      }
    >
      <form
        id="stock-entry-form"
        className="space-y-3"
        onSubmit={handleSubmit((values) => save.mutate({ ...values, productId }))}
      >
        <div>
          <label className="label">Produit</label>
          <SearchableSelect
            value={productId}
            options={productOptions}
            placeholder="Rechercher un produit..."
            onChange={setProductId}
          />
          <input type="hidden" value={productId} {...register('productId')} />
          {errors.productId && <p className="mt-1 text-xs text-rose-600">{errors.productId.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Quantite</label>
            <input type="number" min={1} className="input" {...register('quantity')} />
            {errors.quantity && <p className="mt-1 text-xs text-rose-600">{errors.quantity.message}</p>}
          </div>
          <div>
            <label className="label">Prix unitaire (optionnel)</label>
            <input type="number" min={0} step="0.01" className="input" {...register('unitPrice')} />
          </div>
        </div>

        <div>
          <label className="label">Note</label>
          <textarea rows={2} className="input" {...register('note')} />
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
