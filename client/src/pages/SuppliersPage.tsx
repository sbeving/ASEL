import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Edit3, Plus, RotateCcw, Search } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { ContactActions } from '../components/ContactActions';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import type { Supplier } from '../lib/types';

const schema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(50).optional(),
  email: z.string().email().or(z.literal('')).optional(),
  address: z.string().max(255).optional(),
  active: z.boolean().optional(),
});
type FormValues = z.infer<typeof schema>;

export function SuppliersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');

  const list = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<{ suppliers: Supplier[] }>('/suppliers')).data.suppliers,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter((supplier) => {
      const matchesStatus =
        status === 'all' ||
        (status === 'active' && supplier.active) ||
        (status === 'inactive' && !supplier.active);
      const matchesSearch =
        !q ||
        [supplier.name, supplier.phone, supplier.email, supplier.address]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [list.data, search, status]);

  const activeCount = (list.data ?? []).filter((supplier) => supplier.active).length;
  const inactiveCount = (list.data ?? []).length - activeCount;
  const hasFilters = Boolean(search || status !== 'all');

  const resetFilters = () => {
    setSearch('');
    setStatus('all');
  };

  return (
    <>
      <PageHeader
        title="Fournisseurs"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Nouveau fournisseur
          </button>
        }
      />

      <section className="mb-5 grid grid-cols-3 gap-3">
        <MetricCard label="Total" value={String(list.data?.length ?? 0)} />
        <MetricCard label="Actifs" value={String(activeCount)} />
        <MetricCard label="Inactifs" value={String(inactiveCount)} />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
            <input
              className="input pl-10"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nom, telephone, email..."
            />
          </div>
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="all">Tous statuts</option>
            <option value="active">Actifs</option>
            <option value="inactive">Inactifs</option>
          </select>
          <button type="button" className="btn-secondary" disabled={!hasFilters} onClick={resetFilters}>
            <RotateCcw className="h-4 w-4" />
            Effacer
          </button>
        </div>
      </section>

      <section className="mb-5 grid gap-3 lg:hidden">
        {filtered.map((supplier) => (
          <article key={supplier._id} className="mobile-record-card space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-surface-900">{supplier.name}</div>
                <div className="mt-1 text-sm text-surface-500">{supplier.address ?? 'Adresse non renseignee'}</div>
              </div>
              {supplier.active ? <span className="badge-success">actif</span> : <span className="badge-muted">inactif</span>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="mobile-record-label">Telephone</div>
                <div className="mt-1 font-medium text-surface-800">{supplier.phone ?? '-'}</div>
              </div>
              <div className="text-right">
                <div className="mobile-record-label">Email</div>
                <div className="mt-1 truncate font-medium text-surface-800">{supplier.email ?? '-'}</div>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <ContactActions phone={supplier.phone} message={`Bonjour ${supplier.name}, ici ASEL Mobile Tunisie.`} className="flex-1" />
              <button className="btn-secondary flex-1" onClick={() => setEditing(supplier)}>
                <Edit3 className="h-4 w-4" />
                Modifier
              </button>
            </div>
          </article>
        ))}
        {!list.isLoading && filtered.length === 0 && (
          <div className="mobile-record-card text-sm text-surface-500">Aucun fournisseur.</div>
        )}
      </section>

      <div className="card hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Nom</th>
              <th className="th">Telephone</th>
              <th className="th">Email</th>
              <th className="th">Adresse</th>
              <th className="th">Statut</th>
              <th className="th-action">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((supplier) => (
              <tr key={supplier._id}>
                <td className="td font-medium">{supplier.name}</td>
                <td className="td text-slate-500">
                  <div>{supplier.phone ?? '-'}</div>
                  <ContactActions phone={supplier.phone} message={`Bonjour ${supplier.name}, ici ASEL Mobile Tunisie.`} compact className="mt-2" />
                </td>
                <td className="td text-slate-500">{supplier.email ?? '-'}</td>
                <td className="td text-slate-500">{supplier.address ?? '-'}</td>
                <td className="td">{supplier.active ? <span className="badge-success">actif</span> : <span className="badge-muted">inactif</span>}</td>
                <td className="td-action">
                  <button className="btn-secondary !min-h-[36px] !px-3 !py-1.5" onClick={() => setEditing(supplier)}>
                    <Edit3 className="h-4 w-4" />
                    Modifier
                  </button>
                </td>
              </tr>
            ))}
            {!list.isLoading && filtered.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>Aucun fournisseur.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <SupplierForm
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['suppliers'] }); setCreating(false); setEditing(null); }}
        />
      )}
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-surface-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-surface-900">{value}</div>
    </div>
  );
}

function SupplierForm({
  initial,
  onClose,
  onSaved,
}: { initial: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? { name: '', active: true },
  });
  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (initial) await api.patch(`/suppliers/${initial._id}`, values);
      else await api.post('/suppliers', values);
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });
  return (
    <Modal
      open
      title={initial ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="sup-form" disabled={isSubmitting}>Enregistrer</button>
        </div>
      }
    >
      <form id="sup-form" className="form-grid" onSubmit={handleSubmit((values) => save.mutate(values))}>
        <div className="sm:col-span-2">
          <label className="label">Nom</label>
          <input className="input" {...register('name')} />
          {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>}
        </div>
        <div>
          <label className="label">Telephone</label>
          <input className="input" inputMode="tel" {...register('phone')} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" {...register('email')} />
          {errors.email && <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="label">Adresse</label>
          <input className="input" {...register('address')} />
        </div>
        <label className="checkbox-field sm:col-span-2"><input type="checkbox" {...register('active')} />Actif</label>
        {error && <div className="sm:col-span-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
