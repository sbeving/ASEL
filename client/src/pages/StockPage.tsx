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
import type { Franchise, Product, StockItem } from '../lib/types';

export function StockPage() {
  const { user } = useAuth();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager';
  const qc = useQueryClient();

  const franchises = useQuery({
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const [selectedFid, setSelectedFid] = useState<string>('');
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);

  const effectiveFid = isGlobal ? selectedFid : user?.franchiseId ?? '';
  const stock = useQuery({
    enabled: !!effectiveFid,
    queryKey: ['stock', effectiveFid, search, lowOnly],
    queryFn: async () =>
      (
        await api.get<{ items: StockItem[] }>('/stock', {
          params: { franchiseId: effectiveFid, q: search || undefined, lowOnly: lowOnly || undefined },
        })
      ).data.items,
  });

  const canEnter = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'franchise';

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle="Vue par franchise"
        actions={
          canEnter && effectiveFid ? (
            <button className="btn-primary" onClick={() => setEntryOpen(true)}>+ Entrée stock</button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-3 mb-4">
        {isGlobal && (
          <select className="input max-w-sm" value={selectedFid} onChange={(e) => setSelectedFid(e.target.value)}>
            <option value="">— Sélectionner une franchise —</option>
            {(franchises.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
        <input
          type="search"
          placeholder="Rechercher un produit…"
          className="input max-w-md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="inline-flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Stock faible seulement
        </label>
      </div>

      {!effectiveFid && <div className="text-slate-500">Sélectionnez une franchise pour voir le stock.</div>}

      {effectiveFid && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Produit</th>
                <th className="th">Catégorie</th>
                <th className="th">Référence</th>
                <th className="th text-right">Prix vente</th>
                <th className="th text-right">Qté</th>
                <th className="th text-right">Seuil</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {(stock.data ?? []).map((s) => {
                const low = s.quantity <= s.product.lowStockThreshold;
                return (
                  <tr key={s.id} className={low ? 'bg-rose-50/50' : undefined}>
                    <td className="td font-medium">{s.product.name}</td>
                    <td className="td text-slate-500">{s.category?.name ?? '—'}</td>
                    <td className="td text-slate-500">{s.product.reference ?? '—'}</td>
                    <td className="td text-right">{money(s.product.sellPrice)}</td>
                    <td className="td text-right font-semibold">{s.quantity}</td>
                    <td className="td text-right text-slate-500">{s.product.lowStockThreshold}</td>
                    <td className="td">
                      {low && <span className="badge-danger">stock faible</span>}
                    </td>
                  </tr>
                );
              })}
              {!stock.isLoading && (stock.data?.length ?? 0) === 0 && (
                <tr><td className="td text-slate-400" colSpan={7}>Aucun stock pour cette franchise.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {entryOpen && effectiveFid && (
        <StockEntryModal
          franchiseId={effectiveFid}
          onClose={() => setEntryOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['stock'] });
            setEntryOpen(false);
          }}
        />
      )}
    </>
  );
}

const entrySchema = z.object({
  productId: z.string().min(1, 'Produit requis'),
  quantity: z.coerce.number().int().positive('Quantité > 0'),
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
  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: async () => (await api.get<{ products: Product[] }>('/products', { params: { active: 'true', limit: 500 } })).data.products,
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<EntryValues>({
    resolver: zodResolver(entrySchema),
  });
  const productsSorted = useMemo(
    () => [...(products.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [products.data],
  );

  const save = useMutation({
    mutationFn: async (values: EntryValues) =>
      api.post('/stock/entry', { ...values, franchiseId }),
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title="Entrée de stock"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="stock-entry" disabled={isSubmitting}>Enregistrer</button>
        </div>
      }
    >
      <form id="stock-entry" className="space-y-3" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <div>
          <label className="label">Produit</label>
          <select className="input" {...register('productId')}>
            <option value="">— Sélectionner —</option>
            {productsSorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.reference ? `(${p.reference})` : ''}
              </option>
            ))}
          </select>
          {errors.productId && <p className="text-xs text-rose-600 mt-1">{errors.productId.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Quantité</label>
            <input type="number" min={1} className="input" {...register('quantity')} />
            {errors.quantity && <p className="text-xs text-rose-600 mt-1">{errors.quantity.message}</p>}
          </div>
          <div>
            <label className="label">Prix unitaire (opt.)</label>
            <input type="number" step="0.01" min={0} className="input" {...register('unitPrice')} />
          </div>
        </div>
        <div>
          <label className="label">Note</label>
          <textarea rows={2} className="input" {...register('note')} />
        </div>
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
