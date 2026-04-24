import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError, uploadUrl } from '../lib/api';
import { dateTime, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { TablePagination } from '../components/TablePagination';
import { useDebouncedValue } from '../lib/hooks';
import type { Category, PageMeta, Product, ProductOverview, Supplier } from '../lib/types';

const schema = z.object({
  name: z.string().min(1, 'Nom requis').max(150),
  categoryId: z.string().min(1, 'Categorie requise'),
  supplierId: z.string().optional().nullable(),
  brand: z.string().max(80).optional(),
  reference: z.string().max(80).optional(),
  barcode: z.string().max(80).optional(),
  description: z.string().max(1000).optional(),
  purchasePrice: z.coerce.number().min(0).default(0),
  sellPrice: z.coerce.number().min(0).default(0),
  lowStockThreshold: z.coerce.number().int().min(0).default(3),
  active: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ProductsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'superadmin';
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | ''>('true');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const queryClient = useQueryClient();

  const products = useQuery({
    queryKey: ['products', debouncedSearch, categoryFilter, activeFilter, page],
    queryFn: async () =>
      (
        await api.get<{ products: Product[]; meta: PageMeta }>('/products', {
          params: {
            q: debouncedSearch || undefined,
            categoryId: categoryFilter || undefined,
            active: activeFilter || undefined,
            page,
            pageSize,
          },
        })
      ).data,
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<{ categories: Category[] }>('/categories')).data.categories,
  });

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<{ suppliers: Supplier[] }>('/suppliers')).data.suppliers,
  });

  const categoriesById = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category._id, category.name])),
    [categories.data],
  );

  const summary = useMemo(() => {
    const rows = products.data?.products ?? [];
    return {
      count: products.data?.meta.total ?? 0,
      stock: rows.reduce((sum, product) => sum + (product.stockTotal ?? 0), 0),
      revenue30d: rows.reduce((sum, product) => sum + (product.revenue30d ?? 0), 0),
    };
  }, [products.data]);

  return (
    <>
      <PageHeader
        title="Produits"
        subtitle="Catalogue with pricing, stock metrics and product image management"
        actions={
          canEdit && (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + Nouveau produit
            </button>
          )
        }
      />

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="Catalogue" value={String(summary.count)} helper="Produits sur filtre courant" />
        <MetricCard label="Stock cumule" value={String(summary.stock)} helper="Quantites consolidees" />
        <MetricCard label="CA 30 jours" value={money(summary.revenue30d)} helper="Rotation recente" />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_220px_180px]">
          <input
            type="search"
            placeholder="Nom, reference, code-barres, marque..."
            className="input"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <select
            className="input"
            value={categoryFilter}
            onChange={(event) => {
              setCategoryFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Toutes categories</option>
            {(categories.data ?? []).map((category) => (
              <option key={category._id} value={category._id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={activeFilter}
            onChange={(event) => {
              setActiveFilter(event.target.value as 'true' | 'false' | '');
              setPage(1);
            }}
          >
            <option value="true">Actifs</option>
            <option value="false">Inactifs</option>
            <option value="">Tous</option>
          </select>
        </div>
      </section>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Produit</th>
              <th className="th">Categorie</th>
              <th className="th text-right">Stock</th>
              <th className="th text-right">Ventes 30j</th>
              <th className="th text-right">Marge</th>
              <th className="th text-right">Prix vente</th>
              <th className="th">Statut</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(products.data?.products ?? []).map((product) => (
              <tr key={product._id}>
                <td className="td">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                      {product.imagePath ? (
                        <img src={uploadUrl(product.imagePath)} alt={product.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">no img</div>
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{product.name}</div>
                      <div className="text-xs text-slate-500">
                        {[product.reference, product.brand].filter(Boolean).join(' | ') || 'Sans reference'}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="td text-slate-500">{categoriesById.get(product.categoryId) ?? '-'}</td>
                <td className="td text-right font-medium">{product.stockTotal ?? 0}</td>
                <td className="td text-right">{product.sales30d ?? 0}</td>
                <td className="td text-right">
                  <span
                    className={
                      product.marginPercent != null && product.marginPercent >= 30
                        ? 'font-semibold text-emerald-700'
                        : 'text-slate-600'
                    }
                  >
                    {product.marginPercent != null ? `${product.marginPercent.toFixed(1)}%` : '-'}
                  </span>
                </td>
                <td className="td text-right font-medium">{money(product.sellPrice)}</td>
                <td className="td">
                  {product.active ? <span className="badge-success">Actif</span> : <span className="badge-muted">Inactif</span>}
                </td>
                <td className="td">
                  <div className="flex justify-end gap-2">
                    <button className="btn-secondary !px-3 !py-1.5" onClick={() => setViewing(product)}>
                      Voir
                    </button>
                    {canEdit && (
                      <>
                        <button className="btn-secondary !px-3 !py-1.5" onClick={() => setEditing(product)}>
                          Modifier
                        </button>
                        {product.active && (
                          <button className="btn-danger !px-3 !py-1.5" onClick={() => setArchiving(product)}>
                            Desactiver
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!products.isLoading && (products.data?.products.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={8}>
                  Aucun produit.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={products.data?.meta} onPageChange={setPage} className="px-4 py-3" />
      </div>

      {viewing && <ProductOverviewModal product={viewing} onClose={() => setViewing(null)} />}

      {canEdit && (creating || editing) && (
        <ProductFormModal
          initial={editing}
          categories={categories.data ?? []}
          suppliers={suppliers.data ?? []}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {canEdit && archiving && (
        <ArchiveProductModal
          product={archiving}
          onClose={() => setArchiving(null)}
          onArchived={() => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            setArchiving(null);
          }}
        />
      )}
    </>
  );
}

function ProductOverviewModal({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const overview = useQuery({
    queryKey: ['product-overview', product._id],
    queryFn: async () => (await api.get<ProductOverview>(`/products/${product._id}/overview`)).data,
  });
  const category = overview.data?.product.categoryId;
  const supplier = overview.data?.product.supplierId;

  return (
    <Modal open size="lg" title={product.name} onClose={onClose}>
      {overview.isLoading || !overview.data ? (
        <div className="text-sm text-slate-500">Chargement...</div>
      ) : (
        <div className="space-y-5">
          {overview.data.product.imagePath && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <img
                src={uploadUrl(overview.data.product.imagePath)}
                alt={overview.data.product.name}
                className="h-52 w-full object-contain bg-white"
              />
            </div>
          )}

          <section className="grid gap-3 sm:grid-cols-4">
            <MetricCard label="Stock total" value={String(overview.data.product.stockTotal ?? 0)} helper="" />
            <MetricCard label="Ventes 30j" value={String(overview.data.salesStats.sales30d)} helper="" />
            <MetricCard label="CA 30j" value={money(overview.data.salesStats.revenue30d)} helper="" />
            <MetricCard label="Marge unite" value={money(overview.data.product.marginAmount ?? 0)} helper="" />
          </section>

          <section className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Fiche produit</h3>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div><span className="text-slate-400">Reference:</span> {overview.data.product.reference || '-'}</div>
                <div><span className="text-slate-400">Code-barres:</span> {overview.data.product.barcode || '-'}</div>
                <div>
                  <span className="text-slate-400">Categorie:</span>{' '}
                  {typeof category === 'object' && category ? category.name : '-'}
                </div>
                <div>
                  <span className="text-slate-400">Fournisseur:</span>{' '}
                  {typeof supplier === 'object' && supplier ? supplier.name : '-'}
                </div>
                <div><span className="text-slate-400">Prix achat:</span> {money(overview.data.product.purchasePrice)}</div>
                <div><span className="text-slate-400">Prix vente:</span> {money(overview.data.product.sellPrice)}</div>
                <div><span className="text-slate-400">Seuil alerte:</span> {overview.data.product.lowStockThreshold}</div>
                {overview.data.product.description && (
                  <div className="rounded-xl bg-slate-50 px-3 py-2">{overview.data.product.description}</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Stock par franchise</h3>
              <div className="mt-3 space-y-2">
                {overview.data.stockByFranchise.map((row) => (
                  <div key={row.franchiseId} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-600">{row.franchiseName}</span>
                    <span className="font-semibold text-slate-900">{row.quantity}</span>
                  </div>
                ))}
                {overview.data.stockByFranchise.length === 0 && (
                  <div className="text-sm text-slate-400">Aucune ligne de stock.</div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Mouvements recents</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Date</th>
                    <th className="th">Type</th>
                    <th className="th">Franchise</th>
                    <th className="th text-right">Delta</th>
                    <th className="th">Utilisateur</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.recentMovements.map((movement) => (
                    <tr key={movement._id}>
                      <td className="td text-slate-500">{dateTime(movement.createdAt)}</td>
                      <td className="td">{movement.type}</td>
                      <td className="td">
                        {typeof movement.franchiseId === 'object' && movement.franchiseId ? movement.franchiseId.name : '-'}
                      </td>
                      <td className="td text-right font-medium">{movement.delta}</td>
                      <td className="td">
                        {typeof movement.userId === 'object' && movement.userId ? movement.userId.fullName : '-'}
                      </td>
                    </tr>
                  ))}
                  {overview.data.recentMovements.length === 0 && (
                    <tr>
                      <td className="td text-slate-400" colSpan={5}>
                        Aucun mouvement recent.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {helper && <div className="mt-1 text-sm text-slate-500">{helper}</div>}
    </div>
  );
}

function ProductFormModal({
  initial,
  categories,
  suppliers,
  onClose,
  onSaved,
}: {
  initial: Product | null;
  categories: Category[];
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial
      ? {
          name: initial.name,
          categoryId: initial.categoryId,
          supplierId: initial.supplierId ?? '',
          brand: initial.brand ?? '',
          reference: initial.reference ?? '',
          barcode: initial.barcode ?? '',
          description: initial.description ?? '',
          purchasePrice: initial.purchasePrice,
          sellPrice: initial.sellPrice,
          lowStockThreshold: initial.lowStockThreshold,
          active: initial.active,
        }
      : {
          name: '',
          categoryId: categories[0]?._id ?? '',
          supplierId: '',
          brand: '',
          reference: '',
          barcode: '',
          description: '',
          purchasePrice: 0,
          sellPrice: 0,
          lowStockThreshold: 3,
          active: true,
        },
  });

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        ...values,
        supplierId: values.supplierId || null,
      };

      const response = initial
        ? await api.patch<{ product: Product }>(`/products/${initial._id}`, payload)
        : await api.post<{ product: Product }>('/products', payload);

      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        await api.post(`/products/${response.data.product._id}/image`, formData);
      }
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      size="lg"
      title={initial ? 'Modifier le produit' : 'Nouveau produit'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" form="product-form" disabled={isSubmitting || save.isPending}>
            {isSubmitting || save.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <form id="product-form" onSubmit={handleSubmit((values) => save.mutate(values))} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Nom</label>
          <input className="input" {...register('name')} />
          {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>}
        </div>

        <div className="sm:col-span-2">
          <label className="label">Image produit</label>
          {initial?.imagePath && !imageFile && (
            <div className="mb-2 h-24 w-24 overflow-hidden rounded-lg border border-slate-200">
              <img src={uploadUrl(initial.imagePath)} alt={initial.name} className="h-full w-full object-cover" />
            </div>
          )}
          <input
            type="file"
            className="input"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
          />
          {imageFile && <p className="mt-1 text-xs text-slate-500">{imageFile.name}</p>}
        </div>

        <div>
          <label className="label">Categorie</label>
          <select className="input" {...register('categoryId')}>
            <option value="">Selectionner</option>
            {categories.map((category) => (
              <option key={category._id} value={category._id}>
                {category.name}
              </option>
            ))}
          </select>
          {errors.categoryId && <p className="mt-1 text-xs text-rose-600">{errors.categoryId.message}</p>}
        </div>

        <div>
          <label className="label">Fournisseur</label>
          <select className="input" {...register('supplierId')}>
            <option value="">-</option>
            {suppliers.map((supplier) => (
              <option key={supplier._id} value={supplier._id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Marque</label>
          <input className="input" {...register('brand')} />
        </div>

        <div>
          <label className="label">Reference</label>
          <input className="input" {...register('reference')} />
        </div>

        <div>
          <label className="label">Code-barres</label>
          <input className="input" {...register('barcode')} />
        </div>

        <div>
          <label className="label">Seuil alerte</label>
          <input type="number" min={0} className="input" {...register('lowStockThreshold')} />
        </div>

        <div>
          <label className="label">Prix achat</label>
          <input type="number" min={0} step="0.01" className="input" {...register('purchasePrice')} />
        </div>

        <div>
          <label className="label">Prix vente</label>
          <input type="number" min={0} step="0.01" className="input" {...register('sellPrice')} />
        </div>

        <div className="sm:col-span-2">
          <label className="label">Description</label>
          <textarea rows={3} className="input" {...register('description')} />
        </div>

        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('active')} /> Produit actif
        </label>

        {error && (
          <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}

function ArchiveProductModal({
  product,
  onClose,
  onArchived,
}: {
  product: Product;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const archive = useMutation({
    mutationFn: async () => api.delete(`/products/${product._id}`),
    onSuccess: onArchived,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      size="sm"
      title="Desactiver le produit"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-danger" onClick={() => archive.mutate()} disabled={archive.isPending}>
            {archive.isPending ? 'Traitement...' : 'Desactiver'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          Le produit <span className="font-semibold text-slate-900">{product.name}</span> sera retire des listes actives
          sans supprimer son historique.
        </p>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{error}</div>}
      </div>
    </Modal>
  );
}
