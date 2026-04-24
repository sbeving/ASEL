import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { ContactActions } from '../components/ContactActions';
import { dateOnly, dateTime, money } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { TablePagination } from '../components/TablePagination';
import { Modal } from '../components/Modal';
import { useDebouncedValue } from '../lib/hooks';
import { useAuth } from '../auth/AuthContext';
import type { Client, ClientOverview, Franchise, PageMeta } from '../lib/types';

const clientSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().min(1, 'Nom requis').max(100),
  phone: z.string().max(40).optional(),
  phone2: z.string().max(40).optional(),
  email: z.string().email('Email invalide').max(160).optional().or(z.literal('')),
  address: z.string().max(300).optional(),
  clientType: z.enum(['walkin', 'boutique', 'wholesale', 'passager', 'other']),
  company: z.string().max(160).optional(),
  taxId: z.string().max(80).optional(),
  cin: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
  franchiseId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

type ClientFormValues = z.infer<typeof clientSchema>;

const clientTypeLabels: Record<NonNullable<Client['clientType']>, string> = {
  walkin: 'Passage',
  boutique: 'Boutique',
  wholesale: 'Grossiste',
  passager: 'Passager',
  other: 'Autre',
};

function buildClientContactMessage(clientName: string): string {
  return `Bonjour ${clientName}, ici ASEL Mobile Tunisie. N'hésitez pas à nous contacter sur WhatsApp, SMS ou appel si vous avez besoin d'assistance.`;
}

