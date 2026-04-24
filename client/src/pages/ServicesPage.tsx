import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../auth/AuthContext';
import { api, apiError } from '../lib/api';
import { dateTime, money } from '../lib/money';
import { useDebouncedValue } from '../lib/hooks';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { TablePagination } from '../components/TablePagination';
import type { Client, Franchise, PageMeta, Service, ServiceRecord } from '../lib/types';

const serviceSchema = z.object({
  name: z.string().min(1, 'Nom requis').max(150),
  category: z.enum(['technique', 'compte', 'autre']),
  price: z.coerce.number().min(0),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  description: z.string().max(1200).optional(),
  active: z.boolean().optional(),
});

const recordSchema = z.object({
  serviceId: z.string().min(1, 'Service requis'),
  franchiseId: z.string().optional(),
  clientId: z.string().optional(),
  billedPrice: z.coerce.number().min(0),
  performedAt: z.string().optional(),
  note: z.string().max(1000).optional(),
});

type ServiceFormValues = z.infer<typeof serviceSchema>;
type RecordFormValues = z.infer<typeof recordSchema>;

const categoryLabel: Record<Service['category'], string> = {
  technique: 'Technique',
  compte: 'Compte',
  autre: 'Autre',
};

const categoryBadge: Record<Service['category'], string> = {
  technique: 'badge-warning',
  compte: 'badge-info',
  autre: 'badge-muted',
};

