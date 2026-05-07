import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Edit3, Plus, RotateCcw, Search, UserX } from 'lucide-react';
import { api, apiError, uploadUrl } from '../lib/api';
import { dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import type { Franchise, Role, User } from '../lib/types';

const ROLES: Role[] = [
  'ceo',
  'admin',
  'superadmin',
  'manager',
  'commercial_director',
  'stock_central_maintainer',
  'cash_central_maintainer',
  'hr_admin',
  'franchise',
  'seller',
  'vendeur',
  'commercial',
  'siege_employee',
  'viewer',
];
const PERMISSION_OPTIONS = [
  { value: 'sales.price.override', label: 'Modifier prix vente' },
  { value: 'map.view', label: 'Voir carte' },
  { value: 'map.manage', label: 'Gerer points reseau' },
  { value: 'map.zones.manage', label: 'Gerer zones commerciales' },
  { value: 'receptions.manage', label: 'Gerer bons reception' },
  { value: 'products.manage', label: 'Gerer produits' },
  { value: 'timelogs.view.all', label: 'Voir pointage equipe' },
  { value: 'timelogs.export', label: 'Exporter pointage' },
  { value: 'leave_requests.manage', label: 'Gerer conges' },
] as const;

const createSchema = z.object({
  username: z.string().min(3).max(50),
  fullName: z.string().min(1).max(100),
  role: z.enum(['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'stock_central_maintainer', 'cash_central_maintainer', 'hr_admin', 'franchise', 'seller', 'vendeur', 'commercial', 'siege_employee', 'viewer']),
  franchiseId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  password: z.string().min(8).max(200),
  active: z.boolean().optional(),
});

const editSchema = createSchema.partial().extend({
  password: z.string().min(8).max(200).optional().or(z.literal('')),
});

type EditValues = z.infer<typeof editSchema>;
type StatusFilter = 'all' | 'active' | 'inactive';

function isScoped(role: Role) {
  return role === 'franchise' || role === 'seller' || role === 'vendeur' || role === 'viewer';
}

function canHaveOptionalFranchise(role: Role) {
  return role === 'commercial';
}

function isActiveUser(user: User) {
  return user.active !== false;
}

function userKey(user: User) {
  return (user._id || user.id)!;
}

function userManagerId(user?: User | null) {
  if (!user?.managerId) return '';
  return typeof user.managerId === 'object' ? user.managerId._id || user.managerId.id : user.managerId;
}

function userManagerLabel(user: User) {
  if (!user.managerId) return '-';
  return typeof user.managerId === 'object'
    ? user.managerId.fullName || user.managerId.username || '-'
    : '-';
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

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

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users.data ?? []).filter((user) => {
      const active = isActiveUser(user);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && active) ||
        (statusFilter === 'inactive' && !active);
      const matchesRole = !roleFilter || user.role === roleFilter;
      const franchiseName = user.franchiseId ? franchisesById.get(user.franchiseId) ?? '' : '';
      const matchesSearch =
        !q ||
        [user.username, user.fullName, user.role, franchiseName]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(q));
      return matchesStatus && matchesRole && matchesSearch;
    });
  }, [franchisesById, roleFilter, search, statusFilter, users.data]);

  const activeCount = (users.data ?? []).filter(isActiveUser).length;
  const inactiveCount = (users.data ?? []).length - activeCount;
  const hasFilters = Boolean(search || roleFilter || statusFilter !== 'all');

  const deactivate = useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const resetFilters = () => {
    setSearch('');
    setRoleFilter('');
    setStatusFilter('all');
  };

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        subtitle="Gestion des roles, franchises et profils staff"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Nouvel utilisateur
          </button>
        }
      />

      <section className="mb-5 grid grid-cols-3 gap-3">
        <MetricCard label="Total" value={String(users.data?.length ?? 0)} />
        <MetricCard label="Actifs" value={String(activeCount)} />
        <MetricCard label="Inactifs" value={String(inactiveCount)} />
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_170px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
            <input
              className="input pl-10"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nom, username, role..."
            />
          </div>
          <select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as '' | Role)}>
            <option value="">Tous roles</option>
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
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
        {filteredUsers.map((user) => (
          <article key={userKey(user)} className="mobile-record-card space-y-3">
            <div className="flex items-start gap-3">
              <Avatar user={user} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-surface-900">{user.username}</div>
                <div className="mt-1 text-sm text-surface-500">{user.fullName}</div>
              </div>
              {isActiveUser(user) ? <span className="badge-success">actif</span> : <span className="badge-muted">inactif</span>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="mobile-record-label">Role</div>
                <div className="mt-1"><span className="badge-info capitalize">{user.role}</span></div>
              </div>
              <div className="text-right">
                <div className="mobile-record-label">Franchise</div>
                <div className="mt-1 font-medium text-surface-800">{user.franchiseId ? franchisesById.get(user.franchiseId) ?? '-' : '-'}</div>
              </div>
              <div className="col-span-2">
                <div className="mobile-record-label">Derniere connexion</div>
                <div className="mt-1 font-medium text-surface-800">{dateTime(user.lastLoginAt ?? undefined)}</div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button className="btn-secondary" onClick={() => setEditing(user)}>
                <Edit3 className="h-4 w-4" />
                Modifier
              </button>
              {isActiveUser(user) && (
                <button className="btn-danger" onClick={() => deactivate.mutate(userKey(user))}>
                  <UserX className="h-4 w-4" />
                  Desactiver
                </button>
              )}
            </div>
          </article>
        ))}
        {!users.isLoading && filteredUsers.length === 0 && (
          <div className="mobile-record-card text-sm text-surface-500">Aucun utilisateur.</div>
        )}
      </section>

      <section className="card hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Utilisateur</th>
              <th className="th">Role</th>
              <th className="th">Franchise</th>
              <th className="th">Manager</th>
              <th className="th">Derniere connexion</th>
              <th className="th">Statut</th>
              <th className="th-action">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <tr key={userKey(user)}>
                <td className="td">
                  <div className="flex items-center gap-3">
                    <Avatar user={user} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{user.username}</div>
                      <div className="truncate text-xs text-slate-500">{user.fullName}</div>
                    </div>
                  </div>
                </td>
                <td className="td">
                  <span className="badge-info capitalize">{user.role}</span>
                </td>
                <td className="td text-slate-500">{user.franchiseId ? franchisesById.get(user.franchiseId) ?? '-' : '-'}</td>
                <td className="td text-slate-500">{userManagerLabel(user)}</td>
                <td className="td text-slate-500">{dateTime(user.lastLoginAt ?? undefined)}</td>
                <td className="td">
                  {isActiveUser(user) ? <span className="badge-success">actif</span> : <span className="badge-muted">inactif</span>}
                </td>
                <td className="td-action">
                  <div className="flex justify-end gap-2">
                    <button className="btn-secondary !min-h-[36px] !px-3 !py-1.5" onClick={() => setEditing(user)}>
                      <Edit3 className="h-4 w-4" />
                      Modifier
                    </button>
                    {isActiveUser(user) && (
                      <button className="btn-danger !min-h-[36px] !px-3 !py-1.5" onClick={() => deactivate.mutate(userKey(user))}>
                        <UserX className="h-4 w-4" />
                        Desactiver
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!users.isLoading && filteredUsers.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={7}>Aucun utilisateur.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {(creating || editing) && (
        <UserFormModal
          initial={editing}
          franchises={franchises.data ?? []}
          users={users.data ?? []}
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

function Avatar({ user, size = 'md' }: { user: User; size?: 'md' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  return (
    <div className={`${sizeClass} flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100`}>
      {user.avatarPath ? (
        <img src={uploadUrl(user.avatarPath)} alt={user.fullName} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-500">
          {user.fullName.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
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

function UserFormModal({
  initial,
  franchises,
  users,
  onClose,
  onSaved,
}: {
  initial: User | null;
  franchises: Franchise[];
  users: User[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [permissionOverrides, setPermissionOverrides] = useState(() => ({
    grants: new Set(initial?.customPermissions?.grants ?? []),
    revokes: new Set(initial?.customPermissions?.revokes ?? []),
  }));

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(initial ? editSchema : createSchema) as never,
    defaultValues: initial
      ? {
          username: initial.username,
          fullName: initial.fullName,
          role: initial.role,
          franchiseId: initial.franchiseId ?? '',
          managerId: userManagerId(initial),
          active: isActiveUser(initial),
          password: '',
        }
      : {
          username: '',
          fullName: '',
          role: 'franchise',
          franchiseId: '',
          managerId: '',
          password: '',
          active: true,
        },
  });

  const role = watch('role') ?? 'franchise';
  const scoped = isScoped(role);
  const optionalFranchise = canHaveOptionalFranchise(role);

  const save = useMutation({
    mutationFn: async (values: EditValues) => {
      const payload: Record<string, unknown> = {
        ...values,
        franchiseId: scoped || optionalFranchise ? values.franchiseId || null : null,
        managerId: values.managerId || null,
        customPermissions: {
          grants: [...permissionOverrides.grants],
          revokes: [...permissionOverrides.revokes],
        },
      };
      if (!payload.password) delete payload.password;

      const response = initial
        ? await api.patch<{ user: User }>(`/users/${userKey(initial)}`, payload)
        : await api.post<{ user: User }>('/users', payload);

      if (avatarFile) {
        const formData = new FormData();
        formData.append('avatar', avatarFile);
        await api.post(`/users/${userKey(response.data.user)}/avatar`, formData);
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
      size="lg"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" form="user-form" disabled={isSubmitting || save.isPending}>
            Enregistrer
          </button>
        </div>
      }
    >
      <form id="user-form" className="form-grid" onSubmit={handleSubmit((values) => save.mutate(values))}>
        <div>
          <label className="label">Nom utilisateur</label>
          <input className="input" {...register('username')} disabled={!!initial} autoComplete="username" />
          {errors.username && <p className="mt-1 text-xs text-rose-600">{errors.username.message}</p>}
        </div>
        <div>
          <label className="label">Nom complet</label>
          <input className="input" {...register('fullName')} autoComplete="name" />
          {errors.fullName && <p className="mt-1 text-xs text-rose-600">{errors.fullName.message}</p>}
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
          <select className="input" {...register('franchiseId')} disabled={!scoped && !optionalFranchise}>
            <option value="">-</option>
            {franchises.map((franchise) => (
              <option key={franchise._id} value={franchise._id}>
                {franchise.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Manager direct</label>
          <select className="input" {...register('managerId')}>
            <option value="">Affectation automatique selon role</option>
            {users
              .filter((item) => userKey(item) !== (initial ? userKey(initial) : ''))
              .filter(isActiveUser)
              .map((item) => (
                <option key={userKey(item)} value={userKey(item)}>
                  {item.fullName} - {item.role}
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-surface-500">
            Conge: vendeur vers manager franchise, commercial vers directeur commercial, sinon manager direct.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="label">
            Mot de passe {initial && <span className="text-slate-400">(laisser vide pour ne pas modifier)</span>}
          </label>
          <input type="password" className="input" autoComplete="new-password" {...register('password')} />
          {errors.password && <p className="mt-1 text-xs text-rose-600">{errors.password.message}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="label">Avatar staff</label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {initial?.avatarPath && !avatarFile && <Avatar user={initial} size="lg" />}
            <input
              type="file"
              className="input"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)}
            />
          </div>
          {avatarFile && <p className="mt-1 text-xs text-slate-500">{avatarFile.name}</p>}
        </div>
        <label className="checkbox-field sm:col-span-2">
          <input type="checkbox" {...register('active')} /> Actif
        </label>
        <div className="sm:col-span-2 rounded-xl border border-surface-200 bg-surface-50 p-3">
          <div className="mb-3 text-sm font-semibold text-surface-900">Permissions granulaires</div>
          <div className="grid gap-2 md:grid-cols-2">
            {PERMISSION_OPTIONS.map((permission) => {
              const state = permissionOverrides.revokes.has(permission.value)
                ? 'revoke'
                : permissionOverrides.grants.has(permission.value)
                  ? 'grant'
                  : 'default';
              return (
                <label key={permission.value} className="grid grid-cols-[minmax(0,1fr)_130px] items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                  <span className="font-medium text-surface-700">{permission.label}</span>
                  <select
                    className="input !h-9 !py-1 text-xs"
                    value={state}
                    onChange={(event) => {
                      const nextGrants = new Set(permissionOverrides.grants);
                      const nextRevokes = new Set(permissionOverrides.revokes);
                      nextGrants.delete(permission.value);
                      nextRevokes.delete(permission.value);
                      if (event.target.value === 'grant') nextGrants.add(permission.value);
                      if (event.target.value === 'revoke') nextRevokes.add(permission.value);
                      setPermissionOverrides({ grants: nextGrants, revokes: nextRevokes });
                    }}
                  >
                    <option value="default">Role defaut</option>
                    <option value="grant">Autoriser</option>
                    <option value="revoke">Bloquer</option>
                  </select>
                </label>
              );
            })}
          </div>
        </div>
        {error && (
          <div className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
