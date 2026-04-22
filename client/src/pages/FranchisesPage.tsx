import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import type { Franchise } from '../lib/types';

const schema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  manager: z.string().max(100).optional(),
  active: z.boolean().optional(),
});
type FormValues = z.infer<typeof schema>;

export function FranchisesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Franchise | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  return (
    <>
      <PageHeader
        title="Franchises"
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>+ Nouvelle franchise</button>}
      />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Nom</th>
              <th className="th">Adresse</th>
              <th className="th">Téléphone</th>
              <th className="th">Responsable</th>
              <th className="th">Statut</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((f) => (
              <tr key={f._id}>
                <td className="td font-medium">{f.name}</td>
                <td className="td text-slate-500">{f.address ?? '—'}</td>
                <td className="td text-slate-500">{f.phone ?? '—'}</td>
                <td className="td text-slate-500">{f.manager ?? '—'}</td>
                <td className="td">{f.active ? <span className="badge-success">actif</span> : <span className="badge-muted">inactif</span>}</td>
                <td className="td text-right">
                  <button className="text-brand-600 hover:underline" onClick={() => setEditing(f)}>Modifier</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <FranchiseForm
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['franchises'] }); setCreating(false); setEditing(null); }}
        />
      )}
    </>
  );
}

function FranchiseForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: Franchise | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? { name: '', active: true },
  });

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (initial) await api.patch(`/franchises/${initial._id}`, values);
      else await api.post('/franchises', values);
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title={initial ? 'Modifier la franchise' : 'Nouvelle franchise'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="franchise-form" disabled={isSubmitting}>Enregistrer</button>
        </div>
      }
    >
      <form id="franchise-form" className="grid gap-3" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <div><label className="label">Nom</label><input className="input" {...register('name')} /></div>
        <div><label className="label">Adresse</label><input className="input" {...register('address')} /></div>
        <div><label className="label">Téléphone</label><input className="input" {...register('phone')} /></div>
        <div><label className="label">Responsable</label><input className="input" {...register('manager')} /></div>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" {...register('active')} />Actif</label>
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
