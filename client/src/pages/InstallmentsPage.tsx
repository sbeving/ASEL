import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, apiError, uploadUrl } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { ContactActions } from '../components/ContactActions';
import { Modal } from '../components/Modal';
import { TablePagination } from '../components/TablePagination';
import { dateOnly, dateTime, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import type { Client, Franchise, Installment, PageMeta, Sale } from '../lib/types';

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function statusBadge(status: Installment['status']) {
  if (status === 'paid') return 'badge-success';
  if (status === 'late') return 'badge-danger';
  return 'badge-warning';
}

function installmentLabel(installment: Installment): string {
  if (typeof installment.saleId === 'object' && installment.saleId) {
    return installment.saleId.invoiceNumber || dateTime(installment.saleId.createdAt);
  }
  return 'votre vente';
}

function installmentReminderMessage(installment: Installment): string {
  const clientName =
    typeof installment.clientId === 'object' && installment.clientId?.fullName
      ? installment.clientId.fullName
      : 'cher client';
  const sale = installmentLabel(installment);

  if (installment.status === 'paid') {
    return `Bonjour ${clientName}, ASEL Mobile Tunisie vous remercie pour votre paiement de ${money(installment.paidAmount || installment.amount)} pour ${sale}. Merci pour votre confiance.`;
  }

  const dueDate = new Date(installment.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);
  const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  if (installment.status === 'pending' && daysUntilDue >= 1 && daysUntilDue <= 3) {
    return `Bonjour ${clientName}, rappel ASEL Mobile Tunisie : votre échéance de ${money(installment.amount)} pour ${sale} est à régler le ${dateOnly(installment.dueDate)}. Merci de préparer votre paiement.`;
  }

  const dueText = installment.status === 'late' ? 'est en retard depuis le' : 'est prévue le';

  return `Bonjour ${clientName}, rappel ASEL Mobile Tunisie : votre échéance de ${money(installment.amount)} pour ${sale} ${dueText} ${dateOnly(installment.dueDate)}. Merci de nous contacter ou de passer au règlement.`;
}

type InstallmentStatusFilter = '' | 'pending' | 'paid' | 'late';

function readStatusParam(value: string | null): InstallmentStatusFilter {
  return value === 'pending' || value === 'paid' || value === 'late' ? value : '';
}

export function InstallmentsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isGlobal =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    user?.role === 'superadmin' ||
    user?.role === 'cash_central_maintainer';
  const canCreateInstallments =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    user?.role === 'superadmin' ||
    user?.role === 'franchise';
  const defaultFid = isGlobal ? '' : (user?.franchiseId ?? '');

  const qc = useQueryClient();
  const [franchiseId, setFranchiseId] = useState(defaultFid);
  const [statusFilter, setStatusFilter] = useState<InstallmentStatusFilter>(() => readStatusParam(searchParams.get('status')));
  const [fromDate, setFromDate] = useState(searchParams.get('from') ?? '');
  const [toDate, setToDate] = useState(searchParams.get('to') ?? '');
  const [page, setPage] = useState(1);
  const pageSize = 40;
  const [saleId, setSaleId] = useState('');
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState(0);
  const [dueDateLocal, setDueDateLocal] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
  );
  const [paying, setPaying] = useState<Installment | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentDateLocal, setPaymentDateLocal] = useState(toLocalDateTimeInputValue(new Date()));
  const [remainingDueDateLocal, setRemainingDueDateLocal] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 4 * 24 * 60 * 60 * 1000)),
  );
  const [paymentNote, setPaymentNote] = useState('');
  const [rescheduling, setRescheduling] = useState<Installment | null>(null);
  const [rescheduleDueDateLocal, setRescheduleDueDateLocal] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [editingPaymentDate, setEditingPaymentDate] = useState<Installment | null>(null);
  const [editedPaymentDateLocal, setEditedPaymentDateLocal] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setStatusFilter(readStatusParam(searchParams.get('status')));
    setFromDate(searchParams.get('from') ?? '');
    setToDate(searchParams.get('to') ?? '');
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [franchiseId, statusFilter, fromDate, toDate]);

  function updateStatusFilter(value: InstallmentStatusFilter) {
    setStatusFilter(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('status', value);
    else next.delete('status');
    setSearchParams(next, { replace: true });
  }

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const sales = useQuery({
    enabled: canCreateInstallments,
    queryKey: ['sales', franchiseId],
    queryFn: async () =>
      (
        await api.get<{ sales: Sale[] }>('/sales', {
          params: {
            franchiseId: franchiseId || undefined,
            limit: 200,
          },
        })
      ).data.sales,
  });

  const clients = useQuery({
    enabled: canCreateInstallments,
    queryKey: ['clients-for-installments', franchiseId],
    queryFn: async () =>
      (
        await api.get<{ clients: Client[] }>('/clients', {
          params: {
            franchiseId: franchiseId || undefined,
            limit: 200,
          },
        })
      ).data.clients,
  });

  const installments = useQuery({
    queryKey: ['installments', franchiseId, statusFilter, fromDate, toDate, page],
    queryFn: async () =>
      (
        await api.get<{ installments: Installment[]; meta: PageMeta }>('/installments', {
          params: {
            franchiseId: franchiseId || undefined,
            status: statusFilter || undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
            page,
            pageSize,
          },
        })
      ).data,
  });

  const selectedSaleAmount = useMemo(() => {
    const selected = (sales.data ?? []).find((sale) => sale._id === saleId);
    return selected?.total ?? 0;
  }, [saleId, sales.data]);

  const create = useMutation({
    mutationFn: async () => {
      if (!saleId) throw new Error('Vente requise');
      const due = new Date(dueDateLocal);
      if (Number.isNaN(due.getTime())) throw new Error("Date d'échéance invalide");
      await api.post('/installments', {
        saleId,
        clientId: clientId || null,
        amount,
        dueDate: due.toISOString(),
      });
    },
    onSuccess: () => {
      setErr(null);
      setSaleId('');
      setClientId('');
      setAmount(0);
      qc.invalidateQueries({ queryKey: ['installments'] });
    },
    onError: (error) => setErr(error instanceof Error ? error.message : apiError(error).message),
  });

  const pay = useMutation({
    mutationFn: async () => {
      if (!paying) throw new Error('Echeance requise');
      const numericPaymentAmount = Math.max(0, Number(paymentAmount) || 0);
      if (numericPaymentAmount <= 0) throw new Error('Montant paye requis');
      const isPartial = numericPaymentAmount < paying.amount;
      const remainingDueDate = new Date(remainingDueDateLocal);
      if (isPartial && Number.isNaN(remainingDueDate.getTime())) {
        throw new Error('Date du reste invalide');
      }
      const paidAt = new Date(paymentDateLocal);
      if (Number.isNaN(paidAt.getTime())) throw new Error("Date d'encaissement invalide");
      await api.post(`/installments/${paying._id}/pay`, {
        paymentMethod,
        amount: numericPaymentAmount,
        paidAt: paidAt.toISOString(),
        remainingDueDate: isPartial ? remainingDueDate.toISOString() : undefined,
        note: paymentNote || undefined,
      });
    },
    onSuccess: () => {
      setPaying(null);
      setPaymentAmount('');
      setPaymentMethod('cash');
      setPaymentDateLocal(toLocalDateTimeInputValue(new Date()));
      setPaymentNote('');
      qc.invalidateQueries({ queryKey: ['installments'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error) => setErr(error instanceof Error ? error.message : apiError(error).message),
  });

  const updateInstallment = useMutation({
    mutationFn: async (payload: { id: string; dueDate?: string; paidAt?: string; note?: string; reason?: string }) => {
      await api.patch(`/installments/${payload.id}`, payload);
    },
    onSuccess: () => {
      setErr(null);
      setRescheduling(null);
      setEditingPaymentDate(null);
      setRescheduleReason('');
      qc.invalidateQueries({ queryKey: ['installments'] });
    },
    onError: (error) => setErr(error instanceof Error ? error.message : apiError(error).message),
  });

  function openPaymentModal(installment: Installment) {
    setPaying(installment);
    setPaymentAmount(String(installment.amount));
    setPaymentDateLocal(toLocalDateTimeInputValue(new Date()));
    setRemainingDueDateLocal(toLocalDateTimeInputValue(new Date(Date.now() + 4 * 24 * 60 * 60 * 1000)));
    setPaymentMethod('cash');
    setPaymentNote('');
    setErr(null);
  }

  function openRescheduleModal(installment: Installment) {
    setRescheduling(installment);
    setRescheduleDueDateLocal(toLocalDateTimeInputValue(new Date(installment.dueDate)));
    setRescheduleReason('');
    setErr(null);
  }

  function openPaymentDateModal(installment: Installment) {
    setEditingPaymentDate(installment);
    setEditedPaymentDateLocal(toLocalDateTimeInputValue(new Date(installment.paidAt || new Date())));
    setErr(null);
  }

  return (
    <>
      <PageHeader title="Échéances" subtitle="Suivi des paiements à terme" />

      <section className="card mb-5 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {isGlobal ? (
            <select className="input" value={franchiseId} onChange={(e) => setFranchiseId(e.target.value)}>
              <option value="">Toutes franchises</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
              ))}
            </select>
          ) : (
            <input className="input" disabled value={user?.franchiseId ? 'Franchise courante' : 'Aucune franchise'} />
          )}
          <select className="input" value={statusFilter} onChange={(e) => updateStatusFilter(e.target.value as InstallmentStatusFilter)}>
            <option value="">Tous statuts</option>
            <option value="pending">En attente</option>
            <option value="paid">Payée</option>
            <option value="late">En retard</option>
          </select>
          <input type="date" className="input" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <input type="date" className="input" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          <div className="self-center text-sm text-slate-500">{installments.data?.meta.total ?? 0} échéance(s)</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 !text-xs"
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10);
              setFromDate(today);
              setToDate(today);
            }}
          >
            Aujourd'hui
          </button>
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 !text-xs"
            onClick={() => {
              const now = new Date();
              setFromDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
              setToDate(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10));
            }}
          >
            Ce mois
          </button>
          <button
            type="button"
            className="btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={() => {
              updateStatusFilter('');
              setFromDate('');
              setToDate('');
              setFranchiseId(defaultFid);
            }}
          >
            Effacer filtres
          </button>
        </div>
        <TablePagination meta={installments.data?.meta} onPageChange={setPage} className="px-1 py-3" />
      </section>

      {canCreateInstallments && (
        <section className="card mb-5 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <select className="input" value={saleId} onChange={(e) => setSaleId(e.target.value)}>
              <option value="">— Vente —</option>
              {(sales.data ?? []).map((sale) => (
                <option key={sale._id} value={sale._id}>
                  {(sale.invoiceNumber || dateTime(sale.createdAt))} · {money(sale.total)}
                </option>
              ))}
            </select>
            <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Sans client</option>
              {(clients.data ?? []).map((client) => (
                <option key={client._id} value={client._id}>{client.fullName}</option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            />
            <input type="datetime-local" className="input" value={dueDateLocal} onChange={(e) => setDueDateLocal(e.target.value)} />
            <button className="btn-primary" disabled={!saleId || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Création…' : 'Créer échéance'}
            </button>
          </div>
          {saleId && <div className="mt-2 text-sm text-slate-500">Montant de la vente: {money(selectedSaleAmount)}</div>}
          {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
        </section>
      )}

      <section className="grid gap-3 md:hidden">
        {(installments.data?.installments ?? []).map((installment) => {
          const saleLabel =
            typeof installment.saleId === 'object' && installment.saleId
              ? installment.saleId.invoiceNumber || dateTime(installment.saleId.createdAt)
              : '-';
          const clientLabel =
            typeof installment.clientId === 'object' && installment.clientId
              ? installment.clientId.fullName
              : 'Sans client';
          return (
            <article key={installment._id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{saleLabel}</div>
                  <div className="mt-1 text-sm text-slate-500">{clientLabel}</div>
                </div>
                <span className={statusBadge(installment.status)}>{installment.status}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-400">Montant</div>
                  <div className="font-bold text-slate-900">{money(installment.amount)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-400">Date</div>
                  <div className="font-bold text-slate-900">{dateOnly(installment.dueDate)}</div>
                </div>
              </div>
              {typeof installment.clientId === 'object' && installment.clientId && (
                <ContactActions
                  phone={installment.clientId.phone}
                  phone2={installment.clientId.phone2}
                  message={installmentReminderMessage(installment)}
                  compact
                  className="mt-3"
                />
              )}
              {installment.status !== 'paid' ? (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    className="btn-ghost !px-3 !py-1.5"
                    onClick={() => openRescheduleModal(installment)}
                  >
                    Reporter
                  </button>
                  <button
                    className="btn-secondary !px-3 !py-1.5"
                    onClick={() => openPaymentModal(installment)}
                  >
                    Encaisser
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {installment.receiptPath && (
                    <a className="btn-secondary !px-3 !py-1.5" href={uploadUrl(installment.receiptPath)} target="_blank" rel="noreferrer">
                      {installment.receiptNumber || 'Recu'}
                    </a>
                  )}
                  <button className="btn-ghost !px-3 !py-1.5" onClick={() => openPaymentDateModal(installment)}>
                    Modifier date paiement
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {!installments.isLoading && (installments.data?.installments.length ?? 0) === 0 && (
          <div className="card p-5 text-sm text-slate-400">Aucune echeance.</div>
        )}
      </section>

      <section className="card hidden p-4 md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Pièce</th>
                <th className="th">Échéance</th>
                <th className="th text-right">Montant</th>
                <th className="th">Statut</th>
                <th className="th">Client</th>
                <th className="th">Paiement</th>
                <th className="th-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {(installments.data?.installments ?? []).map((installment) => (
                <tr key={installment._id}>
                  <td className="td-action">
                    {typeof installment.saleId === 'object' && installment.saleId
                      ? installment.saleId.invoiceNumber || dateTime(installment.saleId.createdAt)
                      : '—'}
                  </td>
                  <td className="td">{dateOnly(installment.dueDate)}</td>
                  <td className="td text-right">{money(installment.amount)}</td>
                  <td className="td"><span className={statusBadge(installment.status)}>{installment.status}</span></td>
                  <td className="td">
                    {typeof installment.clientId === 'object' && installment.clientId ? (
                      <div>
                        <div className="font-medium text-slate-900">{installment.clientId.fullName}</div>
                        <div className="text-xs text-slate-500">
                          {installment.clientId.phone || installment.clientId.phone2 || 'Sans numéro'}
                        </div>
                        <ContactActions
                          phone={installment.clientId.phone}
                          phone2={installment.clientId.phone2}
                          message={installmentReminderMessage(installment)}
                          compact
                          className="mt-2"
                        />
                      </div>
                    ) : '—'}
                  </td>
                  <td className="td">
                    <div>{installment.paidAt ? dateOnly(installment.paidAt) : '—'}</div>
                    {installment.receiptPath && (
                      <a className="mt-1 inline-flex text-xs font-semibold text-brand-600 hover:underline" href={uploadUrl(installment.receiptPath)} target="_blank" rel="noreferrer">
                        {installment.receiptNumber || 'Recu'}
                      </a>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap justify-end gap-2">
                      {installment.status !== 'paid' ? (
                        <>
                          <button
                            className="btn-ghost !px-3 !py-1.5"
                            onClick={() => openRescheduleModal(installment)}
                            disabled={updateInstallment.isPending}
                          >
                            Reporter
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => openPaymentModal(installment)}
                            disabled={pay.isPending}
                          >
                            Encaisser
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn-ghost !px-3 !py-1.5"
                          onClick={() => openPaymentDateModal(installment)}
                          disabled={updateInstallment.isPending}
                        >
                          Modifier date
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!installments.isLoading && (installments.data?.installments.length ?? 0) === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={7}>Aucune échéance.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination meta={installments.data?.meta} onPageChange={setPage} className="px-1 py-3" />
      </section>

      {paying && (
        <Modal
          open
          size="md"
          title="Encaisser echeance"
          onClose={() => setPaying(null)}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button className="btn-secondary" onClick={() => setPaying(null)}>Annuler</button>
              <button className="btn-primary" onClick={() => pay.mutate()} disabled={pay.isPending}>
                {pay.isPending ? 'Encaissement...' : 'Valider paiement'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Montant echeance</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">{money(paying.amount)}</div>
              <div className="mt-1 text-sm text-slate-500">
                {typeof paying.clientId === 'object' && paying.clientId ? paying.clientId.fullName : 'Client non renseigne'}
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                Paiement total ou partiel accepte. Si le client paye une partie, le reste devient une nouvelle echeance.
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Montant paye</label>
                <input
                  type="number"
                  min={0}
                  max={paying.amount}
                  step="0.01"
                  className="input"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
              </div>
              <div>
                <label className="label">Mode paiement</label>
                <select className="input" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                  <option value="cash">Especes</option>
                  <option value="card">Carte</option>
                  <option value="transfer">Virement</option>
                  <option value="other">Autre</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Date d'encaissement</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={paymentDateLocal}
                  onChange={(event) => setPaymentDateLocal(event.target.value)}
                />
              </div>
            </div>
            {Math.max(0, Number(paymentAmount) || 0) < paying.amount && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-3 text-sm font-semibold text-amber-900">
                  Reste a planifier: {money(Math.max(0, paying.amount - (Number(paymentAmount) || 0)))}
                </div>
                <label className="label !text-amber-700">Nouvelle date du reste</label>
                <input
                  type="datetime-local"
                  className="input !bg-white"
                  value={remainingDueDateLocal}
                  onChange={(event) => setRemainingDueDateLocal(event.target.value)}
                />
              </div>
            )}
            <div>
              <label className="label">Note paiement</label>
              <textarea className="input min-h-[88px]" value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} />
            </div>
            {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
          </div>
        </Modal>
      )}

      {rescheduling && (
        <Modal
          open
          size="md"
          title="Reporter echeance"
          onClose={() => setRescheduling(null)}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button className="btn-secondary" onClick={() => setRescheduling(null)}>Annuler</button>
              <button
                className="btn-primary"
                disabled={updateInstallment.isPending}
                onClick={() => {
                  const dueDate = new Date(rescheduleDueDateLocal);
                  if (Number.isNaN(dueDate.getTime())) {
                    setErr('Nouvelle date invalide');
                    return;
                  }
                  updateInstallment.mutate({
                    id: rescheduling._id,
                    dueDate: dueDate.toISOString(),
                    reason: rescheduleReason || undefined,
                  });
                }}
              >
                {updateInstallment.isPending ? 'Modification...' : 'Valider report'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Si le client ne peut pas payer a la date prevue, on garde la trace de l'ancienne date et on reporte cette echeance.
            </div>
            <div>
              <label className="label">Nouvelle date d'echeance</label>
              <input
                type="datetime-local"
                className="input"
                value={rescheduleDueDateLocal}
                onChange={(event) => setRescheduleDueDateLocal(event.target.value)}
              />
            </div>
            <div>
              <label className="label">Motif / note</label>
              <textarea
                className="input min-h-[88px]"
                value={rescheduleReason}
                onChange={(event) => setRescheduleReason(event.target.value)}
                placeholder="Client indisponible, salaire reporte, arrangement..."
              />
            </div>
            {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
          </div>
        </Modal>
      )}

      {editingPaymentDate && (
        <Modal
          open
          size="md"
          title="Modifier date d'encaissement"
          onClose={() => setEditingPaymentDate(null)}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button className="btn-secondary" onClick={() => setEditingPaymentDate(null)}>Annuler</button>
              <button
                className="btn-primary"
                disabled={updateInstallment.isPending}
                onClick={() => {
                  const paidAt = new Date(editedPaymentDateLocal);
                  if (Number.isNaN(paidAt.getTime())) {
                    setErr("Date d'encaissement invalide");
                    return;
                  }
                  updateInstallment.mutate({ id: editingPaymentDate._id, paidAt: paidAt.toISOString() });
                }}
              >
                {updateInstallment.isPending ? 'Modification...' : 'Enregistrer'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paiement encaisse</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {money(editingPaymentDate.paidAmount || editingPaymentDate.amount)}
              </div>
            </div>
            <div>
              <label className="label">Date d'encaissement</label>
              <input
                type="datetime-local"
                className="input"
                value={editedPaymentDateLocal}
                onChange={(event) => setEditedPaymentDateLocal(event.target.value)}
              />
            </div>
            {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
          </div>
        </Modal>
      )}
    </>
  );
}
