import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api, apiError, uploadUrl } from '../lib/api';
import { dateTime, money } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useAuth } from '../auth/AuthContext';
import type { CashFlow, Franchise } from '../lib/types';
import { openPrintableReport } from '../lib/report';

type CashFlowSubType = NonNullable<CashFlow['subType']>;

const cashFlowSubTypeLabel: Record<CashFlowSubType, string> = {
  cash_sale: 'Vente caisse',
  central_cashbox: 'Caisse centrale',
  bank_transfer: 'Virement bancaire',
  expense: 'Depense',
  other: 'Autre',
};

const cashFlowStatusLabel: Record<NonNullable<CashFlow['status']>, string> = {
  pending: 'A valider',
  approved: 'Valide',
  rejected: 'Refuse',
};

function flowAuthorId(flow: CashFlow) {
  if (typeof flow.userId === 'object' && flow.userId) return flow.userId.id || flow.userId._id;
  return flow.userId;
}

function canEditFlow(flow: CashFlow, user: ReturnType<typeof useAuth>['user']) {
  if (!user) return false;
  if (['ceo', 'admin', 'superadmin', 'manager', 'cash_central_maintainer'].includes(user.role)) return true;
  const createdAt = flow.createdAt ? new Date(flow.createdAt).getTime() : 0;
  const within24Hours = createdAt > 0 && Date.now() - createdAt <= 24 * 60 * 60 * 1000;
  return within24Hours && flowAuthorId(flow) === (user.id || user._id);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function flowFranchiseName(flow: CashFlow) {
  const franchiseName = typeof flow.franchiseId === 'object' && flow.franchiseId ? flow.franchiseId.name : '-';
  return flow.isCentralCashbox ? `Caisse centrale / ${franchiseName}` : franchiseName;
}

function flowAuthorName(flow: CashFlow) {
  return typeof flow.userId === 'object' && flow.userId ? flow.userId.fullName || flow.userId.username : '-';
}

function generateTreasuryReport({
  flows,
  title,
  filters,
  generatedBy,
}: {
  flows: CashFlow[];
  title: string;
  filters: Array<[string, string]>;
  generatedBy?: string;
}) {
  const encaissements = flows.filter((flow) => flow.type === 'encaissement').reduce((sum, flow) => sum + flow.amount, 0);
  const decaissements = flows.filter((flow) => flow.type === 'decaissement').reduce((sum, flow) => sum + flow.amount, 0);
  const approved = flows.filter((flow) => (flow.status ?? 'approved') === 'approved').length;
  const pending = flows.filter((flow) => flow.status === 'pending').length;
  const rejected = flows.filter((flow) => flow.status === 'rejected').length;
  const rows = flows.map((flow) => {
    const attachment = flow.attachmentPath ? `<a href="${escapeHtml(uploadUrl(flow.attachmentPath))}">Piece jointe</a>` : '-';
    const receipt = flow.receiptPath ? `<a href="${escapeHtml(uploadUrl(flow.receiptPath))}">${escapeHtml(flow.receiptNumber || 'Recu')}</a>` : '-';
    return `
      <tr>
        <td>${escapeHtml(dateTime(flow.date))}</td>
        <td>${escapeHtml(flowFranchiseName(flow))}</td>
        <td>${escapeHtml(flow.type)}</td>
        <td>${escapeHtml(cashFlowSubTypeLabel[flow.subType ?? 'other'])}</td>
        <td>${escapeHtml(cashFlowStatusLabel[flow.status ?? 'approved'])}</td>
        <td>${escapeHtml(flow.reason)}</td>
        <td>${escapeHtml(flow.reference || '-')}</td>
        <td class="amount ${flow.type === 'encaissement' ? 'in' : 'out'}">${escapeHtml(money(flow.amount))}</td>
        <td>${escapeHtml(flowAuthorName(flow))}</td>
        <td>${attachment}</td>
        <td>${receipt}</td>
      </tr>
    `;
  }).join('');

  const filterRows = filters.map(([label, value]) => `
    <div class="filter"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Tous')}</strong></div>
  `).join('');

  return openPrintableReport(`
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; padding: 28px; color: #0f172a; font-family: Inter, Arial, sans-serif; background: #f8fafc; }
          header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
          h1 { margin: 0; font-size: 26px; letter-spacing: 0; }
          .muted { color: #64748b; font-size: 12px; }
          .panel { border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; padding: 16px; margin-bottom: 16px; }
          .filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
          .filter { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; min-width: 0; }
          .filter span { display: block; color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; }
          .filter strong { display: block; margin-top: 4px; overflow-wrap: anywhere; }
          .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
          .metric { border-radius: 10px; background: #f8fafc; padding: 12px; border: 1px solid #e2e8f0; }
          .metric span { display: block; color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; }
          .metric strong { display: block; margin-top: 5px; font-size: 18px; }
          table { width: 100%; border-collapse: collapse; background: #fff; font-size: 12px; }
          th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
          th { background: #f1f5f9; color: #475569; font-size: 10px; text-transform: uppercase; }
          .amount { text-align: right; font-weight: 800; white-space: nowrap; }
          .in { color: #047857; }
          .out { color: #be123c; }
          a { color: #0f766e; font-weight: 700; text-decoration: none; }
          @media print {
            body { background: #fff; padding: 0; }
            .no-print { display: none; }
            .panel { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <header>
          <div>
            <h1>${escapeHtml(title)}</h1>
            <div class="muted">Genere le ${escapeHtml(new Date().toLocaleString('fr-TN'))}${generatedBy ? ` par ${escapeHtml(generatedBy)}` : ''}</div>
          </div>
          <button class="no-print" onclick="window.print()">Imprimer / PDF</button>
        </header>
        <section class="panel filters">${filterRows}</section>
        <section class="panel metrics">
          <div class="metric"><span>Mouvements</span><strong>${flows.length}</strong></div>
          <div class="metric"><span>Encaissements</span><strong class="in">${escapeHtml(money(encaissements))}</strong></div>
          <div class="metric"><span>Decaissements</span><strong class="out">${escapeHtml(money(decaissements))}</strong></div>
          <div class="metric"><span>Net</span><strong>${escapeHtml(money(encaissements - decaissements))}</strong></div>
          <div class="metric"><span>Statuts</span><strong>${approved} V / ${pending} A / ${rejected} R</strong></div>
        </section>
        <section class="panel">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Franchise</th>
                <th>Type</th>
                <th>Detail</th>
                <th>Statut</th>
                <th>Motif</th>
                <th>Reference</th>
                <th>Montant</th>
                <th>Saisi par</th>
                <th>Piece</th>
                <th>Recu</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="11">Aucun mouvement pour ces filtres.</td></tr>'}</tbody>
          </table>
        </section>
      </body>
    </html>
  `);
}

export function CashFlowsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isGlobal =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    user?.role === 'superadmin' ||
    user?.role === 'cash_central_maintainer';
  const canReviewCentral =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'cash_central_maintainer';
  const [franchiseId, setFranchiseId] = useState(isGlobal ? '' : user?.franchiseId ?? '');
  const [typeFilter, setTypeFilter] = useState<'' | 'encaissement' | 'decaissement'>('');
  const [subTypeFilter, setSubTypeFilter] = useState<'' | CashFlowSubType>('');
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'franchise' | 'central'>('all');
  const [statusFilter, setStatusFilter] = useState<'' | NonNullable<CashFlow['status']>>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openCreate, setOpenCreate] = useState(false);
  const [editingFlow, setEditingFlow] = useState<CashFlow | null>(null);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const flows = useQuery({
    queryKey: ['cashflows', franchiseId, typeFilter, subTypeFilter, ledgerFilter, statusFilter, from, to],
    queryFn: async () =>
      (
        await api.get<{ flows: CashFlow[] }>('/cashflows', {
          params: {
            franchiseId: franchiseId || undefined,
            type: typeFilter || undefined,
            subType: subTypeFilter || undefined,
            ledger: ledgerFilter === 'all' ? undefined : ledgerFilter,
            status: statusFilter || undefined,
            from: from || undefined,
            to: to || undefined,
          },
        })
      ).data.flows,
  });

  const totals = useMemo(() => {
    const all = flows.data ?? [];
    const encaissements = all
      .filter((flow) => flow.type === 'encaissement')
      .reduce((sum, flow) => sum + flow.amount, 0);
    const decaissements = all
      .filter((flow) => flow.type === 'decaissement')
      .reduce((sum, flow) => sum + flow.amount, 0);
    return {
      encaissements,
      decaissements,
      net: encaissements - decaissements,
      centralNet: all
        .filter((flow) => flow.isCentralCashbox)
        .reduce((sum, flow) => sum + (flow.type === 'encaissement' ? flow.amount : -flow.amount), 0),
    };
  }, [flows.data]);

  const selectedFranchiseLabel = useMemo(() => {
    if (!isGlobal) return 'Franchise courante';
    if (!franchiseId) return 'Toutes franchises + caisse centrale';
    return franchises.data?.find((franchise) => franchise._id === franchiseId)?.name ?? 'Franchise selectionnee';
  }, [franchiseId, franchises.data, isGlobal]);

  const reportFilters = useMemo<Array<[string, string]>>(
    () => [
      ['Perimetre', selectedFranchiseLabel],
      ['Ledger', ledgerFilter === 'all' ? 'Tous' : ledgerFilter === 'central' ? 'Caisse centrale' : 'Franchise'],
      ['Type', typeFilter || 'Tous'],
      ['Detail', subTypeFilter ? cashFlowSubTypeLabel[subTypeFilter] : 'Tous'],
      ['Statut', statusFilter ? cashFlowStatusLabel[statusFilter] : 'Tous'],
      ['Du', from || 'Debut'],
      ['Au', to || 'Fin'],
    ],
    [from, ledgerFilter, selectedFranchiseLabel, statusFilter, subTypeFilter, to, typeFilter],
  );

  const openReport = (reportFlows: CashFlow[], title: string, extraFilters: Array<[string, string]> = []) => {
    const opened = generateTreasuryReport({
      flows: reportFlows,
      title,
      filters: [...reportFilters, ...extraFilters],
      generatedBy: user?.fullName || user?.username,
    });
    if (!opened) window.alert('Le navigateur a bloque la fenetre du rapport. Autorisez les popups pour generer le rapport.');
  };

  const reviewCentral = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => {
      await api.patch(`/cashflows/${id}/status`, { status });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cashflows'] }),
  });
  const deleteFlow = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/cashflows/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cashflows'] }),
  });

  const hasFilters = Boolean(typeFilter || subTypeFilter || ledgerFilter !== 'all' || statusFilter || from || to || (isGlobal && franchiseId));
  const resetFilters = () => {
    setFranchiseId(isGlobal ? '' : user?.franchiseId ?? '');
    setTypeFilter('');
    setSubTypeFilter('');
    setLedgerFilter('all');
    setStatusFilter('');
    setFrom('');
    setTo('');
  };

  return (
    <>
      <PageHeader
        title="Tresorerie"
        subtitle="Cashflow tracking with support document upload (invoice, receipt, PDF)"
        actions={
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => openReport(flows.data ?? [], 'Rapport tresorerie filtre')}>
              <FileText className="h-4 w-4" />
              Generer rapport
            </button>
            <button className="btn-primary" onClick={() => setOpenCreate(true)}>
              <Plus className="h-4 w-4" />
              Nouveau mouvement
            </button>
          </div>
        }
      />

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Encaissements</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-700">{money(totals.encaissements)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Decaissements</div>
          <div className="mt-2 text-2xl font-semibold text-rose-700">{money(totals.decaissements)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Net</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{money(totals.net)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Solde caisse centrale</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{money(totals.centralNet)}</div>
        </div>
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[210px_170px_170px_190px_170px_170px_170px_auto]">
          {isGlobal ? (
            <select className="input" value={franchiseId} onChange={(event) => setFranchiseId(event.target.value)}>
              <option value="">Toutes franchises</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>
                  {franchise.name}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" disabled value="Franchise courante" />
          )}
          <select
            className="input"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as '' | 'encaissement' | 'decaissement')}
          >
            <option value="">Tous types</option>
            <option value="encaissement">Encaissement</option>
            <option value="decaissement">Decaissement</option>
          </select>
          <select
            className="input"
            value={ledgerFilter}
            onChange={(event) => setLedgerFilter(event.target.value as 'all' | 'franchise' | 'central')}
          >
            <option value="all">Ledger: tous</option>
            <option value="franchise">Franchises</option>
            <option value="central">Caisse centrale</option>
          </select>
          <select
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as '' | NonNullable<CashFlow['status']>)}
          >
            <option value="">Tous statuts</option>
            {(Object.keys(cashFlowStatusLabel) as NonNullable<CashFlow['status']>[]).map((status) => (
              <option key={status} value={status}>{cashFlowStatusLabel[status]}</option>
            ))}
          </select>
          <select
            className="input"
            value={subTypeFilter}
            onChange={(event) => setSubTypeFilter(event.target.value as '' | CashFlowSubType)}
          >
            <option value="">Tous details</option>
            {(Object.keys(cashFlowSubTypeLabel) as CashFlowSubType[]).map((subType) => (
              <option key={subType} value={subType}>{cashFlowSubTypeLabel[subType]}</option>
            ))}
          </select>
          <input type="date" className="input" value={from} onChange={(event) => setFrom(event.target.value)} />
          <input type="date" className="input" value={to} onChange={(event) => setTo(event.target.value)} />
          <button type="button" className="btn-secondary xl:whitespace-nowrap" disabled={!hasFilters} onClick={resetFilters}>
            <RotateCcw className="h-4 w-4" />
            Effacer
          </button>
        </div>
      </section>

      <section className="mb-5 grid gap-3 lg:hidden">
        {(flows.data ?? []).map((flow) => {
          const franchiseName = flowFranchiseName(flow);
          const author =
            typeof flow.userId === 'object' && flow.userId ? flow.userId.fullName || flow.userId.username : '-';

          return (
            <article key={flow._id} className="mobile-record-card space-y-3 overflow-hidden">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="break-words font-semibold text-surface-900">{flow.reason}</div>
                  <div className="mt-1 text-xs text-surface-500">{dateTime(flow.date)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                  {flow.type === 'encaissement' ? (
                    <span className="badge-success">encaissement</span>
                  ) : (
                    <span className="badge-danger">decaissement</span>
                  )}
                  <span className="badge-muted">{cashFlowSubTypeLabel[flow.subType ?? 'other']}</span>
                  <span className={flow.status === 'pending' ? 'badge-warning' : flow.status === 'rejected' ? 'badge-danger' : 'badge-success'}>
                    {cashFlowStatusLabel[flow.status ?? 'approved']}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="min-w-0">
                  <div className="mobile-record-label">Franchise</div>
                  <div className="mt-1 break-words font-medium text-surface-800">{franchiseName}</div>
                </div>
                <div className="min-w-0 text-right">
                  <div className="mobile-record-label">Montant</div>
                  <div className={flow.type === 'encaissement' ? 'mt-1 break-words font-semibold text-emerald-700' : 'mt-1 break-words font-semibold text-rose-700'}>
                    {money(flow.amount)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="mobile-record-label">Reference</div>
                  <div className="mt-1 break-words font-medium text-surface-800">{flow.reference || '-'}</div>
                </div>
                <div className="min-w-0 text-right">
                  <div className="mobile-record-label">Saisi par</div>
                  <div className="mt-1 break-words font-medium text-surface-800">{author}</div>
                </div>
              </div>
              {flow.attachmentPath && (
                <a
                  className="btn-secondary w-full"
                  href={uploadUrl(flow.attachmentPath)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                  Ouvrir piece jointe
                </a>
              )}
              {flow.receiptPath && (
                <a
                  className="btn-secondary w-full"
                  href={uploadUrl(flow.receiptPath)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                  Recu {flow.receiptNumber || 'tresorerie'}
                </a>
              )}
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => openReport([flow], 'Rapport mouvement tresorerie', [['Mouvement', flow.receiptNumber || flow.reference || flow._id]])}
              >
                <FileText className="h-4 w-4" />
                Rapport mouvement
              </button>
              {canEditFlow(flow, user) && (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn-secondary w-full" onClick={() => setEditingFlow(flow)}>
                    <Pencil className="h-4 w-4" />
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="btn-danger w-full"
                    disabled={deleteFlow.isPending}
                    onClick={() => {
                      if (window.confirm('Supprimer ce mouvement de tresorerie ?')) deleteFlow.mutate(flow._id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Supprimer
                  </button>
                </div>
              )}
              {canReviewCentral && !flow.isCentralCashbox && flow.subType === 'central_cashbox' && flow.status === 'pending' && (
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-secondary" disabled={reviewCentral.isPending} onClick={() => reviewCentral.mutate({ id: flow._id, status: 'rejected' })}>
                    Refuser
                  </button>
                  <button className="btn-primary" disabled={reviewCentral.isPending} onClick={() => reviewCentral.mutate({ id: flow._id, status: 'approved' })}>
                    Accepter caisse centrale
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {!flows.isLoading && (flows.data?.length ?? 0) === 0 && (
          <div className="mobile-record-card text-sm text-surface-500">Aucun mouvement.</div>
        )}
      </section>

      <section className="card hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Franchise</th>
              <th className="th">Type</th>
              <th className="th">Detail</th>
              <th className="th">Statut</th>
              <th className="th">Motif</th>
              <th className="th">Reference</th>
              <th className="th text-right">Montant</th>
              <th className="th">Piece jointe</th>
              <th className="th">Recu</th>
              <th className="th">Saisi par</th>
              <th className="th-action">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(flows.data ?? []).map((flow) => (
              <tr key={flow._id}>
                <td className="td">{dateTime(flow.date)}</td>
                <td className="td">
                  {flowFranchiseName(flow)}
                </td>
                <td className="td">
                  {flow.type === 'encaissement' ? (
                    <span className="badge-success">encaissement</span>
                  ) : (
                    <span className="badge-danger">decaissement</span>
                  )}
                </td>
                <td className="td">
                  <span className="badge-muted">{cashFlowSubTypeLabel[flow.subType ?? 'other']}</span>
                </td>
                <td className="td">
                  <span className={flow.status === 'pending' ? 'badge-warning' : flow.status === 'rejected' ? 'badge-danger' : 'badge-success'}>
                    {cashFlowStatusLabel[flow.status ?? 'approved']}
                  </span>
                </td>
                <td className="td">{flow.reason}</td>
                <td className="td">{flow.reference || '-'}</td>
                <td className="td text-right font-semibold">{money(flow.amount)}</td>
                <td className="td">
                  {flow.attachmentPath ? (
                    <a className="inline-flex items-center gap-1.5 text-brand-600 hover:underline" href={uploadUrl(flow.attachmentPath)} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ouvrir
                    </a>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="td">
                  {flow.receiptPath ? (
                    <a className="inline-flex items-center gap-1.5 text-brand-600 hover:underline" href={uploadUrl(flow.receiptPath)} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                      {flow.receiptNumber || 'Recu'}
                    </a>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="td">
                  {typeof flow.userId === 'object' && flow.userId ? flow.userId.fullName || flow.userId.username : '-'}
                </td>
                <td className="td-action">
                  <div className="flex justify-end gap-2">
                    <button
                      className="btn-secondary !min-h-[34px] !px-3 !py-1"
                      onClick={() => openReport([flow], 'Rapport mouvement tresorerie', [['Mouvement', flow.receiptNumber || flow.reference || flow._id]])}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Rapport
                    </button>
                      {canEditFlow(flow, user) && (
                        <button className="btn-secondary !min-h-[34px] !px-3 !py-1" onClick={() => setEditingFlow(flow)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                      )}
                      {canEditFlow(flow, user) && (
                        <button
                          className="btn-danger !min-h-[34px] !px-3 !py-1"
                          disabled={deleteFlow.isPending}
                          onClick={() => {
                            if (window.confirm('Supprimer ce mouvement de tresorerie ?')) deleteFlow.mutate(flow._id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      )}
                      {canReviewCentral && !flow.isCentralCashbox && flow.subType === 'central_cashbox' && flow.status === 'pending' && (
                        <>
                          <button className="btn-secondary !min-h-[34px] !px-3 !py-1" disabled={reviewCentral.isPending} onClick={() => reviewCentral.mutate({ id: flow._id, status: 'rejected' })}>
                            Refuser
                          </button>
                          <button className="btn-primary !min-h-[34px] !px-3 !py-1" disabled={reviewCentral.isPending} onClick={() => reviewCentral.mutate({ id: flow._id, status: 'approved' })}>
                            Accepter
                          </button>
                        </>
                      )}
                  </div>
                </td>
              </tr>
            ))}
            {!flows.isLoading && (flows.data?.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={12}>
                  Aucun mouvement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {reviewCentral.isError && (
          <div className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {apiError(reviewCentral.error).message}
          </div>
        )}
      </section>

      {openCreate && (
        <CashFlowCreateModal
          defaultFranchiseId={franchiseId || user?.franchiseId || ''}
          allowFranchiseSelect={isGlobal}
          allowCentralEntry={canReviewCentral}
          franchises={franchises.data ?? []}
          onClose={() => setOpenCreate(false)}
          onSaved={() => {
            setOpenCreate(false);
            queryClient.invalidateQueries({ queryKey: ['cashflows'] });
          }}
        />
      )}
      {editingFlow && (
        <CashFlowEditModal
          flow={editingFlow}
          allowFranchiseSelect={isGlobal}
          allowCentralEntry={canReviewCentral}
          franchises={franchises.data ?? []}
          onClose={() => setEditingFlow(null)}
          onSaved={() => {
            setEditingFlow(null);
            queryClient.invalidateQueries({ queryKey: ['cashflows'] });
          }}
        />
      )}
    </>
  );
}

function CashFlowCreateModal({
  defaultFranchiseId,
  allowFranchiseSelect,
  allowCentralEntry,
  franchises,
  onClose,
  onSaved,
}: {
  defaultFranchiseId: string;
  allowFranchiseSelect: boolean;
  allowCentralEntry: boolean;
  franchises: Franchise[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [franchiseId, setFranchiseId] = useState(defaultFranchiseId);
  const [type, setType] = useState<'encaissement' | 'decaissement'>('encaissement');
  const [subType, setSubType] = useState<CashFlowSubType>('cash_sale');
  const [isCentralCashbox, setIsCentralCashbox] = useState(false);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error('Motif requis');
      if (!franchiseId) throw new Error('Franchise requise');
      if (amount <= 0) throw new Error('Montant invalide');

      const formData = new FormData();
      if (franchiseId) formData.append('franchiseId', franchiseId);
      formData.append('type', type);
      formData.append('subType', subType);
      formData.append('isCentralCashbox', String(isCentralCashbox));
      formData.append('amount', String(amount));
      formData.append('reason', reason.trim());
      formData.append('reference', reference.trim());
      if (date) formData.append('date', date);
      if (attachment) formData.append('attachment', attachment);

      await api.post('/cashflows', formData);
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title="Nouveau mouvement tresorerie"
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {allowFranchiseSelect && (
          <div>
            <label className="label">Franchise</label>
            <select className="input" value={franchiseId} onChange={(event) => setFranchiseId(event.target.value)}>
              <option value="">Selectionner</option>
              {franchises.map((franchise) => (
                <option key={franchise._id} value={franchise._id}>
                  {franchise.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {allowCentralEntry && (
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={isCentralCashbox}
              onChange={(event) => {
                const checked = event.target.checked;
                setIsCentralCashbox(checked);
                if (checked) setSubType('central_cashbox');
                else setSubType(type === 'encaissement' ? 'cash_sale' : 'expense');
              }}
            />
            <span>
              <span className="block font-semibold text-slate-900">Saisie dans la caisse centrale</span>
              <span className="block text-xs text-slate-500">La franchise selectionnee devient la contrepartie du mouvement.</span>
            </span>
          </label>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={type}
              onChange={(event) => {
                const nextType = event.target.value as 'encaissement' | 'decaissement';
                setType(nextType);
                setSubType(isCentralCashbox ? 'central_cashbox' : nextType === 'encaissement' ? 'cash_sale' : 'expense');
              }}
            >
              <option value="encaissement">Encaissement</option>
              <option value="decaissement">Decaissement</option>
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Detail mouvement</label>
          <select className="input" value={subType} onChange={(event) => setSubType(event.target.value as CashFlowSubType)}>
            {(isCentralCashbox
              ? (['central_cashbox'] as CashFlowSubType[])
              : type === 'encaissement'
              ? (['cash_sale', 'central_cashbox', 'other'] as CashFlowSubType[])
              : (['central_cashbox', 'bank_transfer', 'expense', 'other'] as CashFlowSubType[])
            ).map((item) => (
              <option key={item} value={item}>{cashFlowSubTypeLabel[item]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Montant</label>
          <input
            type="number"
            min={0.01}
            step="0.01"
            inputMode="decimal"
            className="input"
            value={amount}
            onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))}
          />
        </div>

        <div>
          <label className="label">Motif</label>
          <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>

        <div>
          <label className="label">Reference</label>
          <input className="input" value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>

        <div>
          <label className="label">Facture ou justificatif (image/pdf)</label>
          <input
            type="file"
            className="input"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
          />
          {attachment && <p className="mt-1 text-xs text-slate-500">{attachment.name}</p>}
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function CashFlowEditModal({
  flow,
  allowFranchiseSelect,
  allowCentralEntry,
  franchises,
  onClose,
  onSaved,
}: {
  flow: CashFlow;
  allowFranchiseSelect: boolean;
  allowCentralEntry: boolean;
  franchises: Franchise[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [franchiseId, setFranchiseId] = useState(
    typeof flow.franchiseId === 'object' && flow.franchiseId ? flow.franchiseId._id : String(flow.franchiseId || ''),
  );
  const [type, setType] = useState<'encaissement' | 'decaissement'>(flow.type);
  const [subType, setSubType] = useState<CashFlowSubType>(flow.subType ?? (flow.type === 'encaissement' ? 'cash_sale' : 'expense'));
  const [isCentralCashbox, setIsCentralCashbox] = useState(Boolean(flow.isCentralCashbox));
  const [amount, setAmount] = useState(flow.amount);
  const [reason, setReason] = useState(flow.reason);
  const [reference, setReference] = useState(flow.reference ?? '');
  const [date, setDate] = useState(new Date(flow.date).toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error('Motif requis');
      if (amount <= 0) throw new Error('Montant invalide');
      await api.patch(`/cashflows/${flow._id}`, {
        ...(franchiseId ? { franchiseId } : {}),
        type,
        subType,
        isCentralCashbox,
        amount,
        reason: reason.trim(),
        reference: reference.trim(),
        date,
      });
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title="Modifier mouvement tresorerie"
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={() => update.mutate()} disabled={update.isPending}>
            {update.isPending ? 'Mise a jour...' : 'Enregistrer correction'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Modifiable par l'auteur pendant 24h. Apres 24h, seul un role superieur peut corriger.
        </div>

        {allowFranchiseSelect && (
          <div>
            <label className="label">Franchise</label>
            <select className="input" value={franchiseId} onChange={(event) => setFranchiseId(event.target.value)}>
              <option value="">Selectionner</option>
              {franchises.map((franchise) => (
                <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
              ))}
            </select>
          </div>
        )}

        {allowCentralEntry && (
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={isCentralCashbox}
              onChange={(event) => {
                const checked = event.target.checked;
                setIsCentralCashbox(checked);
                if (checked) setSubType('central_cashbox');
                else setSubType(type === 'encaissement' ? 'cash_sale' : 'expense');
              }}
            />
            <span>
              <span className="block font-semibold text-slate-900">Mouvement caisse centrale</span>
              <span className="block text-xs text-slate-500">Garde la contrepartie franchise synchronisee.</span>
            </span>
          </label>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={type}
              onChange={(event) => {
                const nextType = event.target.value as 'encaissement' | 'decaissement';
                setType(nextType);
                setSubType(isCentralCashbox ? 'central_cashbox' : nextType === 'encaissement' ? 'cash_sale' : 'expense');
              }}
            >
              <option value="encaissement">Encaissement</option>
              <option value="decaissement">Decaissement</option>
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Detail mouvement</label>
          <select className="input" value={subType} onChange={(event) => setSubType(event.target.value as CashFlowSubType)}>
            {(isCentralCashbox
              ? (['central_cashbox'] as CashFlowSubType[])
              : type === 'encaissement'
              ? (['cash_sale', 'central_cashbox', 'other'] as CashFlowSubType[])
              : (['central_cashbox', 'bank_transfer', 'expense', 'other'] as CashFlowSubType[])
            ).map((item) => (
              <option key={item} value={item}>{cashFlowSubTypeLabel[item]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Montant</label>
          <input
            type="number"
            min={0.01}
            step="0.01"
            inputMode="decimal"
            className="input"
            value={amount}
            onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))}
          />
        </div>

        <div>
          <label className="label">Motif</label>
          <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>

        <div>
          <label className="label">Reference</label>
          <input className="input" value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
