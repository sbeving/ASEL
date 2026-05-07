import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '../lib/api';
import { dateTime, money } from '../lib/money';
import type { Franchise, Sale } from '../lib/types';
import { Modal } from './Modal';

const saleTypeLabels: Record<Sale['saleType'], string> = {
  ticket: 'Ticket',
  facture: 'Facture',
  devis: 'Devis',
};

const paymentMethodLabels: Record<Sale['paymentMethod'], string> = {
  cash: 'Especes',
  card: 'Carte',
  transfer: 'Virement',
  installment: 'Echeance',
  other: 'Autre',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function franchiseName(value: Sale['franchiseId']): string {
  return typeof value === 'object' && value ? (value as Franchise).name : '-';
}

function franchiseTaxId(value: Sale['franchiseId']): string {
  return typeof value === 'object' && value ? ((value as Franchise).taxId || '') : '';
}

function clientName(value: Sale['clientId']): string {
  return typeof value === 'object' && value ? value.fullName : 'Client passage';
}

function productLabel(product: Sale['items'][number]['productId']): string {
  if (typeof product !== 'object' || !product) return 'Produit';
  return [product.name, product.reference].filter(Boolean).join(' - ') || 'Produit';
}

function buildPrintableHtml(sale: Sale): string {
  const title = `${saleTypeLabels[sale.saleType]} ${sale.invoiceNumber || ''}`.trim();
  const rows = sale.items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(productLabel(item.productId))}</td>
          <td class="num">${item.quantity}</td>
          <td class="num">${money(item.unitPrice)}</td>
          <td class="num">${money(item.total)}</td>
        </tr>
      `,
    )
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; margin: 32px; color: #0f172a; }
    header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
    h1 { margin: 0; font-size: 24px; }
    .muted { color: #64748b; font-size: 12px; }
    .box { margin-top: 18px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 10px; text-align: left; font-size: 13px; }
    th { background: #f8fafc; text-transform: uppercase; font-size: 11px; color: #475569; }
    .num { text-align: right; }
    .totals { margin-left: auto; margin-top: 18px; width: 280px; }
    .totals div { display: flex; justify-content: space-between; padding: 7px 0; }
    .grand { border-top: 2px solid #0f172a; font-weight: 800; font-size: 18px; }
    @media print { body { margin: 18mm; } }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="muted">ASEL Mobile</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="muted">${escapeHtml(dateTime(sale.createdAt))}</div>
    </div>
    <div>
      <div><strong>Franchise:</strong> ${escapeHtml(franchiseName(sale.franchiseId))}</div>
      ${franchiseTaxId(sale.franchiseId) ? `<div><strong>Matricule fiscale:</strong> ${escapeHtml(franchiseTaxId(sale.franchiseId))}</div>` : ''}
      <div><strong>Client:</strong> ${escapeHtml(clientName(sale.clientId))}</div>
      <div><strong>Paiement:</strong> ${escapeHtml(paymentMethodLabels[sale.paymentMethod])}</div>
      ${sale.cancelledAt ? `<div><strong>Statut:</strong> Annulee le ${escapeHtml(dateTime(sale.cancelledAt))}</div>` : ''}
    </div>
  </header>
  <table>
    <thead><tr><th>Produit</th><th class="num">Qte</th><th class="num">PU</th><th class="num">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <section class="totals">
    <div><span>Sous-total</span><strong>${money(sale.subtotal)}</strong></div>
    <div><span>Remise</span><strong>${money(sale.discount)}</strong></div>
    <div class="grand"><span>Total</span><strong>${money(sale.total)}</strong></div>
  </section>
  ${sale.note ? `<div class="box"><strong>Note:</strong> ${escapeHtml(sale.note)}</div>` : ''}
  <script>window.print();</script>
</body>
</html>`;
}

export function SaleDocumentModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const sale = useQuery({
    queryKey: ['sale-document', saleId],
    queryFn: async () => (await api.get<{ sale: Sale }>(`/sales/${saleId}`)).data.sale,
  });

  const documentTitle = useMemo(() => {
    if (!sale.data) return 'Piece client';
    return `${saleTypeLabels[sale.data.saleType]} ${sale.data.invoiceNumber || ''}`.trim();
  }, [sale.data]);

  const print = () => {
    if (!sale.data) return;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    win.document.open();
    win.document.write(buildPrintableHtml(sale.data));
    win.document.close();
  };

  return (
    <Modal
      open
      size="lg"
      title={documentTitle}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>Fermer</button>
          <button className="btn-primary" onClick={print} disabled={!sale.data}>
            <Printer className="h-4 w-4" />
            Imprimer
          </button>
        </div>
      }
    >
      {sale.isLoading || !sale.data ? (
        <div className="text-sm text-slate-500">Chargement...</div>
      ) : (
        <div className="space-y-4">
          {sale.data.cancelledAt && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              Vente annulee le {dateTime(sale.data.cancelledAt)}
              {sale.data.cancelReason ? ` - ${sale.data.cancelReason}` : ''}
            </div>
          )}
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Client</div>
              <div className="mt-1 font-semibold text-slate-900">{clientName(sale.data.clientId)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Franchise</div>
              <div className="mt-1 font-semibold text-slate-900">{franchiseName(sale.data.franchiseId)}</div>
              {franchiseTaxId(sale.data.franchiseId) && (
                <div className="mt-1 text-xs text-slate-500">MF: {franchiseTaxId(sale.data.franchiseId)}</div>
              )}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Date</div>
              <div className="mt-1 font-semibold text-slate-900">{dateTime(sale.data.createdAt)}</div>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Paiement</div>
              <div className="mt-1 font-semibold text-slate-900">{paymentMethodLabels[sale.data.paymentMethod]}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Recu</div>
              <div className="mt-1 font-semibold text-slate-900">{sale.data.amountReceived == null ? '-' : money(sale.data.amountReceived)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Reste</div>
              <div className="mt-1 font-semibold text-slate-900">{money(Math.max(0, sale.data.total - (sale.data.amountReceived ?? 0)))}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Articles</div>
              <div className="mt-1 font-semibold text-slate-900">{sale.data.items.reduce((sum, item) => sum + item.quantity, 0)}</div>
            </div>
          </div>

          {sale.data.installmentPlan && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Echeances: avance {money(sale.data.installmentPlan.upfrontAmount)}, reste {money(sale.data.installmentPlan.remainingAmount)}, {sale.data.installmentPlan.generatedLots} lot(s).
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Produit</th>
                  <th className="th text-right">Qte</th>
                  <th className="th text-right">PU</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {sale.data.items.map((item, index) => (
                  <tr key={`${productLabel(item.productId)}-${index}`}>
                    <td className="td">{productLabel(item.productId)}</td>
                    <td className="td text-right">{item.quantity}</td>
                    <td className="td text-right">{money(item.unitPrice)}</td>
                    <td className="td text-right font-medium">{money(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto max-w-sm rounded-lg border border-slate-200 p-4 text-sm">
            <div className="flex justify-between py-1"><span>Sous-total</span><strong>{money(sale.data.subtotal)}</strong></div>
            <div className="flex justify-between py-1"><span>Remise</span><strong>{money(sale.data.discount)}</strong></div>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-3 text-base">
              <span className="font-semibold">Total</span>
              <strong>{money(sale.data.total)}</strong>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
