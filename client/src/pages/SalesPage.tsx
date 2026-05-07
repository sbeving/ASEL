import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { money, dateTime, dateOnly } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { SaleDocumentModal } from '../components/SaleDocumentModal';
import { useAuth } from '../auth/AuthContext';
import { useDebouncedValue } from '../lib/hooks';
import { SearchableSelect, type SearchableSelectOption } from '../components/SearchableSelect';
import { TablePagination } from '../components/TablePagination';
import type { Franchise, PageMeta, Sale } from '../lib/types';

const paymentMethodLabels: Record<Sale['paymentMethod'], string> = {
  cash: 'Especes',
  card: 'Carte',
  transfer: 'Virement',
  installment: 'Echeance',
  other: 'Autre',
};

const saleTypeLabels: Record<Sale['saleType'], string> = {
  ticket: 'Ticket',
  facture: 'Facture',
  devis: 'Devis',
};

const paymentStatusLabels: Record<Sale['paymentStatus'], string> = {
  paid: 'Payee',
  partial: 'Partielle',
  pending: 'En attente',
};

function statusBadgeClass(status: Sale['paymentStatus']) {
  if (status === 'paid') return 'badge-success';
  if (status === 'partial') return 'badge-warning';
  return 'badge-muted';
}

function saleItemsSummary(sale: Sale) {
  const parts = sale.items.slice(0, 3).map((item) => {
    const product = item.productId;
    const label = typeof product === 'object' && product ? product.name || product.reference || 'Produit' : 'Produit';
    return `${label} x${item.quantity}`;
  });
  const extra = sale.items.length > 3 ? ` +${sale.items.length - 3}` : '';
  return `${parts.join(', ')}${extra}`;
}

function saleSellerId(sale: Sale) {
  if (typeof sale.userId === 'object' && sale.userId) return sale.userId.id || sale.userId._id;
  return sale.userId;
}

function canCancelSale(sale: Sale, user: ReturnType<typeof useAuth>['user']) {
  if (!user || sale.cancelledAt) return false;
  const saleFranchiseId = typeof sale.franchiseId === 'object' && sale.franchiseId ? sale.franchiseId._id : String(sale.franchiseId || '');
  if (['ceo', 'admin', 'superadmin', 'manager'].includes(user.role)) return true;
  if (user.role === 'franchise') return Boolean(user.franchiseId && user.franchiseId === saleFranchiseId);
  if (user.role === 'seller' || user.role === 'vendeur') {
    return Boolean(user.franchiseId && user.franchiseId === saleFranchiseId && saleSellerId(sale) === (user.id || user._id));
  }
  return false;
}

