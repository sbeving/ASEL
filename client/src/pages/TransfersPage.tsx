import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiError } from '../lib/api';
import { dateTime } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import type { Franchise, Product, Transfer } from '../lib/types';

const schema = z.object({
  sourceFranchiseId: z.string().min(1),
  destFranchiseId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  note: z.string().max(500).optional(),
}).refine((v) => v.sourceFranchiseId !== v.destFranchiseId, {
  message: 'Source et destination doivent être différents',
  path: ['destFranchiseId'],
});
type FormValues = z.infer<typeof schema>;

function statusBadge(status: Transfer['status']) {
  if (status === 'pending') return <span className="badge-warning">en attente</span>;
  if (status === 'accepted') return <span className="badge-success">accepté</span>;
  if (status === 'rejected') return <span className="badge-danger">rejeté</span>;
  return <span className="badge-muted">annulé</span>;
}

export function TransfersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canCreate = user?.role !== 'seller';
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ['transfers'],
    queryFn: async () => (await api.get<{ transfers: Transfer[] }>('/transfers')).data.transfers,
  });

  const resolve = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      api.post(`/transfers/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfers'] }),
  });

  return (
    <>
      <PageHeader
        title="Transferts"
        subtitle="Mouvements de stock inter-franchise"
        actions={canCreate && <button className="btn-primary" onClick={() => setOpen(true)}>+ Nouveau transfert</button>}
      />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Source</th>
              <th className="th">Destination</th>
              <th className="th">Produit</th>
              <th className="th text-right">Qté</th>
              <th className="th">Statut</th>
              <th className="th">Demandé par</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((t) => {
              const isDest =
                typeof t.destFranchiseId === 'object'
                  ? t.destFranchiseId._id === user?.franchiseId
                  : t.destFranchiseId === user?.franchiseId;
              const canResolve =
                t.status === 'pending' &&
                (user?.role === 'admin' || user?.role === 'manager' || (user?.role === 'franchise' && isDest));
              return (
                <tr key={t._id}>
                  <td className="td text-slate-500">{dateTime(t.createdAt)}</td>
                  <td className="td">{typeof t.sourceFranchiseId === 'object' ? t.sourceFranchiseId.name : '—'}</td>
                  <td className="td">{typeof t.destFranchiseId === 'object' ? t.destFranchiseId.name : '—'}</td>
                  <td className="td">{typeof t.productId === 'object' ? t.productId.name : '—'}</td>
                  <td className="td text-right">{t.quantity}</td>
                  <td className="td">{statusBadge(t.status)}</td>
                  <td className="td text-slate-500">
                    {typeof t.requestedBy === 'object' ? t.requestedBy.fullName : '—'}
                  </td>
                  <td className="td text-right">
                    {canResolve && (
                      <div className="flex justify-end gap-2">
                        <button
                          className="text-emerald-600 hover:underline"
                          onClick={() => resolve.mutate({ id: t._id, action: 'accept' })}
                        >
                          Accepter
                        </button>
                        <button
                          className="text-rose-600 hover:underline"
                          onClick={() => resolve.mutate({ id: t._id, action: 'reject' })}
                        >
                          Rejeter
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!list.isLoading && (list.data?.length ?? 0) === 0 && (
              <tr><td className="td text-slate-400" colSpan={8}>Aucun transfert.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <NewTransferModal
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ['transfers'] });
          }}
        />
      )}
    </>
  );
}

function NewTransferModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const franchises = useQuery({
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });
  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: async () => (await api.get<{ products: Product[] }>('/products', { params: { active: 'true', limit: 500 } })).data.products,
  });

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sourceFranchiseId: user?.franchiseId ?? '',
      destFranchiseId: '',
      productId: '',
      quantity: 1,
    },
  });

  const save = useMutation({
    mutationFn: async (values: FormValues) => api.post('/transfers', values),
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title="Nouveau transfert"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" form="transfer-form" disabled={isSubmitting}>Demander</button>
        </div>
      }
    >
      <form id="transfer-form" className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <div>
          <label className="label">Source</label>
          <select className="input" {...register('sourceFranchiseId')}>
            <option value="">—</option>
            {(franchises.data ?? []).map((f) => (
              <option key={f._id} value={f._id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Destination</label>
          <select className="input" {...register('destFranchiseId')}>
            <option value="">—</option>
            {(franchises.data ?? []).map((f) => (
              <option key={f._id} value={f._id}>{f.name}</option>
            ))}
          </select>
          {errors.destFranchiseId && <p className="text-xs text-rose-600 mt-1">{errors.destFranchiseId.message}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="label">Produit</label>
          <select className="input" {...register('productId')}>
            <option value="">—</option>
            {(products.data ?? []).map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} {p.reference ? `(${p.reference})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Quantité</label>
          <input type="number" min={1} className="input" {...register('quantity')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Note</label>
          <textarea rows={2} className="input" {...register('note')} />
        </div>
        {error && <div className="sm:col-span-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </form>
    </Modal>
  );
}
