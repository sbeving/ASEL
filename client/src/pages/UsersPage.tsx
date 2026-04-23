import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import type { Franchise, Role, User } from '../lib/types';

const ROLES: Role[] = ['admin', 'manager', 'franchise', 'seller'];

// Mirror of server/src/utils/passwordPolicy.ts — keep in sync.
const passwordPolicy = z
  .string()
  .min(10, 'Au moins 10 caractères')
  .max(200)
  .refine(
    (v) => {
      let n = 0;
      if (/[a-z]/.test(v)) n++;
      if (/[A-Z]/.test(v)) n++;
      if (/[0-9]/.test(v)) n++;
      if (/[^A-Za-z0-9]/.test(v)) n++;
      return n >= 3;
    },
    { message: 'Au moins 3 classes parmi {minuscule, majuscule, chiffre, symbole}' },
  );

const createSchema = z.object({
  username: z.string().min(3).max(50),
  fullName: z.string().min(1).max(100),
  role: z.enum(['admin', 'manager', 'franchise', 'seller']),
  franchiseId: z.string().optional().nullable(),
  password: passwordPolicy,
  active: z.boolean().optional(),
});
const editSchema = createSchema.partial().extend({
  password: passwordPolicy.optional().or(z.literal('')),
});
type CreateValues = z.infer<typeof createSchema>;

function isScoped(role: Role) {
  return role === 'franchise' || role === 'seller';
}

export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Utilisateur désactivé');
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const forceLogout = useMutation({
    mutationFn: async (id: string) => api.post(`/users/${id}/force-logout`),
    onSuccess: () => toast.success('Sessions révoquées'),
    onError: (err) => toast.error(apiError(err).message),
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
                    ? (franchises.data ?? []).find((f) => f.id === u.franchiseId)?.name ?? '—'
                    : '—'}
                </td>
                <td className="td text-slate-500">{dateTime(u.lastLoginAt ?? undefined)}</td>
                <td className="td">{u.active ? <span className="badge-success">actif</span> : <span className="badge-muted">inactif</span>}</td>
                <td className="td text-right space-x-3 whitespace-nowrap">
                  <button className="text-brand-600 hover:underline" onClick={() => setEditing(u)}>Modifier</button>
                  <button className="text-brand-600 hover:underline" onClick={() => setResetting(u)}>
                    Réinitialiser MDP
                  </button>
                  {u.active && (
                    <>
                      <button
                        className="text-slate-600 hover:underline"
                        onClick={() => {
                          if (confirm(`Déconnecter toutes les sessions de ${u.username} ?`)) forceLogout.mutate(u.id);
                        }}
                      >
                        Forcer déconnexion
                      </button>
                      <button
                        className="text-rose-600 hover:underline"
                        onClick={() => {
                          if (confirm(`Désactiver ${u.username} ?`)) deactivate.mutate(u.id);
                        }}
                      >
                        Désactiver
                      </button>
                    </>
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

      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={() => {
            setResetting(null);
            toast.success('Mot de passe réinitialisé');
          }}
        />
      )}
    </>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: User;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({ password: passwordPolicy });
  const { register, handleSubmit, formState: { isSubmitting, errors } } = useForm<{ password: string }>({
    resolver: zodResolver(schema),
    defaultValues: { password: '' },
  });
  const reset = useMutation({
    mutationFn: async (v: { password: string }) => api.post(`/users/${user.id}/reset-password`, v),
    onSuccess: onDone,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title={`Réinitialiser le mot de passe de ${user.username}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="reset-pw-form" disabled={isSubmitting}>Réinitialiser</button>
        </div>
      }
    >
      <form id="reset-pw-form" className="grid gap-3" onSubmit={handleSubmit((v) => reset.mutate(v))}>
        <p className="text-sm text-slate-600">
          Cette action débloque le compte et invalide toutes les sessions existantes de cet utilisateur.
        </p>
        <div>
          <label className="label">Nouveau mot de passe</label>
          <input type="password" className="input" autoComplete="new-password" {...register('password')} />
          {errors.password && <p className="text-xs text-rose-600 mt-1">{errors.password.message}</p>}
        </div>
        {error && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
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
  } = useForm<CreateValues>({
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

  const role = watch('role');
  const scoped = isScoped(role);

  const save = useMutation({
    mutationFn: async (values: CreateValues) => {
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
            {franchises.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
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
