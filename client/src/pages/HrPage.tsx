import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock, Clock, Search, UserCheck, UserCog, Users } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { dateTime } from '../lib/money';

interface HrEmployee {
  _id: string;
  fullName: string;
  username: string;
  role: string;
  franchise?: { _id: string; name: string } | null;
  workedMinutes: number;
  activeShift: boolean;
  lastType: 'entree' | 'sortie' | 'pause_debut' | 'pause_fin' | 'verif' | null;
}

interface HrLeaveRequest {
  _id: string;
  type: string;
  fromDate: string;
  toDate: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdAt: string;
  userId?: { _id: string; fullName?: string; username?: string; role?: string } | string;
  franchiseId?: { _id: string; name?: string } | string | null;
  assignedManagerId?: { _id: string; fullName?: string; username?: string; role?: string } | string | null;
}

interface HrSummaryPayload {
  weekStart: string;
  summary: {
    employeeCount: number;
    atWorkCount: number;
    pendingLeaveCount: number;
    workedMinutes: number;
  };
  employees: HrEmployee[];
  pendingLeaveRequests: HrLeaveRequest[];
}

const lastTypeLabel: Record<NonNullable<HrEmployee['lastType']>, string> = {
  entree: 'Entree',
  verif: 'Verification 3h',
  sortie: 'Sortie',
  pause_debut: 'Pause debut',
  pause_fin: 'Pause fin',
};

function formatHours(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0h';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}`;
}

function userLabel(value: HrLeaveRequest['userId']) {
  if (typeof value === 'object' && value) return value.fullName || value.username || '-';
  return '-';
}

function managerLabel(value: HrLeaveRequest['assignedManagerId']) {
  if (typeof value === 'object' && value) return value.fullName || value.username || '-';
  return '-';
}

function employeeSite(employee: HrEmployee) {
  if (employee.franchise?.name) return employee.franchise.name;
  if (employee.role === 'hr_admin' || employee.role === 'siege_employee') return 'Siege';
  if (employee.role === 'commercial') return 'Zone commerciale';
  return '-';
}

function employeeStatus(employee: HrEmployee): 'active' | 'inactive' | 'none' {
  if (employee.activeShift) return 'active';
  if (employee.lastType) return 'inactive';
  return 'none';
}

