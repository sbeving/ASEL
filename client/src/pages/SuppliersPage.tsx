import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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

  const list = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<{ suppliers: Supplier[] }>('/suppliers')).data.suppliers,
  });

  return (
    <>
      <PageHeader
        title="Fournisseurs"
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>+ Nouveau fournisseur</button>}
      />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Nom</th>
              <th className="th">Téléphone</th>
              <th className="th">Email</th>
              <th className="th">Adresse</th>
              <th className="th">Statut</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((s) => (
              <tr key={s._id}>
                <td className="td font-medium">{s.name}</td>
                <td className="td text-slate-500">
                  <div>{s.phone ?? '—'}</div>
                  <ContactActions phone={s.phone} message={`Bonjour ${s.name}, ici ASEL Mobile Tunisie.`} compact className="mt-2" />
                </td>
                <td className="td text-slate-500">{s.email ?? '—'}</td>
                <td className="td text-slate-500">{s.address ?? '—'}</td>
                <td className="td">{s.active ? <span className="badge-success">actif</span> : <span className="badge-muted">inactif</span>}</td>
                <td className="td text-right">
                  <button className="text-brand-600 hover:underline" onClick={() => setEditing(s)}>Modifier</button>
                </td>
              </tr>
            ))}
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

function SupplierForm({
  initial,
  onClose,
  onSaved,
}: { initial: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FormValues>({
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
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="sup-form" disabled={isSubmitting}>Enregistrer</button>
        </div>
      }
    >
      <form id="sup-form" className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <div className="sm:col-span-2"><label className="label">Nom</label><input className="input" {...register('name')} /></div>
        <div><label className="label">Téléphone</label><input className="input" {...register('phone')} /></div>
        <div><label className="label">Email</label><input className="input" {...register('email')} /></div>
        <div className="sm:col-span-2"><label className="label">Adresse</label><input className="input" {...register('address')} /></div>
        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" {...register('active')} />Actif</label>
        {error && <div className="sm:col-span-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