export function ClientsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager';
  const canManage = user?.role !== 'viewer';
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 250);
  const [page, setPage] = useState(1);
  const [franchiseFilter, setFranchiseFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | ''>('true');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [archiving, setArchiving] = useState<Client | null>(null);
  const [viewing, setViewing] = useState<Client | null>(null);
  const pageSize = 25;

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const query = useQuery({
    queryKey: ['clients', debouncedQ, page, franchiseFilter, activeFilter],
    queryFn: async () =>
      (
        await api.get<{ clients: Client[]; meta: PageMeta }>('/clients', {
          params: {
            q: debouncedQ || undefined,
            franchiseId: franchiseFilter || undefined,
            active: activeFilter || undefined,
            page,
            pageSize,
          },
        })
      ).data,
  });

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Repertoire client avec achat cumule, solde du et detail relationnel"
        actions={
          canManage ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              + Nouveau client
            </button>
          ) : undefined
        }
      />

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_220px_180px]">
          <input
            className="input"
            placeholder="Nom, telephone, email, entreprise..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          {isGlobal ? (
            <select
              className="input"
              value={franchiseFilter}
              onChange={(e) => {
                setFranchiseFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Toutes franchises</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
              ))}
            </select>
          ) : (
            <input className="input" disabled value="Franchise courante" />
          )}
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

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Client</th>
              <th className="th">Contact</th>
              <th className="th">Type</th>
              <th className="th">Franchise</th>
              <th className="th text-right">Achats</th>
              <th className="th text-right">Solde du</th>
              <th className="th">Statut</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(query.data?.clients ?? []).map((client) => (
              <tr key={client._id}>
                <td className="td">
                  <div className="font-medium text-slate-900">{client.fullName}</div>
                  <div className="text-xs text-slate-500">{client.company || client.cin || 'Sans detail'}</div>
                </td>
                <td className="td">
                  <div>{client.phone || client.phone2 || '—'}</div>
                  <div className="text-xs text-slate-500">
                    {client.email || (client.phone && client.phone2 ? client.phone2 : '—')}
                  </div>
                  <ContactActions
                    phone={client.phone}
                    phone2={client.phone2}
                    message={buildClientContactMessage(client.fullName)}
                    compact
                    className="mt-2"
                  />
                </td>
                <td className="td">{client.clientType ? clientTypeLabels[client.clientType] : '—'}</td>
                <td className="td text-slate-500">
                  {typeof client.franchiseId === 'object' && client.franchiseId ? client.franchiseId.name : '—'}
                </td>
                <td className="td text-right font-medium">{money(client.totalSpent ?? 0)}</td>
                <td className="td text-right">
                  <span className={(client.balanceDue ?? 0) > 0 ? 'font-semibold text-rose-700' : 'text-slate-500'}>
                    {money(client.balanceDue ?? 0)}
                  </span>
                </td>
                <td className="td">
                  {(client.lateInstallments ?? 0) > 0 ? (
                    <span className="badge-danger">Retard</span>
                  ) : client.active ? (
                    <span className="badge-success">Actif</span>
                  ) : (
                    <span className="badge-muted">Inactif</span>
                  )}
                </td>
                <td className="td">
                  <div className="flex justify-end gap-2">
                    <button className="btn-secondary !px-3 !py-1.5" onClick={() => setViewing(client)}>
                      Voir
                    </button>
                    {canManage && (
                      <>
                        <button className="btn-secondary !px-3 !py-1.5" onClick={() => setEditing(client)}>
                          Modifier
                        </button>
                        {client.active && (
                          <button className="btn-danger !px-3 !py-1.5" onClick={() => setArchiving(client)}>
                            Desactiver
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!query.isLoading && (query.data?.clients.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={8}>Aucun client trouve.</td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={query.data?.meta} onPageChange={setPage} className="px-4 py-3" />
      </section>

      {viewing && <ClientOverviewModal client={viewing} onClose={() => setViewing(null)} />}

      {(creating || editing) && (
        <ClientFormModal
          initial={editing}
          allowFranchiseSelection={isGlobal}
          franchises={franchises.data ?? []}
          defaultFranchiseId={!isGlobal ? user?.franchiseId ?? '' : franchiseFilter}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['clients'] });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {archiving && (
        <ArchiveClientModal
          client={archiving}
          onClose={() => setArchiving(null)}
          onArchived={() => {
            qc.invalidateQueries({ queryKey: ['clients'] });
            setArchiving(null);
          }}
        />
      )}
    </>
  );
}

function ClientOverviewModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const overview = useQuery({
    queryKey: ['client-overview', client._id],
    queryFn: async () => (await api.get<ClientOverview>(`/clients/${client._id}/overview`)).data,
  });

  return (
    <Modal open size="lg" title={client.fullName} onClose={onClose}>
      {overview.isLoading || !overview.data ? (
        <div className="text-sm text-slate-500">Chargement...</div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <MetricCard label="Total achats" value={money(overview.data.salesSummary.totalSpent)} />
            <MetricCard label="Ventes" value={String(overview.data.salesSummary.saleCount)} />
            <MetricCard label="Solde du" value={money(overview.data.installmentSummary.balanceDue)} />
            <MetricCard label="Retards" value={String(overview.data.installmentSummary.lateInstallments)} />
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
            <section className="rounded-2xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Coordonnees</h3>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div><span className="text-slate-400">Telephone:</span> {overview.data.client.phone || '—'}</div>
                <div><span className="text-slate-400">Telephone 2:</span> {overview.data.client.phone2 || '—'}</div>
                <div><span className="text-slate-400">Email:</span> {overview.data.client.email || '—'}</div>
                <div><span className="text-slate-400">Entreprise:</span> {overview.data.client.company || '—'}</div>
                <div><span className="text-slate-400">Matricule fiscal:</span> {overview.data.client.taxId || '—'}</div>
                <div><span className="text-slate-400">Adresse:</span> {overview.data.client.address || '—'}</div>
                <ContactActions
                  phone={overview.data.client.phone}
                  phone2={overview.data.client.phone2}
                  message={buildClientContactMessage(overview.data.client.fullName)}
                  className="pt-2"
                />
                {overview.data.client.notes && (
                  <div className="rounded-xl bg-slate-50 px-3 py-2">{overview.data.client.notes}</div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Echeances</h3>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">En attente</span>
                  <span className="font-semibold text-slate-900">{overview.data.installmentSummary.pendingInstallments}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">En retard</span>
                  <span className="font-semibold text-rose-700">{overview.data.installmentSummary.lateInstallments}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">Payees</span>
                  <span className="font-semibold text-emerald-700">{overview.data.installmentSummary.paidInstallments}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">
                  <span>Solde restant</span>
                  <span className="font-semibold">{money(overview.data.installmentSummary.balanceDue)}</span>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Ventes recentes</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Piece</th>
                    <th className="th">Date</th>
                    <th className="th">Paiement</th>
                    <th className="th text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.recentSales.map((sale) => (
                    <tr key={sale._id}>
                      <td className="td">{sale.invoiceNumber || sale.saleType}</td>
                      <td className="td text-slate-500">{dateTime(sale.createdAt)}</td>
                      <td className="td">{sale.paymentMethod}</td>
                      <td className="td text-right font-medium">{money(sale.total)}</td>
                    </tr>
                  ))}
                  {overview.data.recentSales.length === 0 && (
                    <tr><td className="td text-slate-400" colSpan={4}>Aucune vente recente.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Echeances recentes</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Piece</th>
                    <th className="th">Due date</th>
                    <th className="th">Statut</th>
                    <th className="th text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.recentInstallments.map((installment) => (
                    <tr key={installment._id}>
                      <td className="td">
                        {typeof installment.saleId === 'object' && installment.saleId ? installment.saleId.invoiceNumber || '—' : '—'}
                      </td>
                      <td className="td text-slate-500">{dateOnly(installment.dueDate)}</td>
                      <td className="td">
                        <span className={installment.status === 'late' ? 'badge-danger' : installment.status === 'paid' ? 'badge-success' : 'badge-warning'}>
                          {installment.status}
                        </span>
                      </td>
                      <td className="td text-right font-medium">{money(installment.amount)}</td>
                    </tr>
                  ))}
                  {overview.data.recentInstallments.length === 0 && (
                    <tr><td className="td text-slate-400" colSpan={4}>Aucune echeance.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function ClientFormModal({
  initial,
  allowFranchiseSelection,
  franchises,
  defaultFranchiseId,
  onClose,
  onSaved,
}: {
  initial: Client | null;
  allowFranchiseSelection: boolean;
  franchises: Franchise[];
  defaultFranchiseId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: initial
      ? {
          firstName: initial.firstName ?? '',
          lastName: initial.lastName ?? initial.fullName,
          phone: initial.phone ?? '',
          phone2: initial.phone2 ?? '',
          email: initial.email ?? '',
          address: initial.address ?? '',
          clientType: initial.clientType ?? 'passager',
          company: initial.company ?? '',
          taxId: initial.taxId ?? '',
          cin: initial.cin ?? '',
          notes: initial.notes ?? '',
          franchiseId:
            typeof initial.franchiseId === 'object' && initial.franchiseId
              ? initial.franchiseId._id
              : initial.franchiseId ?? '',
          active: initial.active,
        }
      : {
          firstName: '',
          lastName: '',
          phone: '',
          phone2: '',
          email: '',
          address: '',
          clientType: 'passager',
          company: '',
          taxId: '',
          cin: '',
          notes: '',
          franchiseId: defaultFranchiseId ?? '',
          active: true,
        },
  });

  const save = useMutation({
    mutationFn: async (values: ClientFormValues) => {
      const fullName = [values.firstName?.trim(), values.lastName.trim()].filter(Boolean).join(' ').trim();
      const payload = {
        ...values,
        fullName,
        franchiseId: allowFranchiseSelection ? values.franchiseId || null : undefined,
        email: values.email || '',
      };

      if (initial) await api.patch(`/clients/${initial._id}`, payload);
      else await api.post('/clients', payload);
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      size="lg"
      title={initial ? 'Modifier le client' : 'Nouveau client'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="client-form" disabled={isSubmitting || save.isPending}>
            {isSubmitting || save.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <form id="client-form" onSubmit={handleSubmit((values) => save.mutate(values))} className="grid gap-4 sm:grid-cols-2">
        {allowFranchiseSelection && (
          <div className="sm:col-span-2">
            <label className="label">Franchise</label>
            <select className="input" {...register('franchiseId')}>
              <option value="">Aucune</option>
              {franchises.map((franchise) => (
                <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Nom</label>
          <input className="input" {...register('lastName')} />
          {errors.lastName && <p className="mt-1 text-xs text-rose-600">{errors.lastName.message}</p>}
        </div>
        <div>
          <label className="label">Prenom</label>
          <input className="input" {...register('firstName')} />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" {...register('clientType')}>
            <option value="passager">Passager</option>
            <option value="boutique">Boutique</option>
            <option value="wholesale">Grossiste</option>
            <option value="walkin">Passage</option>
            <option value="other">Autre</option>
          </select>
        </div>
        <div>
          <label className="label">CIN</label>
          <input className="input" {...register('cin')} />
        </div>
        <div>
          <label className="label">Telephone</label>
          <input className="input" {...register('phone')} />
        </div>
        <div>
          <label className="label">Telephone 2</label>
          <input className="input" {...register('phone2')} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" {...register('email')} />
          {errors.email && <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>}
        </div>
        <div>
          <label className="label">Entreprise</label>
          <input className="input" {...register('company')} />
        </div>
        <div>
          <label className="label">Matricule fiscal</label>
          <input className="input" {...register('taxId')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Adresse</label>
          <input className="input" {...register('address')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Notes</label>
          <textarea rows={3} className="input" {...register('notes')} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('active')} /> Client actif
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

function ArchiveClientModal({
  client,
  onClose,
  onArchived,
}: {
  client: Client;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const archive = useMutation({
    mutationFn: async () => {
      await api.delete(`/clients/${client._id}`);
    },
    onSuccess: onArchived,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      size="sm"
      title="Desactiver le client"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-danger" onClick={() => archive.mutate()} disabled={archive.isPending}>
            {archive.isPending ? 'Traitement...' : 'Desactiver'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          Le client <span className="font-semibold text-slate-900">{client.fullName}</span> sera retire des listes actives sans supprimer son historique de ventes ou d'echeances.
        </p>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{error}</div>}
      </div>
    </Modal>
  );
}