export function HrPage() {
  const qc = useQueryClient();
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const summary = useQuery({
    queryKey: ['hr-summary'],
    queryFn: async () => (await api.get<HrSummaryPayload>('/hr/summary')).data,
    refetchInterval: 30_000,
  });

  const reviewLeave = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => {
      await api.patch(`/leave-requests/${id}/status`, { status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-summary'] }),
  });

  const data = summary.data;
  const employees = data?.employees ?? [];
  const roleOptions = useMemo(
    () => Array.from(new Set(employees.map((employee) => employee.role))).sort(),
    [employees],
  );
  const siteOptions = useMemo(
    () => Array.from(new Set(employees.map(employeeSite))).filter((site) => site !== '-').sort(),
    [employees],
  );
  const filteredEmployees = useMemo(() => {
    const needle = employeeSearch.trim().toLowerCase();
    return employees.filter((employee) => {
      const site = employeeSite(employee);
      const status = employeeStatus(employee);
      const haystack = [employee.fullName, employee.username, employee.role, site].join(' ').toLowerCase();
      return (
        (!needle || haystack.includes(needle)) &&
        (!roleFilter || employee.role === roleFilter) &&
        (!siteFilter || site === siteFilter) &&
        (!statusFilter || status === statusFilter)
      );
    });
  }, [employeeSearch, employees, roleFilter, siteFilter, statusFilter]);

  return (
    <>
      <PageHeader
        title="Ressources humaines"
        subtitle="Pointage, timesheets et conges des equipes"
        actions={
          <Link to="/users" className="btn-primary">
            <UserCog className="h-4 w-4" />
            Gerer les employes
          </Link>
        }
      />

      {summary.isError && (
        <section className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {apiError(summary.error).message}
        </section>
      )}

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Users} label="Employes actifs" value={String(data?.summary.employeeCount ?? 0)} />
        <MetricCard icon={UserCheck} label="En travail" value={String(data?.summary.atWorkCount ?? 0)} accent="text-emerald-700" />
        <MetricCard icon={Clock} label="Heures semaine" value={formatHours(data?.summary.workedMinutes ?? 0)} />
        <MetricCard icon={CalendarClock} label="Conges en attente" value={String(data?.summary.pendingLeaveCount ?? 0)} accent="text-amber-700" />
      </section>

      <section className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="card overflow-hidden">
          <div className="border-b border-surface-200 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-surface-900">Timesheets semaine</h2>
                <p className="mt-1 text-xs text-surface-500">
                  Depuis {data?.weekStart ? dateTime(data.weekStart) : '-'} · {filteredEmployees.length}/{employees.length} employes affiches
                </p>
              </div>
              <Link to="/timelogs?scope=team" className="btn-secondary !min-h-[38px] !py-1.5">
                Ouvrir pointage
              </Link>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="label">Recherche</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
                  <input
                    className="input pl-9"
                    value={employeeSearch}
                    onChange={(event) => setEmployeeSearch(event.target.value)}
                    placeholder="Nom, username, role..."
                  />
                </div>
              </label>
              <label className="block">
                <span className="label">Role</span>
                <select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                  <option value="">Tous les roles</option>
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Zone de travail</span>
                <select className="input" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
                  <option value="">Toutes les zones</option>
                  {siteOptions.map((site) => (
                    <option key={site} value={site}>{site}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Statut</span>
                <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="">Tous</option>
                  <option value="active">En travail</option>
                  <option value="inactive">Dernier pointage</option>
                  <option value="none">Aucun pointage</option>
                </select>
              </label>
            </div>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Employe</th>
                  <th className="th">Role</th>
                  <th className="th">Site</th>
                  <th className="th">Statut</th>
                  <th className="th text-right">Heures semaine</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((employee) => (
                  <tr key={employee._id}>
                    <td className="td">
                      <div className="font-semibold text-surface-900">{employee.fullName}</div>
                      <div className="text-xs text-surface-500">{employee.username}</div>
                    </td>
                    <td className="td">
                      <span className="badge-info capitalize">{employee.role}</span>
                    </td>
                    <td className="td text-surface-600">{employeeSite(employee)}</td>
                    <td className="td">
                      <EmployeeStatusBadge employee={employee} />
                    </td>
                    <td className="td text-right font-semibold">{formatHours(employee.workedMinutes)}</td>
                  </tr>
                ))}
                {!summary.isLoading && filteredEmployees.length === 0 && (
                  <tr>
                    <td className="td text-surface-400" colSpan={5}>Aucun employe pour ces filtres.</td>
                  </tr>
                )}
                {summary.isLoading && (
                  <tr>
                    <td className="td text-surface-400" colSpan={5}>Chargement des employes...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 p-3 md:hidden">
            {filteredEmployees.map((employee) => (
              <article key={employee._id} className="mobile-record-card space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-surface-900">{employee.fullName}</div>
                    <div className="mt-1 text-xs text-surface-500">{employee.username}</div>
                  </div>
                  <EmployeeStatusBadge employee={employee} />
                </div>
                <div className="mobile-record-row">
                  <span className="mobile-record-label">Role</span>
                  <span className="mobile-record-value capitalize">{employee.role}</span>
                </div>
                <div className="mobile-record-row">
                  <span className="mobile-record-label">Zone</span>
                  <span className="mobile-record-value">{employeeSite(employee)}</span>
                </div>
                <div className="mobile-record-row">
                  <span className="mobile-record-label">Heures</span>
                  <span className="mobile-record-value">{formatHours(employee.workedMinutes)}</span>
                </div>
              </article>
            ))}
            {!summary.isLoading && filteredEmployees.length === 0 && (
              <div className="rounded-lg border border-dashed border-surface-200 px-3 py-6 text-center text-sm text-surface-500">
                Aucun employe pour ces filtres.
              </div>
            )}
            {summary.isLoading && (
              <div className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-6 text-center text-sm text-surface-500">
                Chargement des employes...
              </div>
            )}
          </div>
        </div>

        <aside className="card p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-surface-900">Demandes conge</h2>
            <p className="mt-1 text-xs text-surface-500">Validation rapide des demandes en attente.</p>
          </div>
          <div className="max-h-[520px] space-y-3 overflow-y-auto custom-scrollbar">
            {(data?.pendingLeaveRequests ?? []).map((request) => (
              <div key={request._id} className="rounded-lg border border-surface-200 bg-surface-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-surface-900">{userLabel(request.userId)}</div>
                    <div className="mt-1 text-xs text-surface-500">{request.fromDate} {'->'} {request.toDate}</div>
                    <div className="mt-1 text-xs text-surface-500">Manager: {managerLabel(request.assignedManagerId)}</div>
                    {request.reason && <div className="mt-2 text-sm text-surface-600">{request.reason}</div>}
                  </div>
                  <span className="badge-warning">pending</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    className="btn-secondary !min-h-[38px] !py-1.5"
                    disabled={reviewLeave.isPending}
                    onClick={() => reviewLeave.mutate({ id: request._id, status: 'rejected' })}
                  >
                    Refuser
                  </button>
                  <button
                    className="btn-primary !min-h-[38px] !py-1.5"
                    disabled={reviewLeave.isPending}
                    onClick={() => reviewLeave.mutate({ id: request._id, status: 'approved' })}
                  >
                    Valider
                  </button>
                </div>
              </div>
            ))}
            {!summary.isLoading && (data?.pendingLeaveRequests.length ?? 0) === 0 && (
              <div className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-6 text-center text-sm text-surface-500">
                Aucune demande en attente.
              </div>
            )}
            {reviewLeave.isError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {apiError(reviewLeave.error).message}
              </div>
            )}
          </div>
        </aside>
      </section>
    </>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: any;
  accent?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-surface-500">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${accent ?? 'text-surface-900'}`}>{value}</div>
    </div>
  );
}

function EmployeeStatusBadge({ employee }: { employee: HrEmployee }) {
  if (employee.activeShift) return <span className="badge-success">En travail</span>;
  if (employee.lastType) return <span className="badge-muted">{lastTypeLabel[employee.lastType]}</span>;
  return <span className="badge-muted">Aucun pointage</span>;
}
