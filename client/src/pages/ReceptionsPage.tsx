import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { dateTime, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import type { Franchise, Product, Reception } from '../lib/types';

type ReceptionStatus = 'draft' | 'validated' | 'cancelled';

export function ReceptionsPage() {
  const { user } = useAuth();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager';
  const defaultFid = isGlobal ? '' : (user?.franchiseId ?? '');

  const qc = useQueryClient();
  const [franchiseId, setFranchiseId] = useState(defaultFid);
  const [statusFilter, setStatusFilter] = useState<'' | ReceptionStatus>('');
  const [createStatus, setCreateStatus] = useState<'draft' | 'validated'>('validated');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState(1);
  const [priceHt, setPriceHt] = useState(0);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const products = useQuery({
    queryKey: ['products-lite'],
    queryFn: async () => (await api.get<{ products: Product[] }>('/products', { params: { limit: 500 } })).data.products,
  });

  const receptions = useQuery({
    queryKey: ['receptions', franchiseId, statusFilter],
    queryFn: async () =>
      (
        await api.get<{ receptions: Reception[] }>('/receptions', {
          params: {
            franchiseId: franchiseId || undefined,
            status: statusFilter || undefined,
          },
        })
      ).data.receptions,
  });

  const quickCreate = useMutation({
    mutationFn: async () => {
      if (!selectedProductId) throw new Error('Produit requis');
      const payloadFranchiseId = franchiseId || user?.franchiseId;
      if (!payloadFranchiseId) throw new Error('Franchise requise');
      await api.post('/receptions', {
        franchiseId: payloadFranchiseId,
        status: createStatus,
        note: note || undefined,
        lines: [
          { productId: selectedProductId, quantity: qty, unitPriceHt: priceHt, vatRate: 19 },
        ],
      });
    },
    onSuccess: () => {
      setErr(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['receptions'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => setErr(apiError(e).message),
  });

  const validateReception = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/receptions/${id}/validate`);
    },
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['receptions'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => setErr(apiError(e).message),
  });

  const cancelReception = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/receptions/${id}`);
    },
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['receptions'] });
    },
    onError: (e) => setErr(apiError(e).message),
  });

  const selectedName = useMemo(() => {
    const p = (products.data ?? []).find((x) => x._id === selectedProductId);
    return p?.name || '';
  }, [products.data, selectedProductId]);

  return (
    <>
      <PageHeader title="Bons de réception" subtitle="Entrées de stock façon legacy" />

      <section className="card p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {isGlobal ? (
            <select className="input" value={franchiseId} onChange={(e) => setFranchiseId(e.target.value)}>
              <option value="">Toutes franchises</option>
              {(franchises.data ?? []).map((f) => (
                <option key={f._id} value={f._id}>{f.name}</option>
              ))}
            </select>
          ) : (
            <input className="input" disabled value={user?.franchiseId ? 'Franchise courante' : 'Aucune franchise'} />
          )}
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | ReceptionStatus)}>
            <option value="">Tous statuts</option>
            <option value="draft">Brouillon</option>
            <option value="validated">Validé</option>
            <option value="cancelled">Annulé</option>
          </select>
          <div className="text-sm text-slate-500 self-center">{receptions.data?.length ?? 0} résultat(s)</div>
        </div>
      </section>

      <section className="card p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <select className="input md:col-span-2" value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}>
            <option value="">— Produit —</option>
            {(products.data ?? []).map((p) => (
              <option key={p._id} value={p._id}>{p.name}</option>
            ))}
          </select>
          <select className="input" value={createStatus} onChange={(e) => setCreateStatus(e.target.value as 'draft' | 'validated')}>
            <option value="validated">Valider directement</option>
            <option value="draft">Créer brouillon</option>
          </select>
          <input type="number" min={1} className="input" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
          <input type="number" min={0} step="0.01" className="input" value={priceHt} onChange={(e) => setPriceHt(Math.max(0, Number(e.target.value) || 0))} />
          <input className="input" placeholder="Note (optionnel)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary" disabled={!selectedProductId || quickCreate.isPending} onClick={() => quickCreate.mutate()}>
            {quickCreate.isPending ? 'En cours…' : createStatus === 'validated' ? 'Bon validé rapide' : 'Créer brouillon'}
          </button>
        </div>
        {selectedName && <div className="mt-2 text-sm text-slate-500">Produit: {selectedName}</div>}
        {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
      </section>

      <section className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Numéro</th>
                <th className="th">Date</th>
                <th className="th">Franchise</th>
                <th className="th">Statut</th>
                <th className="th text-right">Total TTC</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(receptions.data ?? []).map((r) => (
                <tr key={r._id}>
                  <td className="td font-medium">{r.number}</td>
                  <td className="td">{dateTime(r.createdAt)}</td>
                  <td className="td">{typeof r.franchiseId === 'object' ? r.franchiseId.name : '—'}</td>
                  <td className="td capitalize">{r.status}</td>
                  <td className="td text-right">{money(r.totalTtc)}</td>
                  <td className="td">
                    <div className="flex gap-2">
                      {r.status === 'draft' && (
                        <>
                          <button className="btn btn-secondary" onClick={() => validateReception.mutate(r._id)} disabled={validateReception.isPending}>
                            Valider
                          </button>
                          <button className="btn btn-danger" onClick={() => cancelReception.mutate(r._id)} disabled={cancelReception.isPending}>
                            Annuler
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!receptions.isLoading && (receptions.data?.length ?? 0) === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={6}>Aucun bon de réception.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
