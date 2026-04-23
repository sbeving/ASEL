import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { TablePagination } from '../components/TablePagination';
import { Modal } from '../components/Modal';
import { useDebouncedValue } from '../lib/hooks';
import { useAuth } from '../auth/AuthContext';
import type { Client, Franchise, PageMeta } from '../lib/types';

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

export function ClientsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager';
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 250);
  const [page, setPage] = useState(1);
  const [franchiseFilter, setFranchiseFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | ''>('true');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [archiving, setArchiving] = useState<Client | null>(null);
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
        subtitle="Répertoire client aligné sur le legacy, avec création et édition en modal"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + Nouveau client
          </button>
        }
      />

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_220px_180px]">
          <input
            className="input"
            placeholder="Nom, téléphone, email, entreprise…"
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
              <th className="th">Type</th>
              <th className="th">Contact</th>
              <th className="th">Entreprise</th>
              <th className="th">Franchise</th>
              <th className="th">Statut</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(query.data?.clients ?? []).map((client) => (
              <tr key={client._id}>
                <td className="td">
                  <div className="font-medium text-slate-900">{client.fullName}</div>
                  <div className="text-xs text-slate-500">{client.cin || 'CIN non renseigné'}</div>
                </td>
                <td className="td">{client.clientType ? clientTypeLabels[client.clientType] : '—'}</td>
                <td className="td">
                  <div>{client.phone || '—'}</div>
                  <div className="text-xs text-slate-500">{client.email || client.phone2 || '—'}</div>
                </td>
                <td className="td text-slate-500">{client.company || '—'}</td>
                <td className="td text-slate-500">
                  {typeof client.franchiseId === 'object' && client.franchiseId ? client.franchiseId.name : '—'}
                </td>
                <td className="td">
                  {client.active ? <span className="badge-success">Actif</span> : <span className="badge-muted">Inactif</span>}
                </td>
                <td className="td">
                  <div className="flex justify-end gap-2">
                    <button className="btn-secondary !px-3 !py-1.5" onClick={() => setEditing(client)}>
                      Modifier
                    </button>
                    {client.active && (
                      <button className="btn-danger !px-3 !py-1.5" onClick={() => setArchiving(client)}>
                        Désactiver
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!query.isLoading && (query.data?.clients.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={7}>Aucun client trouvé.</td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={query.data?.meta} onPageChange={setPage} className="px-4 py-3" />
      </section>

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

      if (initial) {
        await api.patch(`/clients/${initial._id}`, payload);
      } else {
        await api.post('/clients', payload);
      }
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
            {isSubmitting || save.isPending ? 'Enregistrement…' : 'Enregistrer'}
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
          <label className="label">Prénom</label>
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
          <label className="label">Téléphone</label>
          <input className="input" {...register('phone')} />
        </div>
        <div>
          <label className="label">Téléphone 2</label>
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
      title="Désactiver le client"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-danger" onClick={() => archive.mutate()} disabled={archive.isPending}>
            {archive.isPending ? 'Traitement…' : 'Désactiver'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          Le client <span className="font-semibold text-slate-900">{client.fullName}</span> sera retiré des listes actives,
          sans supprimer son historique de ventes ou d’échéances.
        </p>
        <p>Le legacy PHP suivait déjà cette logique de conservation métier. On garde donc une désactivation sûre plutôt qu’un hard delete.</p>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{error}</div>}
      </div>
    </Modal>
  );
}
