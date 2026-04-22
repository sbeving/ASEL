import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import type { Franchise, StockItem } from '../lib/types';

interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  available: number;
}

export function POSPage() {
  const { user } = useAuth();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager';
  const qc = useQueryClient();

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const [selectedFid, setSelectedFid] = useState('');
  const effectiveFid = isGlobal ? selectedFid : user?.franchiseId ?? '';

  const [search, setSearch] = useState('');
  const stock = useQuery({
    enabled: !!effectiveFid,
    queryKey: ['stock-pos', effectiveFid, search],
    queryFn: async () =>
      (
        await api.get<{ items: StockItem[] }>('/stock', {
          params: { franchiseId: effectiveFid, q: search || undefined },
        })
      ).data.items,
  });

  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer' | 'other'>('cash');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function addToCart(s: StockItem) {
    if (s.quantity <= 0) return;
    setCart((prev) => {
      const i = prev.findIndex((c) => c.productId === s.productId);
      if (i >= 0) {
        const existing = prev[i]!;
        if (existing.quantity >= s.quantity) return prev;
        const copy = [...prev];
        copy[i] = { ...existing, quantity: existing.quantity + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          productId: s.productId,
          name: s.product.name,
          quantity: 1,
          unitPrice: s.product.sellPrice,
          available: s.quantity,
        },
      ];
    });
  }

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0), [cart]);
  const total = Math.max(0, subtotal - discount);

  const checkout = useMutation({
    mutationFn: async () => {
      if (!effectiveFid || cart.length === 0) throw new Error('Panier vide');
      await api.post('/sales', {
        franchiseId: effectiveFid,
        items: cart.map((c) => ({ productId: c.productId, quantity: c.quantity, unitPrice: c.unitPrice })),
        discount,
        paymentMethod,
      });
    },
    onSuccess: () => {
      setSuccess(`Vente enregistrée — ${money(total)}`);
      setError(null);
      setCart([]);
      setDiscount(0);
      qc.invalidateQueries({ queryKey: ['stock-pos'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: (err) => {
      setError(apiError(err).message);
      setSuccess(null);
    },
  });

  return (
    <>
      <PageHeader title="Caisse (POS)" subtitle="Enregistrer une vente" />
      {isGlobal && (
        <div className="mb-4">
          <select className="input max-w-sm" value={selectedFid} onChange={(e) => setSelectedFid(e.target.value)}>
            <option value="">— Sélectionner une franchise —</option>
            {(franchises.data ?? []).map((f) => (
              <option key={f._id} value={f._id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      {!effectiveFid && <div className="text-slate-500">Sélectionnez une franchise pour commencer.</div>}

      {effectiveFid && (
        <div className="grid gap-5 lg:grid-cols-5">
          <section className="lg:col-span-3 card p-4">
            <input
              type="search"
              placeholder="Rechercher / scanner un produit…"
              autoFocus
              className="input mb-3"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
              {(stock.data ?? []).map((s) => (
                <button
                  key={s._id}
                  type="button"
                  disabled={s.quantity <= 0}
                  onClick={() => addToCart(s)}
                  className="w-full flex justify-between items-center py-2 px-1 text-left hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div>
                    <div className="font-medium">{s.product.name}</div>
                    <div className="text-xs text-slate-500">
                      {s.product.reference ?? '—'} · Stock: {s.quantity}
                    </div>
                  </div>
                  <div className="text-sm font-semibold">{money(s.product.sellPrice)}</div>
                </button>
              ))}
              {!stock.isLoading && (stock.data?.length ?? 0) === 0 && (
                <div className="text-slate-400 text-sm py-4">Aucun produit.</div>
              )}
            </div>
          </section>

          <aside className="lg:col-span-2 card p-4 flex flex-col">
            <h2 className="font-semibold mb-3">Panier</h2>
            <div className="flex-1 max-h-[45vh] overflow-y-auto divide-y divide-slate-100">
              {cart.length === 0 && <div className="text-slate-400 text-sm py-4">Panier vide.</div>}
              {cart.map((l) => (
                <div key={l.productId} className="py-2">
                  <div className="flex justify-between items-start">
                    <div className="text-sm font-medium mr-3">{l.name}</div>
                    <button
                      className="text-slate-400 hover:text-rose-600 text-sm"
                      onClick={() => setCart((c) => c.filter((x) => x.productId !== l.productId))}
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      min={1}
                      max={l.available}
                      className="input !py-1 !px-2 w-20"
                      value={l.quantity}
                      onChange={(e) => {
                        const q = Math.max(1, Math.min(Number(e.target.value) || 1, l.available));
                        setCart((c) =>
                          c.map((x) => (x.productId === l.productId ? { ...x, quantity: q } : x)),
                        );
                      }}
                    />
                    <span className="text-xs text-slate-500">× {money(l.unitPrice)}</span>
                    <span className="ml-auto text-sm font-semibold">{money(l.quantity * l.unitPrice)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span>Sous-total</span><span>{money(subtotal)}</span></div>
              <div className="flex justify-between items-center gap-2">
                <span>Remise</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input !py-1 !px-2 w-28 text-right"
                  value={discount}
                  onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
              <div className="flex justify-between font-semibold text-base border-t pt-2">
                <span>Total</span><span>{money(total)}</span>
              </div>
              <div>
                <label className="label">Mode de paiement</label>
                <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'card' | 'transfer' | 'other')}>
                  <option value="cash">Espèces</option>
                  <option value="card">Carte</option>
                  <option value="transfer">Virement</option>
                  <option value="other">Autre</option>
                </select>
              </div>
              {error && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">{error}</div>}
              {success && <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">{success}</div>}
              <button
                className="btn-primary w-full mt-2"
                disabled={cart.length === 0 || checkout.isPending}
                onClick={() => checkout.mutate()}
              >
                {checkout.isPending ? 'Enregistrement…' : `Encaisser ${money(total)}`}
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
