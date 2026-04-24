import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { dateTime } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { TablePagination } from '../components/TablePagination';
import type { AppNotification, PageMeta } from '../lib/types';

const badgeByType: Record<AppNotification['type'], string> = {
  info: 'badge-info',
  warning: 'badge-warning',
  danger: 'badge-danger',
  success: 'badge-success',
};

export function NotificationsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const autoMarked = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['notifications', statusFilter, page],
    queryFn: async () =>
      (
        await api.get<{
          notifications: AppNotification[];
          unreadCount: number;
          meta: PageMeta;
        }>('/notifications', {
          params: {
            status: statusFilter,
            page,
            pageSize: 30,
          },
        })
      ).data,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await api.post('/notifications/read-all');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
    onError: (err) => setError(apiError(err).message),
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/notifications/${id}/read`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
    onError: (err) => setError(apiError(err).message),
  });

  // Legacy parity: opening notifications marks everything read.
  useEffect(() => {
    if (autoMarked.current) return;
    if (list.isLoading) return;
    if ((list.data?.unreadCount ?? 0) <= 0) return;
    autoMarked.current = true;
    markAllRead.mutate();
  }, [list.isLoading, list.data?.unreadCount, markAllRead]);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Evenements systeme: stock, transferts, demandes"
        actions={
          <button
            className="btn-secondary"
            disabled={markAllRead.isPending || (list.data?.unreadCount ?? 0) === 0}
            onClick={() => markAllRead.mutate()}
          >
            Tout marquer comme lu
          </button>
        }
      />

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[180px_1fr]">
          <select
            className="input"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as 'all' | 'unread');
              setPage(1);
            }}
          >
            <option value="all">Toutes</option>
            <option value="unread">Non lues</option>
          </select>
          <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
            Non lues: <span className="font-semibold text-slate-900">{list.data?.unreadCount ?? 0}</span>
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </section>

      <section className="space-y-3">
        {(list.data?.notifications ?? []).map((notification) => (
          <article
            key={notification._id}
            className={`card border-l-4 p-4 ${
              notification.type === 'danger'
                ? 'border-l-rose-500'
                : notification.type === 'warning'
                  ? 'border-l-amber-500'
                  : notification.type === 'success'
                    ? 'border-l-emerald-500'
                    : 'border-l-brand-500'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-slate-900">{notification.title}</h3>
                  <span className={badgeByType[notification.type]}>{notification.type}</span>
                  {!notification.readAt && <span className="badge-warning">Nouveau</span>}
                </div>
                <p className="mt-1 text-sm text-slate-600">{notification.message}</p>
                <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                  <span>{dateTime(notification.createdAt)}</span>
                  {notification.link && (
                    <Link className="text-brand-700 hover:underline" to={
                      notification.link.includes('index.php?page=entree') ? '/receptions' :
                      notification.link.includes('index.php?page=sortie') ? '/transfers' :
                      notification.link.includes('index.php?page=demande') ? '/demands' :
                      notification.link.includes('index.php') ? '/' :
                      notification.link
                    }>
                      Ouvrir
                    </Link>
                  )}
                </div>
              </div>
              {!notification.readAt && (
                <button
                  className="btn-secondary !px-2.5 !py-1.5 text-xs"
                  disabled={markRead.isPending}
                  onClick={() => markRead.mutate(notification._id)}
                >
                  Marquer lue
                </button>
              )}
            </div>
          </article>
        ))}

        {!list.isLoading && (list.data?.notifications.length ?? 0) === 0 && (
          <div className="card p-10 text-center text-sm text-slate-400">Aucune notification.</div>
        )}
      </section>

      <TablePagination meta={list.data?.meta} onPageChange={setPage} className="mt-4" />
    </>
  );
}
