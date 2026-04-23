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
import { useDebouncedValue } from '../lib/hooks';
import type { Category, PageMeta, Product, Supplier } from '../lib/types';

const schema = z.object({
  name: z.string().min(1, 'Nom requis').max(150),
  categoryId: z.string().min(1, 'Catégorie requise'),
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
  const canEdit = user?.role === 'admin' || user?.role === 'manager';
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | ''>('true');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<Product | null>(null);
  const qc = useQueryClient();

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
  const suppliersById = useMemo(
    () => new Map((suppliers.data ?? []).map((supplier) => [supplier._id, supplier.name])),
    [suppliers.data],
  );

  return (
    <>
      <PageHeader
        title="Produits"
        subtitle={`${products.data?.meta.total ?? 0} produits dans le catalogue`}
        actions={canEdit && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + Nouveau produit
          </button>
        )}
      />

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_220px_180px]">
          <input
            type="search"
            placeholder="Nom, référence, code-barres, marque…"
            className="input"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            className="input"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Toutes catégories</option>
            {(categories.data ?? []).map((category) => (
              <option key={category._id} value={category._id}>{category.name}</option>
            ))}
          </select>
          <select
            className="input"
            value={activeFilter}
            onChange={(e) => {
              setActiveFilter(e.target.value as 'true' | 'false' | '');
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
              <th className="th">Catégorie</th>
              <th className="th">Référence</th>
              <th className="th">Fournisseur</th>
              <th className="th text-right">Prix achat</th>
              <th className="th text-right">Prix vente</th>
              <th className="th text-center">Seuil</th>
              <th className="th">Statut</th>
              {canEdit && <th className="th text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(products.data?.products ?? []).map((product) => (
              <tr key={product._id}>
                <td className="td">
                  <div className="font-medium text-slate-900">{product.name}</div>
                  <div className="text-xs text-slate-500">
                    {[product.brand, product.barcode].filter(Boolean).join(' · ') || 'Sans marque ni code-barres'}
                  </div>
                </td>
                <td className="td text-slate-500">{categoriesById.get(product.categoryId) ?? '—'}</td>
                <td className="td text-slate-500">{product.reference ?? '—'}</td>
                <td className="td text-slate-500">{product.supplierId ? suppliersById.get(product.supplierId) ?? '—' : '—'}</td>
                <td className="td text-right">{money(product.purchasePrice)}</td>
                <td className="td text-right font-medium">{money(product.sellPrice)}</td>
                <td className="td text-center">{product.lowStockThreshold}</td>
                <td className="td">
                  {product.active ? <span className="badge-success">Actif</span> : <span className="badge-muted">Inactif</span>}
                </td>
                {canEdit && (
                  <td className="td">
                    <div className="flex justify-end gap-2">
                      <button className="btn-secondary !px-3 !py-1.5" onClick={() => setEditing(product)}>
                        Modifier
                      </button>
                      {product.active && (
                        <button className="btn-danger !px-3 !py-1.5" onClick={() => setArchiving(product)}>
                          Désactiver
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!products.isLoading && (products.data?.products.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={canEdit ? 9 : 8}>Aucun produit.</td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={products.data?.meta} onPageChange={setPage} className="px-4 py-3" />
      </div>

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
            qc.invalidateQueries({ queryKey: ['products'] });
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
            qc.invalidateQueries({ queryKey: ['products'] });
            setArchiving(null);
          }}
        />
      )}
    </>
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
      if (initial) {
        await api.patch(`/products/${initial._id}`, payload);
      } else {
        await api.post('/products', payload);
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
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="product-form" disabled={isSubmitting || save.isPending}>
            {isSubmitting || save.isPending ? 'Enregistrement…' : 'Enregistrer'}
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
        <div>
          <label className="label">Catégorie</label>
          <select className="input" {...register('categoryId')}>
            <option value="">Sélectionner</option>
            {categories.map((category) => (
              <option key={category._id} value={category._id}>{category.name}</option>
            ))}
          </select>
          {errors.categoryId && <p className="mt-1 text-xs text-rose-600">{errors.categoryId.message}</p>}
        </div>
        <div>
          <label className="label">Fournisseur</label>
          <select className="input" {...register('supplierId')}>
            <option value="">—</option>
            {suppliers.map((supplier) => (
              <option key={supplier._id} value={supplier._id}>{supplier.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Marque</label>
          <input className="input" {...register('brand')} />
        </div>
        <div>
          <label className="label">Référence</label>
          <input className="input" {...register('reference')} />
        </div>
        <div>
          <label className="label">Code-barres</label>
          <input className="input" {...register('barcode')} />
        </div>
        <div>
          <label className="label">Seuil d’alerte</label>
          <input type="number" min={0} className="input" {...register('lowStockThreshold')} />
        </div>
        <div>
          <label className="label">Prix achat (TND)</label>
          <input type="number" step="0.01" min={0} className="input" {...register('purchasePrice')} />
        </div>
        <div>
          <label className="label">Prix vente (TND)</label>
          <input type="number" step="0.01" min={0} className="input" {...register('sellPrice')} />
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
    mutationFn: async () => {
      await api.delete(`/products/${product._id}`);
    },
    onSuccess: onArchived,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      size="sm"
      title="Désactiver le produit"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-danger" onClick={() => archive.mutate()} disabled={archive.isPending}>
            {archive.isPending ? 'Traitement…' : 'Désactiver'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          Le produit <span className="font-semibold text-slate-900">{product.name}</span> sera retiré des listes actives
          sans casser l’historique des ventes et du stock.
        </p>
        <p>Ce comportement reprend la logique du legacy PHP, qui désactivait les produits au lieu de les supprimer physiquement.</p>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{error}</div>}
      </div>
    </Modal>
  );
}
