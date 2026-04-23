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
import type { Category, Product, Supplier } from '../lib/types';

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
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const products = useQuery({
    queryKey: ['products', search],
    queryFn: async () => (await api.get<{ products: Product[] }>('/products', { params: { q: search || undefined } })).data.products,
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
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );

  return (
    <>
      <PageHeader
        title="Produits"
        subtitle={`${products.data?.length ?? 0} produits au catalogue`}
        actions={canEdit && (
          <button className="btn-primary" onClick={() => setCreating(true)}>+ Nouveau produit</button>
        )}
      />
      <div className="mb-4">
        <input
          type="search"
          placeholder="Recherche par nom, référence, code-barres, marque…"
          className="input max-w-md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Produit</th>
              <th className="th">Catégorie</th>
              <th className="th">Marque</th>
              <th className="th">Référence</th>
              <th className="th text-right">Prix achat</th>
              <th className="th text-right">Prix vente</th>
              <th className="th">Statut</th>
              {canEdit && <th className="th"></th>}
            </tr>
          </thead>
          <tbody>
            {(products.data ?? []).map((p) => (
              <tr key={p.id}>
                <td className="td font-medium">{p.name}</td>
                <td className="td text-slate-500">{categoriesById.get(p.categoryId) ?? '—'}</td>
                <td className="td text-slate-500">{p.brand ?? '—'}</td>
                <td className="td text-slate-500">{p.reference ?? '—'}</td>
                <td className="td text-right">{money(p.purchasePrice)}</td>
                <td className="td text-right">{money(p.sellPrice)}</td>
                <td className="td">
                  {p.active ? <span className="badge-success">actif</span> : <span className="badge-muted">inactif</span>}
                </td>
                {canEdit && (
                  <td className="td text-right">
                    <button className="text-brand-600 hover:underline" onClick={() => setEditing(p)}>
                      Modifier
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!products.isLoading && (products.data?.length ?? 0) === 0 && (
              <tr><td className="td text-slate-400" colSpan={canEdit ? 8 : 7}>Aucun produit.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (creating || editing) && (
        <ProductForm
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
    </>
  );
}

function ProductForm({
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
      : { name: '', categoryId: categories[0]?.id ?? '', purchasePrice: 0, sellPrice: 0, lowStockThreshold: 3, active: true },
  });

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        ...values,
        supplierId: values.supplierId || null,
      };
      if (initial) {
        await api.patch(`/products/${initial.id}`, payload);
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
          <button className="btn-primary" form="product-form" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <form id="product-form" onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Nom</label>
          <input className="input" {...register('name')} />
          {errors.name && <p className="text-xs text-rose-600 mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <label className="label">Catégorie</label>
          <select className="input" {...register('categoryId')}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Fournisseur</label>
          <select className="input" {...register('supplierId')}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
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
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" {...register('active')} /> Actif
        </label>
        {error && <div className="sm:col-span-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
