import { useMemo, useState } from 'react';
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
  const isGlobal = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'superadmin';
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
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    user?.role === 'superadmin' ||
    user?.role === 'franchise';

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle="Inventory by franchise with low stock visibility"
        actions={
          canCreateStockEntry && effectiveFranchiseId ? (
            <button className="btn-primary" onClick={() => setEntryOpen(true)}>
              + Entree stock
            </button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        {isGlobal && (
          <select
            className="input max-w-sm"
            value={selectedFranchiseId}
            onChange={(event) => setSelectedFranchiseId(event.target.value)}
          >
            <option value="">Select franchise</option>
            {(franchises.data ?? []).map((franchise) => (
              <option key={franchise._id} value={franchise._id}>
                {franchise.name}
              </option>
            ))}
          </select>
        )}

        <input
          type="search"
          placeholder="Search product..."
          className="input max-w-md"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />

        <label className="inline-flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(event) => {
              setLowOnly(event.target.checked);
              setPage(1);
            }}
          />
          Low stock only
        </label>
      </div>

      {!effectiveFranchiseId && <div className="text-slate-500">Select a franchise to view stock.</div>}

      {effectiveFranchiseId && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Produit</th>
                <th className="th">Categorie</th>
                <th className="th">Reference</th>
                <th className="th text-right">Prix vente</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Seuil</th>
                <th className="th" />
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
                    <td className="td">{lowStock && <span className="badge-danger">stock faible</span>}</td>
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
    </>
  );
}

const entrySchema = z.object({
  productId: z.string().min(1, 'Produit requis'),
  quantity: z.coerce.number().int().positive('Quantite > 0'),
  unitPrice: z.coerce.number().min(0).optional(),
  note: z.string().max(500).optional(),
});

type EntryValues = z.infer<typeof entrySchema>;

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
            placeholder="Search product..."
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
