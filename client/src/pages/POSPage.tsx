import { useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, ScanLine, ShoppingCart, Trash2, Plus, Minus,
  CreditCard, Banknote, Landmark, CalendarClock, Receipt, FileText, FileSignature, AlertCircle, CheckCircle2, Store, Package, ChevronLeft, ChevronRight
} from 'lucide-react';
import { api, apiError } from '../lib/api';
import { money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { useDebouncedValue } from '../lib/hooks';
import type { Client, Franchise, Installment, Sale, StockItem } from '../lib/types';
import { ScannerModal } from '../components/ScannerModal';
import { SearchableSelect, type SearchableSelectOption } from '../components/SearchableSelect';
import clsx from 'clsx';

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

const paymentMethodConfig: Record<PaymentMethod, { label: string; icon: any; color: string }> = {
  cash: { label: 'Espèces', icon: Banknote, color: 'text-emerald-500' },
  card: { label: 'Carte', icon: CreditCard, color: 'text-indigo-500' },
  transfer: { label: 'Virement', icon: Landmark, color: 'text-blue-500' },
  installment: { label: 'Échéance', icon: CalendarClock, color: 'text-amber-500' },
  other: { label: 'Autre', icon: Receipt, color: 'text-slate-500' },
};

const saleTypeConfig: Record<SaleType, { label: string; icon: any }> = {
  ticket: { label: 'Ticket', icon: Receipt },
  facture: { label: 'Facture', icon: FileText },
  devis: { label: 'Devis', icon: FileSignature },
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
  const [filterMode, setFilterMode] = useState<'all' | 'available' | 'low'>('all');
  const [posPage, setPosPage] = useState(1);
  const ITEMS_PER_PAGE = 12;
  const debouncedSearch = useDebouncedValue(search, 250);

  // Reset pagination on search or filter change
  useEffect(() => {
    setPosPage(1);
  }, [debouncedSearch, filterMode]);

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

  const clientOptions: SearchableSelectOption[] = useMemo(
    () =>
      (clients.data ?? []).map((client) => ({
        value: client._id,
        label: client.fullName,
        subtitle: [client.phone, client.clientType].filter(Boolean).join(' | ') || undefined,
        keywords: [client.phone, client.email, client.company, client.cin].filter(Boolean).join(' '),
      })),
    [clients.data],
  );

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

  function updateCartQuantity(productId: string, delta: number) {
    setCart((current) =>
      current.map((line) => {
        if (line.productId === productId) {
          const newQ = Math.max(1, Math.min(line.quantity + delta, line.available));
          return { ...line, quantity: newQ };
        }
        return line;
      })
    );
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
    <div className="h-full flex flex-col">
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <PageHeader
          title="Terminal de Vente"
          subtitle="Encaissement rapide et gestion des échéances"
        />
        {isGlobal && (
          <div className="w-full md:w-72">
            <select className="input shadow-sm" value={selectedFid} onChange={(e) => setSelectedFid(e.target.value)}>
              <option value="">— Sélectionner une franchise —</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!effectiveFid ? (
        <div className="flex-1 flex flex-col items-center justify-center text-surface-400">
          <Store className="w-16 h-16 mb-4 text-surface-300" strokeWidth={1} />
          <p className="text-lg">Sélectionnez une franchise pour commencer.</p>
        </div>
      ) : (
        <div className="grid h-full gap-6 xl:grid-cols-[1.8fr_1.2fr] pb-10">
          {/* CATALOG SECTION */}
          <section className="flex flex-col overflow-hidden rounded-3xl border border-surface-200/60 bg-white/60 shadow-glass backdrop-blur-xl">
            <div className="border-b border-surface-200/50 bg-white/80 p-5 backdrop-blur-md">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-400" />
                  <input
                    type="search"
                    placeholder="Rechercher un produit ou référence..."
                    autoFocus
                    className="input pl-11 !rounded-2xl !py-2.5 !text-sm shadow-sm"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 hide-scrollbar">
                  {(['all', 'available', 'low'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setFilterMode(mode)}
                      className={clsx(
                        "whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-all border",
                        filterMode === mode
                          ? "bg-brand-50 border-brand-200 text-brand-700 dark:bg-brand-900/40 dark:border-brand-700 dark:text-brand-300"
                          : "bg-surface-50 border-surface-200 text-surface-600 hover:bg-surface-100 dark:bg-surface-800 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-700"
                      )}
                    >
                      {mode === 'all' && 'Tous'}
                      {mode === 'available' && 'En Stock'}
                      {mode === 'low' && 'Stock Faible'}
                    </button>
                  ))}
                  <div className="w-px h-6 bg-surface-200 dark:bg-surface-700 mx-1"></div>
                  <button
                    type="button"
                    className="btn-secondary !rounded-xl !py-2 !px-3 whitespace-nowrap shadow-sm hover:border-brand-300 hover:text-brand-600 group"
                    onClick={() => {
                      setCameraError(null);
                      setCameraOpen(true);
                    }}
                  >
                    <ScanLine className="h-4 w-4 text-surface-400 group-hover:text-brand-500 transition-colors" />
                    <span className="text-xs hidden sm:inline">Scanner</span>
                  </button>
                </div>
              </div>
              {cameraError && <p className="mt-2 text-xs text-rose-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {cameraError}</p>}
            </div>

            {cameraOpen && (
              <ScannerModal
                onScan={(raw) => {
                  if (raw) {
                    setCameraError(null);
                    setSearch(raw.trim());
                    setCameraOpen(false);
                  }
                }}
                onClose={() => setCameraOpen(false)}
                onError={(message) => setCameraError(message)}
              />
            )}

            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
              {stock.isLoading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-32 rounded-2xl bg-surface-100/50 animate-pulse border border-surface-200/50"></div>
                  ))}
                </div>
              ) : (stock.data?.length ?? 0) === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-surface-400 opacity-60">
                  <Package className="h-16 w-16 mb-4 text-surface-300" strokeWidth={1} />
                  <p>Aucun produit trouvé pour "{search}".</p>
                </div>
              ) : (() => {
                const filteredStock = (stock.data ?? []).filter(item => {
                  if (filterMode === 'available') return item.quantity > 0;
                  if (filterMode === 'low') return item.quantity <= item.product.lowStockThreshold;
                  return true;
                });
                const totalPages = Math.max(1, Math.ceil(filteredStock.length / ITEMS_PER_PAGE));
                const paginatedStock = filteredStock.slice((posPage - 1) * ITEMS_PER_PAGE, posPage * ITEMS_PER_PAGE);

                if (filteredStock.length === 0) {
                  return (
                    <div className="flex h-full flex-col items-center justify-center text-surface-400 opacity-60">
                      <Package className="h-16 w-16 mb-4 text-surface-300" strokeWidth={1} />
                      <p>Aucun produit ne correspond à ces filtres.</p>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col h-full">
                    <motion.div layout className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 flex-1 content-start">
                      <AnimatePresence mode="popLayout">
                        {paginatedStock.map((item) => (
                          <motion.button
                            layout
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.2 }}
                            key={item._id}
                            type="button"
                            disabled={item.quantity <= 0}
                            onClick={() => addToCart(item)}
                            className="group relative flex flex-col text-left overflow-hidden rounded-2xl border border-surface-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-1 hover:border-brand-400 hover:shadow-glass-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
                          >
                            <div className="mb-4 flex items-start justify-between gap-2 w-full">
                              <div className="flex-1 min-w-0">
                                <h3 className="truncate font-semibold text-surface-900 group-hover:text-brand-700 transition-colors">
                                  {item.product.name}
                                </h3>
                                <p className="truncate text-xs text-surface-500 mt-0.5">
                                  {item.product.reference || 'Réf. non renseignée'}
                                </p>
                              </div>
                              <span className={clsx("badge whitespace-nowrap", item.quantity <= item.product.lowStockThreshold ? 'badge-warning' : 'badge-success')}>
                                Stock: {item.quantity}
                              </span>
                            </div>
                            <div className="mt-auto flex w-full items-center justify-between">
                              <span className="text-xl font-bold tracking-tight text-surface-900">
                                {money(item.product.sellPrice)}
                              </span>
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 opacity-0 transition-all group-hover:opacity-100">
                                <Plus className="h-5 w-5" />
                              </div>
                            </div>
                          </motion.button>
                        ))}
                      </AnimatePresence>
                    </motion.div>
                    
                    {totalPages > 1 && (
                      <div className="mt-6 flex items-center justify-between border-t border-surface-200 pt-4">
                        <span className="text-sm text-surface-500 font-medium">
                          Page {posPage} sur {totalPages}
                        </span>
                        <div className="flex gap-2">
                          <button 
                            className="btn-secondary !p-2" 
                            disabled={posPage === 1}
                            onClick={() => setPosPage(p => Math.max(1, p - 1))}
                          >
                            <ChevronLeft className="w-5 h-5" />
                          </button>
                          <button 
                            className="btn-secondary !p-2" 
                            disabled={posPage === totalPages}
                            onClick={() => setPosPage(p => Math.min(totalPages, p + 1))}
                          >
                            <ChevronRight className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </section>

          {/* CHECKOUT SECTION */}
          <aside className="flex flex-col overflow-hidden rounded-3xl border border-surface-200/60 bg-white shadow-glass">
            <div className="border-b border-surface-100 bg-surface-50/50 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2 text-surface-900">
                  <ShoppingCart className="h-5 w-5 text-brand-500" />
                  Panier
                </h2>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs font-semibold text-rose-500 hover:text-rose-600 transition-colors disabled:opacity-50"
                  onClick={() => setCart([])}
                  disabled={cart.length === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Vider
                </button>
              </div>

              <div className="flex-1 max-h-[30vh] min-h-[20vh] overflow-y-auto pr-2 custom-scrollbar">
                <AnimatePresence initial={false}>
                  {cart.length === 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex h-full items-center justify-center text-sm text-surface-400">
                      Votre panier est vide.
                    </motion.div>
                  )}
                  {cart.map((line) => (
                    <motion.div
                      key={line.productId}
                      layout
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
                      className="group mb-3 rounded-xl border border-surface-100 bg-white p-3 shadow-sm hover:border-brand-200 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-surface-900">{line.name}</div>
                          <div className="text-xs text-surface-500">{money(line.unitPrice)} unitaire</div>
                        </div>
                        <button
                          className="ml-2 p-1 text-surface-300 hover:text-rose-500 transition-colors rounded-md hover:bg-rose-50"
                          onClick={() => setCart((current) => current.filter((item) => item.productId !== line.productId))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center rounded-lg border border-surface-200 bg-surface-50/50 p-1">
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-surface-600 shadow-sm hover:text-brand-600 disabled:opacity-50"
                            onClick={() => updateCartQuantity(line.productId, -1)}
                            disabled={line.quantity <= 1}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-10 text-center text-sm font-semibold">{line.quantity}</span>
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-surface-600 shadow-sm hover:text-brand-600 disabled:opacity-50"
                            onClick={() => updateCartQuantity(line.productId, 1)}
                            disabled={line.quantity >= line.available}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="text-base font-bold text-surface-900">
                          {money(line.quantity * line.unitPrice)}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-white custom-scrollbar">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="label">Type de document</label>
                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-100 p-1">
                      {Object.entries(saleTypeConfig).map(([val, conf]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setSaleType(val as SaleType)}
                          className={clsx(
                            "flex flex-col items-center justify-center rounded-lg py-1.5 transition-all duration-200",
                            saleType === val ? "bg-white shadow-sm text-surface-900 font-semibold" : "text-surface-500 hover:text-surface-700"
                          )}
                        >
                          <conf.icon className={clsx("h-4 w-4 mb-1", saleType === val ? "text-brand-500" : "")} />
                          <span className="text-[10px] uppercase tracking-wider">{conf.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="label">Paiement</label>
                    <div className="relative">
                      <select
                        className="input appearance-none pl-10"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                      >
                        {Object.entries(paymentMethodConfig).map(([val, conf]) => (
                          <option key={val} value={val}>{conf.label}</option>
                        ))}
                      </select>
                      {(() => {
                        const Icon = paymentMethodConfig[paymentMethod].icon;
                        const colorClass = paymentMethodConfig[paymentMethod].color;
                        return <Icon className={clsx("absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4", colorClass)} />;
                      })()}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="label">Client</label>
                  <SearchableSelect
                    value={clientId}
                    options={clientOptions}
                    onChange={setClientId}
                    allowClear
                    placeholder={isInstallment ? 'Client obligatoire pour échéance...' : 'Client occasionnel (optionnel)'}
                    emptyMessage="Aucun client trouvé"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Remise globale</label>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input pr-8"
                        value={discount === 0 ? '' : discount}
                        placeholder="0.00"
                        onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm">DA</span>
                    </div>
                  </div>
                  <div>
                    <label className="label">{isInstallment ? 'Apport initial' : 'Montant reçu'}</label>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input pr-8 font-semibold text-brand-700"
                        value={amountReceived}
                        placeholder={String(total)}
                        onChange={(e) => setAmountReceived(e.target.value)}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm">DA</span>
                    </div>
                  </div>
                </div>
                
                <div>
                  <label className="label">Note (Optionnelle)</label>
                  <textarea
                    className="input min-h-[60px] resize-none text-xs"
                    value={note}
                    placeholder="Observations, référence..."
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>

                {isInstallment && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
                    <div className="rounded-2xl border border-amber-200/50 bg-amber-50/50 p-4 shadow-inner">
                      <h4 className="text-xs font-bold uppercase text-amber-800 mb-3 flex items-center gap-2">
                        <CalendarClock className="w-4 h-4" /> Plan d'Échéance
                      </h4>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold text-amber-700">Lots</label>
                          <input type="number" min={1} max={60} className="input !bg-white/80 !py-1.5 !px-2 text-sm" value={nbLots} onChange={(e) => setNbLots(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-amber-700">Jours</label>
                          <input type="number" min={1} max={365} className="input !bg-white/80 !py-1.5 !px-2 text-sm" value={intervalDays} onChange={(e) => setIntervalDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-amber-700">Début</label>
                          <input type="datetime-local" className="input !bg-white/80 !py-1.5 !px-2 text-xs" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />
                        </div>
                      </div>

                      <div className="mt-3 flex gap-2">
                        <div className="flex-1 rounded-xl bg-white/60 px-3 py-2 text-center">
                          <div className="text-[10px] uppercase text-amber-600/80">Reste</div>
                          <div className="font-bold text-amber-900">{money(remainingInstallmentBalance)}</div>
                        </div>
                        <div className="flex-1 rounded-xl bg-white/60 px-3 py-2 text-center">
                          <div className="text-[10px] uppercase text-amber-600/80">Lots</div>
                          <div className="font-bold text-amber-900">{installmentPreview.length}</div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            <div className="border-t border-surface-200 bg-white p-5 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] z-10">
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm text-surface-500">
                  <span>Sous-total</span>
                  <span>{money(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600 font-medium">
                    <span>Remise</span>
                    <span>-{money(discount)}</span>
                  </div>
                )}
                {!isInstallment && numericAmountReceived !== null && changeDue > 0 && (
                  <div className="flex justify-between text-sm text-amber-600 font-medium">
                    <span>Monnaie à rendre</span>
                    <span>{money(changeDue)}</span>
                  </div>
                )}
                <div className="flex justify-between items-end border-t border-surface-100 pt-2 mt-2">
                  <span className="text-surface-900 font-semibold uppercase tracking-wider text-sm">Total à Payer</span>
                  <span className="text-3xl font-black tracking-tight text-brand-600">{money(total)}</span>
                </div>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-600 flex items-start gap-2 border border-rose-100">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </motion.div>
                )}
                {success && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 flex items-start gap-2 border border-emerald-100">
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <span>{success}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                className="btn-primary w-full !py-4 !text-lg !rounded-2xl shadow-lg shadow-brand-500/25 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-500/30"
                disabled={!canCheckout || checkout.isPending}
                onClick={() => checkout.mutate()}
              >
                {checkout.isPending ? (
                  <span className="flex items-center gap-2 animate-pulse">
                    <Banknote className="w-6 h-6" /> Traitement...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Banknote className="w-6 h-6" /> Valider l'encaissement
                  </span>
                )}
              </button>
              
              {isInstallment && !clientId && (
                <p className="mt-3 text-center text-xs font-medium text-amber-600 flex items-center justify-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Un client est requis pour l'échéance
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