export function ServicesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 250);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | ''>('true');
  const [servicesPage, setServicesPage] = useState(1);
  const [recordPage, setRecordPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [serviceModal, setServiceModal] = useState<{ mode: 'create' | 'edit'; service?: Service } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Service | null>(null);
  const [recordModalOpen, setRecordModalOpen] = useState(false);

  const canManageCatalog = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager';
  const canRecordService =
    user?.role === 'admin' ||
    user?.role === 'superadmin' ||
    user?.role === 'manager' ||
    user?.role === 'franchise' ||
    user?.role === 'seller' ||
    user?.role === 'vendeur';

  const services = useQuery({
    queryKey: ['services', debouncedQ, categoryFilter, activeFilter, servicesPage],
    queryFn: async () =>
      (
        await api.get<{ services: Service[]; meta: PageMeta }>('/services', {
          params: {
            q: debouncedQ || undefined,
            category: categoryFilter || undefined,
            active: activeFilter || undefined,
            page: servicesPage,
            pageSize: 25,
          },
        })
      ).data,
  });

  const records = useQuery({
    queryKey: ['service-records', from, to, recordPage],
    queryFn: async () =>
      (
        await api.get<{
          records: ServiceRecord[];
          meta: PageMeta;
          summary: { totalRecords: number; totalRevenue: number; averagePrice: number };
        }>('/services/records', {
          params: {
            from: from || undefined,
            to: to || undefined,
            page: recordPage,
            pageSize: 20,
          },
        })
      ).data,
  });

  const catalogStats = useMemo(() => {
    const rows = services.data?.services ?? [];
    return {
      total: services.data?.meta.total ?? 0,
      active: rows.filter((service) => service.active).length,
      inactive: rows.filter((service) => !service.active).length,
      avgPrice: rows.length ? rows.reduce((sum, row) => sum + row.price, 0) / rows.length : 0,
    };
  }, [services.data]);

  return (
    <>
      <PageHeader
        title="Services"
        subtitle="Catalogue de prestations et suivi des interventions facturees"
        actions={
          <>
            {canRecordService && (
              <button className="btn-secondary" onClick={() => setRecordModalOpen(true)}>
                + Nouvelle prestation
              </button>
            )}
            {canManageCatalog && (
              <button className="btn-primary" onClick={() => setServiceModal({ mode: 'create' })}>
                + Nouveau service
              </button>
            )}
          </>
        }
      />

      <section className="mb-5 grid gap-4 md:grid-cols-4">
        <MetricCard label="Services" value={String(catalogStats.total)} />
        <MetricCard label="Actifs (page)" value={String(catalogStats.active)} />
        <MetricCard label="Inactifs (page)" value={String(catalogStats.inactive)} />
        <MetricCard label="Prix moyen (page)" value={money(catalogStats.avgPrice)} />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_220px_180px]">
          <input
            className="input"
            placeholder="Rechercher un service..."
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setServicesPage(1);
            }}
          />
          <select
            className="input"
            value={categoryFilter}
            onChange={(event) => {
              setCategoryFilter(event.target.value);
              setServicesPage(1);
            }}
          >
            <option value="">Toutes categories</option>
            <option value="technique">Technique</option>
            <option value="compte">Compte</option>
            <option value="autre">Autre</option>
          </select>
          <select
            className="input"
            value={activeFilter}
            onChange={(event) => {
              setActiveFilter(event.target.value as 'true' | 'false' | '');
              setServicesPage(1);
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
              <th className="th">Service</th>
              <th className="th">Categorie</th>
              <th className="th text-right">Prix</th>
              <th className="th text-right">Duree</th>
              <th className="th">Statut</th>
              <th className="th-action">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(services.data?.services ?? []).map((service) => (
              <tr key={service._id}>
                <td className="td-action">
                  <div className="font-medium text-slate-900">{service.name}</div>
                  <div className="text-xs text-slate-500">{service.description || 'Sans description'}</div>
                </td>
                <td className="td">
                  <span className={categoryBadge[service.category]}>{categoryLabel[service.category]}</span>
                </td>
                <td className="td text-right font-medium">{money(service.price)}</td>
                <td className="td text-right text-slate-600">{service.durationMinutes} min</td>
                <td className="td">
                  {service.active ? <span className="badge-success">Actif</span> : <span className="badge-muted">Inactif</span>}
                </td>
                <td className="td">
                  <div className="flex justify-end gap-2">
                    {canManageCatalog && (
                      <>
                        <button
                          className="btn-secondary !px-3 !py-1.5"
                          onClick={() => setServiceModal({ mode: 'edit', service })}
                        >
                          Modifier
                        </button>
                        {service.active && (
                          <button
                            className="btn-danger !px-3 !py-1.5"
                            onClick={() => setArchiveTarget(service)}
                          >
                            Desactiver
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!services.isLoading && (services.data?.services.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>Aucun service trouve.</td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={services.data?.meta} onPageChange={setServicesPage} className="px-4 py-3" />
      </section>

      <section className="mt-8">
        <PageHeader
          title="Prestations recentes"
          subtitle="Historique des interventions facturees (par service)"
          actions={
            <div className="flex items-end gap-2">
              <div>
                <label className="label !mb-1">Du</label>
                <input
                  type="date"
                  className="input !py-2"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    setRecordPage(1);
                  }}
                />
              </div>
              <div>
                <label className="label !mb-1">Au</label>
                <input
                  type="date"
                  className="input !py-2"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    setRecordPage(1);
                  }}
                />
              </div>
            </div>
          }
        />
      </section>

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="Nb prestations" value={String(records.data?.summary.totalRecords ?? 0)} />
        <MetricCard label="CA prestations" value={money(records.data?.summary.totalRevenue ?? 0)} />
        <MetricCard label="Panier moyen" value={money(records.data?.summary.averagePrice ?? 0)} />
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Service</th>
              <th className="th">Franchise</th>
              <th className="th">Client</th>
              <th className="th">Technicien</th>
              <th className="th text-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {(records.data?.records ?? []).map((record) => (
              <tr key={record._id}>
                <td className="td text-slate-500">{dateTime(record.performedAt)}</td>
                <td className="td">
                  {typeof record.serviceId === 'object' && record.serviceId ? record.serviceId.name : '—'}
                </td>
                <td className="td text-slate-600">
                  {typeof record.franchiseId === 'object' && record.franchiseId ? record.franchiseId.name : '—'}
                </td>
                <td className="td text-slate-600">
                  {typeof record.clientId === 'object' && record.clientId ? record.clientId.fullName : '—'}
                </td>
                <td className="td text-slate-600">
                  {typeof record.userId === 'object' && record.userId
                    ? record.userId.fullName || record.userId.username || '—'
                    : '—'}
                </td>
                <td className="td text-right font-medium">{money(record.billedPrice)}</td>
              </tr>
            ))}
            {!records.isLoading && (records.data?.records.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>Aucune prestation sur cette periode.</td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination meta={records.data?.meta} onPageChange={setRecordPage} className="px-4 py-3" />
      </section>

      {serviceModal && (
        <ServiceFormModal
          initial={serviceModal.service ?? null}
          onClose={() => setServiceModal(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['services'] });
            setServiceModal(null);
          }}
        />
      )}

      {archiveTarget && (
        <ArchiveServiceModal
          service={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onArchived={() => {
            qc.invalidateQueries({ queryKey: ['services'] });
            setArchiveTarget(null);
          }}
        />
      )}

      {recordModalOpen && (
        <RecordServiceModal
          onClose={() => setRecordModalOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['service-records'] });
            setRecordModalOpen(false);
          }}
        />
      )}
    </>
  );
}

function ServiceFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Service | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          category: initial.category,
          price: initial.price,
          durationMinutes: initial.durationMinutes,
          description: initial.description ?? '',
          active: initial.active,
        }
      : {
          name: '',
          category: 'technique',
          price: 0,
          durationMinutes: 15,
          description: '',
          active: true,
        },
  });

  const save = useMutation({
    mutationFn: async (values: ServiceFormValues) => {
      if (initial) await api.patch(`/services/${initial._id}`, values);
      else await api.post('/services', values);
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title={initial ? 'Modifier le service' : 'Nouveau service'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="service-form" disabled={isSubmitting || save.isPending}>
            {isSubmitting || save.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <form id="service-form" onSubmit={handleSubmit((values) => save.mutate(values))} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Nom</label>
          <input className="input" {...register('name')} />
          {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>}
        </div>
        <div>
          <label className="label">Categorie</label>
          <select className="input" {...register('category')}>
            <option value="technique">Technique</option>
            <option value="compte">Compte</option>
            <option value="autre">Autre</option>
          </select>
        </div>
        <div>
          <label className="label">Duree (minutes)</label>
          <input type="number" min={1} max={1440} className="input" {...register('durationMinutes')} />
        </div>
        <div>
          <label className="label">Prix</label>
          <input type="number" step="0.01" min={0} className="input" {...register('price')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description</label>
          <textarea rows={3} className="input" {...register('description')} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('active')} /> Service actif
        </label>
        {error && <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}

function ArchiveServiceModal({
  service,
  onClose,
  onArchived,
}: {
  service: Service;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const archive = useMutation({
    mutationFn: async () => {
      await api.delete(`/services/${service._id}`);
    },
    onSuccess: onArchived,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      size="sm"
      title="Desactiver le service"
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
          Le service <span className="font-semibold text-slate-900">{service.name}</span> sera retire du catalogue actif.
        </p>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{error}</div>}
      </div>
    </Modal>
  );
}

function RecordServiceModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const isGlobal = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager';

  const services = useQuery({
    queryKey: ['services-record-form'],
    queryFn: async () =>
      (
        await api.get<{ services: Service[] }>('/services', {
          params: { active: 'true', page: 1, pageSize: 200 },
        })
      ).data.services,
  });

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const defaultFranchiseId = !isGlobal ? user?.franchiseId ?? '' : '';
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RecordFormValues>({
    resolver: zodResolver(recordSchema),
    defaultValues: {
      serviceId: '',
      franchiseId: defaultFranchiseId,
      clientId: '',
      billedPrice: 0,
      performedAt: new Date().toISOString().slice(0, 16),
      note: '',
    },
  });

  const selectedServiceId = watch('serviceId');
  const selectedFranchiseId = watch('franchiseId');

  const clients = useQuery({
    enabled: Boolean(selectedFranchiseId),
    queryKey: ['service-record-clients', selectedFranchiseId],
    queryFn: async () =>
      (
        await api.get<{ clients: Client[] }>('/clients', {
          params: {
            franchiseId: selectedFranchiseId || undefined,
            active: 'true',
            page: 1,
            pageSize: 200,
          },
        })
      ).data.clients,
  });

  const selectedService = useMemo(
    () => (services.data ?? []).find((service) => service._id === selectedServiceId),
    [services.data, selectedServiceId],
  );

  const save = useMutation({
    mutationFn: async (values: RecordFormValues) => {
      if (isGlobal && !values.franchiseId) {
        throw new Error('Franchise requise');
      }
      await api.post('/services/records', {
        serviceId: values.serviceId,
        franchiseId: isGlobal ? values.franchiseId || undefined : undefined,
        clientId: values.clientId || null,
        billedPrice: values.billedPrice,
        performedAt: values.performedAt ? new Date(values.performedAt).toISOString() : undefined,
        note: values.note || undefined,
      });
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : apiError(err).message),
  });

  return (
    <Modal
      open
      title="Nouvelle prestation"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="record-service-form" disabled={isSubmitting || save.isPending}>
            {isSubmitting || save.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <form id="record-service-form" className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((values) => save.mutate(values))}>
        <div className="sm:col-span-2">
          <label className="label">Service</label>
          <select
            className="input"
            {...register('serviceId')}
            onChange={(event) => {
              const nextServiceId = event.target.value;
              setValue('serviceId', nextServiceId);
              const next = (services.data ?? []).find((service) => service._id === nextServiceId);
              if (next) setValue('billedPrice', next.price);
            }}
          >
            <option value="">Selectionner un service</option>
            {(services.data ?? []).map((service) => (
              <option key={service._id} value={service._id}>
                {service.name} ({money(service.price)})
              </option>
            ))}
          </select>
          {errors.serviceId && <p className="mt-1 text-xs text-rose-600">{errors.serviceId.message}</p>}
        </div>
        {isGlobal ? (
          <div>
            <label className="label">Franchise</label>
            <select className="input" {...register('franchiseId')}>
              <option value="">Selectionner</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>{franchise.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="label">Franchise</label>
            <input className="input" value="Franchise courante" disabled />
          </div>
        )}
        <div>
          <label className="label">Montant facture</label>
          <input type="number" min={0} step="0.01" className="input" {...register('billedPrice')} />
        </div>
        <div>
          <label className="label">Client (optionnel)</label>
          <select className="input" {...register('clientId')}>
            <option value="">Sans client</option>
            {(clients.data ?? []).map((client) => (
              <option key={client._id} value={client._id}>
                {client.fullName}{client.phone ? ` - ${client.phone}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Date/heure</label>
          <input type="datetime-local" className="input" {...register('performedAt')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Note</label>
          <textarea rows={3} className="input" {...register('note')} />
        </div>
        {selectedService && (
          <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Duree standard: <span className="font-semibold text-slate-900">{selectedService.durationMinutes} min</span>
          </div>
        )}
        {error && <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
