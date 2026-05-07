import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Edit3, Plus } from 'lucide-react';
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
        title="Categories"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Nouvelle categorie
          </button>
        }
      />

      <section className="mb-5 grid gap-3 lg:hidden">
        {(list.data ?? []).map((category) => (
          <article key={category._id} className="mobile-record-card space-y-3">
            <div>
              <div className="font-semibold text-surface-900">{category.name}</div>
              <div className="mt-1 text-sm text-surface-500">{category.description ?? 'Sans description'}</div>
            </div>
            <button className="btn-secondary w-full" onClick={() => setEditing(category)}>
              <Edit3 className="h-4 w-4" />
              Modifier
            </button>
          </article>
        ))}
        {!list.isLoading && (list.data?.length ?? 0) === 0 && (
          <div className="mobile-record-card text-sm text-surface-500">Aucune categorie.</div>
        )}
      </section>

      <div className="card hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Nom</th>
              <th className="th">Description</th>
              <th className="th-action">Action</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((category) => (
              <tr key={category._id}>
                <td className="td font-medium">{category.name}</td>
                <td className="td text-slate-500">{category.description ?? '-'}</td>
                <td className="td-action">
                  <button className="btn-secondary !min-h-[36px] !px-3 !py-1.5" onClick={() => setEditing(category)}>
                    <Edit3 className="h-4 w-4" />
                    Modifier
                  </button>
                </td>
              </tr>
            ))}
            {!list.isLoading && (list.data?.length ?? 0) === 0 && (
              <tr><td className="td text-slate-400" colSpan={3}>Aucune categorie.</td></tr>
            )}
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
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
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
      title={initial ? 'Modifier la categorie' : 'Nouvelle categorie'}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="cat-form" disabled={isSubmitting}>Enregistrer</button>
        </div>
      }
    >
      <form id="cat-form" className="grid gap-3" onSubmit={handleSubmit((values) => save.mutate(values))}>
        <div>
          <label className="label">Nom</label>
          <input className="input" {...register('name')} />
          {errors.name && <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>}
        </div>
        <div>
          <label className="label">Description</label>
          <textarea rows={3} className="input" {...register('description')} />
        </div>
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