export function SalesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isGlobal = user?.role === 'ceo' || user?.role === 'admin' || user?.role === 'manager' || user?.role === 'superadmin';

  const [selectedFid, setSelectedFid] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [saleType, setSaleType] = useState<'' | Sale['saleType']>('');
  const [paymentMethod, setPaymentMethod] = useState<'' | Sale['paymentMethod']>('');
  const [paymentStatus, setPaymentStatus] = useState<'' | Sale['paymentStatus']>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [viewingSaleId, setViewingSaleId] = useState<string | null>(null);
  const pageSize = 30;

  useEffect(() => {
    setPage(1);
  }, [selectedFid, debouncedSearch, saleType, paymentMethod, paymentStatus, fromDate, toDate]);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const sales = useQuery({
    queryKey: ['sales', selectedFid, debouncedSearch, saleType, paymentMethod, paymentStatus, fromDate, toDate, page],
    queryFn: async () =>
      (
        await api.get<{ sales: Sale[]; meta: PageMeta }>('/sales', {
          params: {
            franchiseId: selectedFid || undefined,
            q: debouncedSearch || undefined,
            saleType: saleType || undefined,
            paymentMethod: paymentMethod || undefined,
            paymentStatus: paymentStatus || undefined,
            from: fromDate ? new Date(`${fromDate}T00:00:00.000Z`).toISOString() : undefined,
            to: toDate ? new Date(`${toDate}T23:59:59.999Z`).toISOString() : undefined,
            page,
            pageSize,
          },
        })
      ).data,
  });

  const cancelSale = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      await api.post(`/sales/${id}/cancel`, { reason: reason || undefined });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['sale-document', variables.id] });
    },
    onError: (err) => window.alert(apiError(err).message),
  });

  function requestCancel(sale: Sale) {
    const reason = window.prompt(`Motif annulation ${sale.invoiceNumber || ''}`.trim(), 'Annulation vendeur');
    if (reason === null) return;
    cancelSale.mutate({ id: sale._id, reason });
  }

  const franchiseOptions: SearchableSelectOption[] = useMemo(
    () =>
      (franchises.data ?? []).map((franchise) => ({
        value: franchise._id,
        label: franchise.name,
        subtitle: franchise.address || undefined,
        keywords: [franchise.name, franchise.address, franchise.phone].filter(Boolean).join(' '),
      })),
    [franchises.data],
  );

  const summary = useMemo(() => {
    const rows = (sales.data?.sales ?? []).filter((sale) => !sale.cancelledAt);
    const total = rows.reduce((sum, sale) => sum + sale.total, 0);
    const received = rows.reduce((sum, sale) => sum + (sale.amountReceived ?? 0), 0);
    const installmentSales = rows.filter((sale) => sale.paymentMethod === 'installment').length;
    return { total, received, installmentSales };
  }, [sales.data?.sales]);

  function setTodayFilter() {
    const today = new Date().toISOString().slice(0, 10);
    setFromDate(today);
    setToDate(today);
  }

  function setMonthFilter() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    setFromDate(firstDay);
    setToDate(lastDay);
  }

  function clearFilters() {
    setSelectedFid('');
    setSearch('');
    setSaleType('');
    setPaymentMethod('');
    setPaymentStatus('');
    setFromDate('');
    setToDate('');
  }

  return (
    <>
      <PageHeader title="Ventes" subtitle={`${sales.data?.meta.total ?? 0} transaction(s) trouvee(s)`} />

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {isGlobal && (
            <div className="xl:col-span-2">
              <SearchableSelect
                value={selectedFid}
                options={franchiseOptions}
                onChange={setSelectedFid}
                allowClear
                placeholder="Toutes franchises"
              />
            </div>
          )}
          <input
            type="search"
            className="input xl:col-span-2"
            placeholder="Numero, note, client, produit..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select className="input" value={saleType} onChange={(event) => setSaleType(event.target.value as '' | Sale['saleType'])}>
            <option value="">Type: tous</option>
            <option value="ticket">Ticket</option>
            <option value="facture">Facture</option>
            <option value="devis">Devis</option>
          </select>
          <select
            className="input"
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value as '' | Sale['paymentMethod'])}
          >
            <option value="">Paiement: tous</option>
            {Object.entries(paymentMethodLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            className="input"
            value={paymentStatus}
            onChange={(event) => setPaymentStatus(event.target.value as '' | Sale['paymentStatus'])}
          >
            <option value="">Statut: tous</option>
            {Object.entries(paymentStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <input type="date" className="input" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <input type="date" className="input" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={setTodayFilter}>Aujourd'hui</button>
          <button type="button" className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={setMonthFilter}>Ce mois</button>
          <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={clearFilters}>Effacer filtres</button>
        </div>
      </section>

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total page</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{money(summary.total)}</div>
          <div className="mt-1 text-sm text-slate-500">Transactions affichees</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Encaisse sur page</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{money(summary.received)}</div>
          <div className="mt-1 text-sm text-slate-500">Montant effectivement recu</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Ventes a echeance</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{summary.installmentSales}</div>
          <div className="mt-1 text-sm text-slate-500">Paiement mode echeance</div>
        </div>
      </section>

      <div className="grid gap-3 md:hidden">
        {(sales.data?.sales ?? []).map((sale) => {
          const amountReceived = sale.amountReceived ?? 0;
          const remaining = Math.max(0, sale.total - amountReceived);
          const clientName = typeof sale.clientId === 'object' && sale.clientId ? sale.clientId.fullName : 'Client passage';
          const franchiseName = typeof sale.franchiseId === 'object' ? sale.franchiseId.name : '-';

          return (
            <article key={sale._id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{sale.invoiceNumber || saleTypeLabels[sale.saleType]}</div>
                  <div className="mt-1 text-xs text-slate-500">{dateTime(sale.createdAt)}</div>
                </div>
                {sale.cancelledAt ? (
                  <span className="badge-danger">Annulee</span>
                ) : (
                  <span className={statusBadgeClass(sale.paymentStatus)}>{paymentStatusLabels[sale.paymentStatus]}</span>
                )}
              </div>
              <div className="mt-3 text-sm text-slate-600">
                <div className="font-medium text-slate-900">{clientName}</div>
                <div className="text-xs text-slate-500">{franchiseName} | {saleTypeLabels[sale.saleType]} | {paymentMethodLabels[sale.paymentMethod]}</div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-slate-50 px-2 py-2">
                  <div className="font-bold text-slate-900">{money(sale.total)}</div>
                  <div className="text-slate-500">Total</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-2 py-2">
                  <div className="font-bold text-emerald-700">{sale.amountReceived == null ? '-' : money(amountReceived)}</div>
                  <div className="text-slate-500">Recu</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-2 py-2">
                  <div className={remaining > 0 ? 'font-bold text-amber-700' : 'font-bold text-slate-900'}>{money(remaining)}</div>
                  <div className="text-slate-500">Reste</div>
                </div>
              </div>
              {sale.installmentPlan && (
                <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  {sale.installmentPlan.generatedLots} lot(s), premier lot {dateOnly(sale.installmentPlan.firstDueDate)}
                </div>
              )}
              <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {saleItemsSummary(sale)}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                {canCancelSale(sale, user) && (
                  <button className="btn-danger !px-3 !py-1.5" disabled={cancelSale.isPending} onClick={() => requestCancel(sale)}>
                    Annuler
                  </button>
                )}
                <button className="btn-secondary !px-3 !py-1.5" onClick={() => setViewingSaleId(sale._id)}>
                  Voir piece
                </button>
              </div>
            </article>
          );
        })}
        {!sales.isLoading && (sales.data?.sales.length ?? 0) === 0 && (
          <div className="card p-5 text-sm text-slate-400">Aucune vente.</div>
        )}
        <TablePagination meta={sales.data?.meta} onPageChange={setPage} className="px-2 py-3" />
      </div>

      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Piece</th>
              <th className="th">Date</th>
              <th className="th">Franchise</th>
              <th className="th">Client</th>
              <th className="th">Articles</th>
              <th className="th">Type</th>
              <th className="th">Paiement</th>
              <th className="th">Statut</th>
              <th className="th text-right">Recu</th>
              <th className="th text-right">Reste</th>
              <th className="th text-right">Total</th>
              <th className="th-action">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(sales.data?.sales ?? []).map((sale) => {
              const amountReceived = sale.amountReceived ?? 0;
              const remaining = Math.max(0, sale.total - amountReceived);
              const clientName = typeof sale.clientId === 'object' && sale.clientId ? sale.clientId.fullName : '-';
              const franchiseName = typeof sale.franchiseId === 'object' ? sale.franchiseId.name : '-';

              return (
                <tr key={sale._id}>
                  <td className="td">
                    <div className="font-medium text-slate-900">{sale.invoiceNumber || '-'}</div>
                    <div className="text-xs text-slate-500">{sale.items.length} article(s)</div>
                  </td>
                  <td className="td text-slate-500">
                    <div>{dateTime(sale.createdAt)}</div>
                    {sale.installmentPlan && (
                      <div className="text-xs">1er lot: {dateOnly(sale.installmentPlan.firstDueDate)}</div>
                    )}
                  </td>
                  <td className="td">{franchiseName}</td>
                  <td className="td">{clientName}</td>
                  <td className="td max-w-[260px]">
                    <div className="line-clamp-2 text-xs text-slate-600">{saleItemsSummary(sale)}</div>
                  </td>
                  <td className="td">{saleTypeLabels[sale.saleType]}</td>
                  <td className="td">{paymentMethodLabels[sale.paymentMethod]}</td>
                  <td className="td">
                    {sale.cancelledAt ? (
                      <span className="badge-danger">Annulee</span>
                    ) : (
                      <span className={statusBadgeClass(sale.paymentStatus)}>{paymentStatusLabels[sale.paymentStatus]}</span>
                    )}
                  </td>
                  <td className="td text-right">{sale.amountReceived == null ? '-' : money(amountReceived)}</td>
                  <td className="td text-right">{money(remaining)}</td>
                  <td className="td text-right font-medium">{money(sale.total)}</td>
                  <td className="td-action">
                    <div className="flex justify-end gap-2">
                      {canCancelSale(sale, user) && (
                        <button className="btn-danger !min-h-[34px] !px-3 !py-1" disabled={cancelSale.isPending} onClick={() => requestCancel(sale)}>
                          Annuler
                        </button>
                      )}
                      <button className="btn-secondary !px-3 !py-1.5" onClick={() => setViewingSaleId(sale._id)}>
                        Voir
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!sales.isLoading && (sales.data?.sales.length ?? 0) === 0 && (
              <tr><td className="td text-slate-400" colSpan={12}>Aucune vente.</td></tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={sales.data?.meta} onPageChange={setPage} className="px-4 py-3" />
      </div>

      {viewingSaleId && <SaleDocumentModal saleId={viewingSaleId} onClose={() => setViewingSaleId(null)} />}
    </>
  );
}
