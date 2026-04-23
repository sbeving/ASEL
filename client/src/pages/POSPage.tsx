import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { money, dateOnly } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { useDebouncedValue } from '../lib/hooks';
import type { Client, Franchise, Installment, Sale, StockItem } from '../lib/types';
import { ScannerModal } from '../components/ScannerModal';

interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  available: number;
  reference?: string;
}

type PaymentMethod = Sale['paymentMethod'];
type SaleType = Sale['saleType'];

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  card: 'Carte',
  transfer: 'Virement',
  installment: 'Échéance',
  other: 'Autre',
};

const saleTypeLabels: Record<SaleType, string> = {
  ticket: 'Ticket',
  facture: 'Facture',
  devis: 'Devis',
};

function toLocalDateTimeInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function buildInstallmentPreview(totalAmount: number, upfrontAmount: number, lotCount: number, startDate: string, intervalDays: number) {
  const remainingAmount = roundCurrency(totalAmount - upfrontAmount);
  if (remainingAmount <= 0 || !Number.isInteger(lotCount) || lotCount <= 0) return [];

  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return [];

  const baseAmount = Math.floor((remainingAmount / lotCount) * 100) / 100;
  const remainder = roundCurrency(remainingAmount - (baseAmount * lotCount));
  const preview: { amount: number; dueDate: string }[] = [];
  const cursor = new Date(start);

  for (let index = 0; index < lotCount; index += 1) {
    preview.push({
      amount: index === lotCount - 1 ? roundCurrency(baseAmount + remainder) : baseAmount,
      dueDate: cursor.toISOString(),
    });
    cursor.setDate(cursor.getDate() + intervalDays);
  }

  return preview;
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
  const debouncedSearch = useDebouncedValue(search, 250);
  const stock = useQuery({
    enabled: !!effectiveFid,
    queryKey: ['stock-pos', effectiveFid, debouncedSearch],
    queryFn: async () =>
      (
        await api.get<{ items: StockItem[] }>('/stock', {
          params: { franchiseId: effectiveFid, q: debouncedSearch || undefined, pageSize: 100 },
        })
      ).data.items,
  });

  const clients = useQuery({
    enabled: !!effectiveFid,
    queryKey: ['clients-pos', effectiveFid],
    queryFn: async () =>
      (
        await api.get<{ clients: Client[] }>('/clients', {
          params: { franchiseId: effectiveFid, pageSize: 200 },
        })
      ).data.clients,
  });

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [saleType, setSaleType] = useState<SaleType>('ticket');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [clientId, setClientId] = useState('');
  const [amountReceived, setAmountReceived] = useState('');
  const [note, setNote] = useState('');
  const [nbLots, setNbLots] = useState(2);
  const [intervalDays, setIntervalDays] = useState(30);
  const [firstDueDate, setFirstDueDate] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function addToCart(item: StockItem) {
    if (item.quantity <= 0) return;
    setCart((current) => {
      const existingIndex = current.findIndex((line) => line.productId === item.productId);
      if (existingIndex >= 0) {
        const existing = current[existingIndex];
        if (!existing || existing.quantity >= item.quantity) return current;
        const copy = [...current];
        copy[existingIndex] = { ...existing, quantity: existing.quantity + 1 };
        return copy;
      }

      return [
        ...current,
        {
          productId: item.productId,
          name: item.product.name,
          quantity: 1,
          unitPrice: item.product.sellPrice,
          available: item.quantity,
          reference: item.product.reference,
        },
      ];
    });
  }

  const subtotal = useMemo(
    () => roundCurrency(cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)),
    [cart],
  );
  const total = Math.max(0, roundCurrency(subtotal - discount));
  const isInstallment = paymentMethod === 'installment';
  const numericAmountReceived = amountReceived.trim() === '' ? null : Math.max(0, Number(amountReceived) || 0);
  const changeDue = !isInstallment && numericAmountReceived !== null
    ? Math.max(0, roundCurrency(numericAmountReceived - total))
    : 0;
  const remainingInstallmentBalance = isInstallment
    ? Math.max(0, roundCurrency(total - (numericAmountReceived ?? 0)))
    : 0;
  const installmentPreview = useMemo(
    () =>
      isInstallment
        ? buildInstallmentPreview(total, numericAmountReceived ?? 0, nbLots, firstDueDate, intervalDays)
        : [],
    [firstDueDate, intervalDays, isInstallment, nbLots, numericAmountReceived, total],
  );

  const checkout = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ sale: Sale; installments: Installment[] }>('/sales', {
          franchiseId: effectiveFid,
          clientId: clientId || null,
          items: cart.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
          saleType,
          discount,
          paymentMethod,
          amountReceived: numericAmountReceived ?? undefined,
          installmentPlan: isInstallment
            ? {
                nbLots,
                startDate: new Date(firstDueDate).toISOString(),
                intervalDays,
                note: note || undefined,
              }
            : undefined,
          note: note || undefined,
        })
      ).data,
    onSuccess: (payload) => {
      const label = payload.sale.invoiceNumber || 'transaction enregistrée';
      const suffix = payload.installments.length > 0 ? ` • ${payload.installments.length} échéance(s)` : '';
      setSuccess(`${label} • ${money(payload.sale.total)}${suffix}`);
      setError(null);
      setCart([]);
      setDiscount(0);
      setClientId('');
      setAmountReceived('');
      setNote('');
      setPaymentMethod('cash');
      setSaleType('ticket');
      setNbLots(2);
      setIntervalDays(30);
      setFirstDueDate(toLocalDateTimeInputValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
      qc.invalidateQueries({ queryKey: ['stock-pos'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['installments'] });
      setTimeout(() => setSuccess(null), 5000);
    },
    onError: (err) => {
      setError(apiError(err).message);
      setSuccess(null);
    },
  });

  const canCheckout = !!effectiveFid && cart.length > 0 && (!isInstallment || !!clientId);

  return (
    <>
      <PageHeader
        title="Caisse (POS)"
        subtitle="Flux de vente enrichi avec ticket/facture/devis et échéances"
      />

      {isGlobal && (
        <div className="mb-4">
          <select className="input max-w-sm" value={selectedFid} onChange={(e) => setSelectedFid(e.target.value)}>
            <option value="">— Sélectionner une franchise —</option>
            {(franchises.data ?? []).map((franchise) => (
              <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
            ))}
          </select>
        </div>
      )}

      {!effectiveFid && <div className="text-slate-500">Sélectionnez une franchise pour commencer.</div>}

      {effectiveFid && (
        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Catalogue</div>
                  <div className="text-xs text-slate-500">Recherche rapide, référence ou scan caméra</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setCameraError(null);
                      setCameraOpen(true);
                    }}
                  >
                    Scanner code-barres
                  </button>
                  {cameraError && <span className="text-xs text-rose-600">{cameraError}</span>}
                </div>
              </div>
              <input
                type="search"
                placeholder="Rechercher par nom, référence ou code-barres…"
                autoFocus
                className="input mt-3"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {cameraOpen && (
              <ScannerModal
                onScan={(raw) => {
                  if (raw) {
                    setSearch(raw);
                    setCameraOpen(false);
                  }
                }}
                onClose={() => setCameraOpen(false)}
                onError={(message) => setCameraError(message)}
              />
            )}

            <div className="max-h-[68vh] overflow-y-auto p-3">
              <div className="grid gap-3 md:grid-cols-2">
                {(stock.data ?? []).map((item) => (
                  <button
                    key={item._id}
                    type="button"
                    disabled={item.quantity <= 0}
                    onClick={() => addToCart(item)}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-400 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{item.product.name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {item.product.reference || 'Réf. non renseignée'}
                        </div>
                      </div>
                      <span className={item.quantity <= item.product.lowStockThreshold ? 'badge-warning' : 'badge-info'}>
                        Stock {item.quantity}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-lg font-semibold text-brand-700">{money(item.product.sellPrice)}</div>
                      <div className="text-xs text-slate-400">Ajouter au panier</div>
                    </div>
                  </button>
                ))}
              </div>

              {!stock.isLoading && (stock.data?.length ?? 0) === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400">
                  Aucun produit trouvé pour cette recherche.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-5">
            <section className="card p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">Encaissement</h2>
                  <p className="text-xs text-slate-500">Paramètres de la transaction avant validation.</p>
                </div>
                <span className="badge-info">{cart.length} ligne(s)</span>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                <div>
                  <label className="label">Type de pièce</label>
                  <select className="input" value={saleType} onChange={(e) => setSaleType(e.target.value as SaleType)}>
                    {Object.entries(saleTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">Mode de paiement</label>
                  <select
                    className="input"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  >
                    {Object.entries(paymentMethodLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">Client</label>
                  <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="">{isInstallment ? '— Client requis —' : 'Sans client'}</option>
                    {(clients.data ?? []).map((client) => (
                      <option key={client._id} value={client._id}>{client.fullName}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">
                    {isInstallment ? 'Apport initial' : 'Montant reçu'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input"
                    value={amountReceived}
                    placeholder={String(total)}
                    onChange={(e) => setAmountReceived(e.target.value)}
                  />
                </div>

                <div className="md:col-span-2 xl:col-span-1">
                  <label className="label">Note</label>
                  <textarea
                    className="input min-h-24 resize-y"
                    value={note}
                    placeholder="Observations, référence client, contexte de paiement…"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>

              {isInstallment && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                  <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                    <div>
                      <label className="label">Nombre de lots</label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        className="input"
                        value={nbLots}
                        onChange={(e) => setNbLots(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                      />
                    </div>
                    <div>
                      <label className="label">Intervalle (jours)</label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        className="input"
                        value={intervalDays}
                        onChange={(e) => setIntervalDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                      />
                    </div>
                    <div>
                      <label className="label">Première échéance</label>
                      <input
                        type="datetime-local"
                        className="input"
                        value={firstDueDate}
                        onChange={(e) => setFirstDueDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/60 bg-white/80 px-3 py-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Reste à étaler</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">{money(remainingInstallmentBalance)}</div>
                    </div>
                    <div className="rounded-xl border border-white/60 bg-white/80 px-3 py-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Plan généré</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">{installmentPreview.length} lot(s)</div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {installmentPreview.map((item, index) => (
                      <div key={`${item.dueDate}-${index}`} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm">
                        <span className="text-slate-600">Lot {index + 1} • {dateOnly(item.dueDate)}</span>
                        <span className="font-semibold text-slate-900">{money(item.amount)}</span>
                      </div>
                    ))}
                    {installmentPreview.length === 0 && (
                      <div className="text-sm text-amber-700">
                        Saisissez un apport inférieur au total et une date valide pour générer les lots.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="card p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Panier</h2>
                <button
                  type="button"
                  className="text-xs font-medium text-slate-500 hover:text-rose-600"
                  onClick={() => setCart([])}
                  disabled={cart.length === 0}
                >
                  Vider
                </button>
              </div>

              <div className="max-h-[32vh] space-y-3 overflow-y-auto">
                {cart.length === 0 && <div className="text-sm text-slate-400">Panier vide.</div>}
                {cart.map((line) => (
                  <div key={line.productId} className="rounded-2xl border border-slate-200 p-3">
                    <div className="flex justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-900">{line.name}</div>
                        <div className="text-xs text-slate-500">{line.reference || 'Réf. non renseignée'}</div>
                      </div>
                      <button
                        className="text-slate-400 hover:text-rose-600"
                        onClick={() => setCart((current) => current.filter((item) => item.productId !== line.productId))}
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={line.available}
                        className="input !w-20 !py-1.5 !px-2"
                        value={line.quantity}
                        onChange={(e) => {
                          const quantity = Math.max(1, Math.min(Number(e.target.value) || 1, line.available));
                          setCart((current) =>
                            current.map((item) => (item.productId === line.productId ? { ...item, quantity } : item)),
                          );
                        }}
                      />
                      <span className="text-xs text-slate-500">× {money(line.unitPrice)}</span>
                      <span className="ml-auto text-sm font-semibold text-slate-900">
                        {money(line.quantity * line.unitPrice)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Sous-total</span><span>{money(subtotal)}</span></div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">Remise</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input !w-28 !py-1.5 !px-2 text-right"
                    value={discount}
                    onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
                <div className="flex justify-between text-base font-semibold text-slate-900">
                  <span>Total</span>
                  <span>{money(total)}</span>
                </div>
                {!isInstallment && numericAmountReceived !== null && (
                  <div className="flex justify-between text-slate-500">
                    <span>Monnaie à rendre</span>
                    <span>{money(changeDue)}</span>
                  </div>
                )}

                {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
                {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</div>}

                <button
                  className="btn-primary w-full"
                  disabled={!canCheckout || checkout.isPending}
                  onClick={() => checkout.mutate()}
                >
                  {checkout.isPending ? 'Validation…' : `Encaisser ${money(total)}`}
                </button>

                {isInstallment && !clientId && (
                  <div className="text-xs text-amber-700">Un client doit être sélectionné pour une vente à échéances.</div>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
