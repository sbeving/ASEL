import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import type { Category } from '../lib/types';

const schema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
type FormValues = z.infer<typeof schema>;

export function CategoriesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<{ categories: Category[] }>('/categories')).data.categories,
  });

  return (
    <>
      <PageHeader
        title="Catégories"
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>+ Nouvelle catégorie</button>}
      />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Nom</th>
              <th className="th">Description</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((c) => (
              <tr key={c._id}>
                <td className="td font-medium">{c.name}</td>
                <td className="td text-slate-500">{c.description ?? '—'}</td>
                <td className="td text-right">
                  <button className="text-brand-600 hover:underline" onClick={() => setEditing(c)}>Modifier</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <CategoryForm
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['categories'] }); setCreating(false); setEditing(null); }}
        />
      )}
    </>
  );
}

function CategoryForm({
  initial,
  onClose,
  onSaved,
}: { initial: Category | null; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? { name: '' },
  });
  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (initial) await api.patch(`/categories/${initial._id}`, values);
      else await api.post('/categories', values);
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });
  return (
    <Modal
      open
      title={initial ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="cat-form" disabled={isSubmitting}>Enregistrer</button>
        </div>
      }
    >
      <form id="cat-form" className="grid gap-3" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <div><label className="label">Nom</label><input className="input" {...register('name')} /></div>
        <div><label className="label">Description</label><textarea rows={3} className="input" {...register('description')} /></div>
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
