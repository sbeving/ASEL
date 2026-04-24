import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, uploadUrl } from '../lib/api';
import { dateTime, money } from '../lib/money';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useAuth } from '../auth/AuthContext';
import type { CashFlow, Franchise } from '../lib/types';

export function CashFlowsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'superadmin';
  const [franchiseId, setFranchiseId] = useState(isGlobal ? '' : user?.franchiseId ?? '');
  const [typeFilter, setTypeFilter] = useState<'' | 'encaissement' | 'decaissement'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openCreate, setOpenCreate] = useState(false);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const flows = useQuery({
    queryKey: ['cashflows', franchiseId, typeFilter, from, to],
    queryFn: async () =>
      (
        await api.get<{ flows: CashFlow[] }>('/cashflows', {
          params: {
            franchiseId: franchiseId || undefined,
            type: typeFilter || undefined,
            from: from || undefined,
            to: to || undefined,
          },
        })
      ).data.flows,
  });

  const totals = useMemo(() => {
    const all = flows.data ?? [];
    const encaissements = all
      .filter((flow) => flow.type === 'encaissement')
      .reduce((sum, flow) => sum + flow.amount, 0);
    const decaissements = all
      .filter((flow) => flow.type === 'decaissement')
      .reduce((sum, flow) => sum + flow.amount, 0);
    return {
      encaissements,
      decaissements,
      net: encaissements - decaissements,
    };
  }, [flows.data]);

  return (
    <>
      <PageHeader
        title="Tresorerie"
        subtitle="Cashflow tracking with support document upload (invoice, receipt, PDF)"
        actions={
          <button className="btn-primary" onClick={() => setOpenCreate(true)}>
            + Nouveau mouvement
          </button>
        }
      />

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Encaissements</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-700">{money(totals.encaissements)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Decaissements</div>
          <div className="mt-2 text-2xl font-semibold text-rose-700">{money(totals.decaissements)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Net</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{money(totals.net)}</div>
        </div>
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[220px_220px_180px_180px]">
          {isGlobal ? (
            <select className="input" value={franchiseId} onChange={(event) => setFranchiseId(event.target.value)}>
              <option value="">Toutes franchises</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>
                  {franchise.name}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" disabled value="Franchise courante" />
          )}
          <select
            className="input"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as '' | 'encaissement' | 'decaissement')}
          >
            <option value="">Tous types</option>
            <option value="encaissement">Encaissement</option>
            <option value="decaissement">Decaissement</option>
          </select>
          <input type="date" className="input" value={from} onChange={(event) => setFrom(event.target.value)} />
          <input type="date" className="input" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
      </section>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">Franchise</th>
              <th className="th">Type</th>
              <th className="th">Motif</th>
              <th className="th">Reference</th>
              <th className="th text-right">Montant</th>
              <th className="th">Piece jointe</th>
              <th className="th">Saisi par</th>
            </tr>
          </thead>
          <tbody>
            {(flows.data ?? []).map((flow) => (
              <tr key={flow._id}>
                <td className="td">{dateTime(flow.date)}</td>
                <td className="td">
                  {typeof flow.franchiseId === 'object' && flow.franchiseId ? flow.franchiseId.name : '-'}
                </td>
                <td className="td">
                  {flow.type === 'encaissement' ? (
                    <span className="badge-success">encaissement</span>
                  ) : (
                    <span className="badge-danger">decaissement</span>
                  )}
                </td>
                <td className="td">{flow.reason}</td>
                <td className="td">{flow.reference || '-'}</td>
                <td className="td text-right font-semibold">{money(flow.amount)}</td>
                <td className="td">
                  {flow.attachmentPath ? (
                    <a className="text-brand-600 hover:underline" href={uploadUrl(flow.attachmentPath)} target="_blank" rel="noreferrer">
                      Ouvrir
                    </a>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="td">
                  {typeof flow.userId === 'object' && flow.userId ? flow.userId.fullName || flow.userId.username : '-'}
                </td>
              </tr>
            ))}
            {!flows.isLoading && (flows.data?.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={8}>
                  Aucun mouvement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {openCreate && (
        <CashFlowCreateModal
          defaultFranchiseId={franchiseId || user?.franchiseId || ''}
          allowFranchiseSelect={isGlobal}
          franchises={franchises.data ?? []}
          onClose={() => setOpenCreate(false)}
          onSaved={() => {
            setOpenCreate(false);
            queryClient.invalidateQueries({ queryKey: ['cashflows'] });
          }}
        />
      )}
    </>
  );
}

function CashFlowCreateModal({
  defaultFranchiseId,
  allowFranchiseSelect,
  franchises,
  onClose,
  onSaved,
}: {
  defaultFranchiseId: string;
  allowFranchiseSelect: boolean;
  franchises: Franchise[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [franchiseId, setFranchiseId] = useState(defaultFranchiseId);
  const [type, setType] = useState<'encaissement' | 'decaissement'>('encaissement');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error('Motif requis');
      if (!allowFranchiseSelect && !franchiseId) throw new Error('Franchise requise');
      if (amount <= 0) throw new Error('Montant invalide');

      const formData = new FormData();
      if (franchiseId) formData.append('franchiseId', franchiseId);
      formData.append('type', type);
      formData.append('amount', String(amount));
      formData.append('reason', reason.trim());
      formData.append('reference', reference.trim());
      if (date) formData.append('date', date);
      if (attachment) formData.append('attachment', attachment);

      await api.post('/cashflows', formData);
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      title="Nouveau mouvement tresorerie"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {allowFranchiseSelect && (
          <div>
            <label className="label">Franchise</label>
            <select className="input" value={franchiseId} onChange={(event) => setFranchiseId(event.target.value)}>
              <option value="">Selectionner</option>
              {franchises.map((franchise) => (
                <option key={franchise._id} value={franchise._id}>
                  {franchise.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={(event) => setType(event.target.value as 'encaissement' | 'decaissement')}>
              <option value="encaissement">Encaissement</option>
              <option value="decaissement">Decaissement</option>
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Montant</label>
          <input
            type="number"
            min={0.01}
            step="0.01"
            className="input"
            value={amount}
            onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))}
          />
        </div>

        <div>
          <label className="label">Motif</label>
          <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>

        <div>
          <label className="label">Reference</label>
          <input className="input" value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>

        <div>
          <label className="label">Facture ou justificatif (image/pdf)</label>
          <input
            type="file"
            className="input"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
          />
          {attachment && <p className="mt-1 text-xs text-slate-500">{attachment.name}</p>}
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
