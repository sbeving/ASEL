import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import type { Franchise, Role, User } from '../lib/types';

const ROLES: Role[] = ['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer'];

const createSchema = z.object({
  username: z.string().min(3).max(50),
  fullName: z.string().min(1).max(100),
  role: z.enum(['admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer']),
  franchiseId: z.string().optional().nullable(),
  password: z.string().min(8).max(200),
  active: z.boolean().optional(),
});
const editSchema = createSchema.partial().extend({
  password: z.string().min(8).max(200).optional().or(z.literal('')),
});
type EditValues = z.infer<typeof editSchema>;

function isScoped(role: Role) {
  return role === 'franchise' || role === 'seller' || role === 'vendeur' || role === 'viewer';
}

export function UsersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);

  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<{ users: User[] }>('/users')).data.users,
  });
  const franchises = useQuery({
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const deactivate = useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>+ Nouvel utilisateur</button>}
      />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Nom d’utilisateur</th>
              <th className="th">Nom complet</th>
              <th className="th">Rôle</th>
              <th className="th">Franchise</th>
              <th className="th">Dernière connexion</th>
              <th className="th">Statut</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.username}</td>
                <td className="td">{u.fullName}</td>
                <td className="td"><span className="badge-info capitalize">{u.role}</span></td>
                <td className="td text-slate-500">
                  {u.franchiseId
                    ? (franchises.data ?? []).find((f) => f._id === u.franchiseId)?.name ?? '—'
                    : '—'}
                </td>
                <td className="td text-slate-500">{dateTime(u.lastLoginAt ?? undefined)}</td>
                <td className="td">{u.active ? <span className="badge-success">actif</span> : <span className="badge-muted">inactif</span>}</td>
                <td className="td text-right space-x-3">
                  <button className="text-brand-600 hover:underline" onClick={() => setEditing(u)}>Modifier</button>
                  {u.active && (
                    <button
                      className="text-rose-600 hover:underline"
                      onClick={() => {
                        if (confirm(`Désactiver ${u.username} ?`)) deactivate.mutate(u.id);
                      }}
                    >
                      Désactiver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <UserForm
          initial={editing}
          franchises={franchises.data ?? []}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['users'] }); setCreating(false); setEditing(null); }}
        />
      )}
    </>
  );
}

function UserForm({
  initial,
  franchises,
  onClose,
  onSaved,
}: {
  initial: User | null;
  franchises: Franchise[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(initial ? editSchema : createSchema) as never,
    defaultValues: initial
      ? {
          username: initial.username,
          fullName: initial.fullName,
          role: initial.role,
          franchiseId: initial.franchiseId ?? '',
          active: initial.active,
          password: '',
        }
      : { username: '', fullName: '', role: 'franchise', franchiseId: '', password: '', active: true },
  });

  const role = watch('role') ?? 'franchise';
  const scoped = isScoped(role);

  const save = useMutation({
    mutationFn: async (values: EditValues) => {
      const payload: Record<string, unknown> = {
        ...values,
        franchiseId: scoped ? values.franchiseId || null : null,
      };
      if (!payload.password) delete payload.password;
      if (initial) await api.patch(`/users/${initial.id}`, payload);
      else await api.post('/users', payload);
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title={initial ? 'Modifier l’utilisateur' : 'Nouvel utilisateur'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="user-form" disabled={isSubmitting}>Enregistrer</button>
        </div>
      }
    >
      <form id="user-form" className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <div>
          <label className="label">Nom d’utilisateur</label>
          <input className="input" {...register('username')} disabled={!!initial} />
        </div>
        <div>
          <label className="label">Nom complet</label>
          <input className="input" {...register('fullName')} />
        </div>
        <div>
          <label className="label">Rôle</label>
          <select className="input" {...register('role')}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Franchise</label>
          <select className="input" {...register('franchiseId')} disabled={!scoped}>
            <option value="">—</option>
            {franchises.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">
            Mot de passe {initial && <span className="text-slate-400">(laisser vide pour ne pas changer)</span>}
          </label>
          <input type="password" className="input" autoComplete="new-password" {...register('password')} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('active')} /> Actif
        </label>
        {error && <div className="sm:col-span-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
