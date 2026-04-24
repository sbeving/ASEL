import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError, uploadUrl } from '../lib/api';
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
  const queryClient = useQueryClient();
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

  const franchisesById = useMemo(
    () => new Map((franchises.data ?? []).map((franchise) => [franchise._id, franchise.name])),
    [franchises.data],
  );

  const deactivate = useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        subtitle="Role-based user management with optional staff avatar upload"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + Nouvel utilisateur
          </button>
        }
      />

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Utilisateur</th>
              <th className="th">Role</th>
              <th className="th">Franchise</th>
              <th className="th">Derniere connexion</th>
              <th className="th">Statut</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((user) => (
              <tr key={user._id || user.id}>
                <td className="td">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                      {user.avatarPath ? (
                        <img src={uploadUrl(user.avatarPath)} alt={user.fullName} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                          {user.fullName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{user.username}</div>
                      <div className="text-xs text-slate-500">{user.fullName}</div>
                    </div>
                  </div>
                </td>
                <td className="td">
                  <span className="badge-info capitalize">{user.role}</span>
                </td>
                <td className="td text-slate-500">{user.franchiseId ? franchisesById.get(user.franchiseId) ?? '-' : '-'}</td>
                <td className="td text-slate-500">{dateTime(user.lastLoginAt ?? undefined)}</td>
                <td className="td">
                  {user.active ? <span className="badge-success">actif</span> : <span className="badge-muted">inactif</span>}
                </td>
                <td className="td">
                  <div className="flex justify-end gap-2">
                    <button className="btn-secondary !px-3 !py-1.5" onClick={() => setEditing(user)}>
                      Modifier
                    </button>
                    {user.active && (
                      <button className="btn-danger !px-3 !py-1.5" onClick={() => deactivate.mutate((user._id || user.id)!)}>
                        Desactiver
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(creating || editing) && (
        <UserFormModal
          initial={editing}
          franchises={franchises.data ?? []}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function UserFormModal({
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
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

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
      : {
          username: '',
          fullName: '',
          role: 'franchise',
          franchiseId: '',
          password: '',
          active: true,
        },
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

      const response = initial
        ? await api.patch<{ user: User }>(`/users/${initial._id || initial.id}`, payload)
        : await api.post<{ user: User }>('/users', payload);

      if (avatarFile) {
        const formData = new FormData();
        formData.append('avatar', avatarFile);
        await api.post(`/users/${response.data.user._id || response.data.user.id}/avatar`, formData);
      }
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title={initial ? 'Modifier utilisateur' : 'Nouvel utilisateur'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" form="user-form" disabled={isSubmitting || save.isPending}>
            Enregistrer
          </button>
        </div>
      }
    >
      <form id="user-form" className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((values) => save.mutate(values))}>
        <div>
          <label className="label">Nom utilisateur</label>
          <input className="input" {...register('username')} disabled={!!initial} />
        </div>
        <div>
          <label className="label">Nom complet</label>
          <input className="input" {...register('fullName')} />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" {...register('role')}>
            {ROLES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Franchise</label>
          <select className="input" {...register('franchiseId')} disabled={!scoped}>
            <option value="">-</option>
            {franchises.map((franchise) => (
              <option key={franchise._id} value={franchise._id}>
                {franchise.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">
            Mot de passe {initial && <span className="text-slate-400">(laisser vide pour ne pas modifier)</span>}
          </label>
          <input type="password" className="input" autoComplete="new-password" {...register('password')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Avatar staff</label>
          {initial?.avatarPath && !avatarFile && (
            <div className="mb-2 h-16 w-16 overflow-hidden rounded-full border border-slate-200">
              <img src={uploadUrl(initial.avatarPath)} alt={initial.fullName} className="h-full w-full object-cover" />
            </div>
          )}
          <input
            type="file"
            className="input"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)}
          />
          {avatarFile && <p className="mt-1 text-xs text-slate-500">{avatarFile.name}</p>}
        </div>
        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('active')} /> Actif
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
