import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { TablePagination } from '../components/TablePagination';
import { useDebouncedValue } from '../lib/hooks';
import type { PageMeta } from '../lib/types';

interface ClientRow {
  _id: string;
  fullName: string;
  phone?: string;
  email?: string;
  clientType: 'walkin' | 'boutique' | 'wholesale' | 'passager' | 'other';
  active: boolean;
  createdAt: string;
}

export function ClientsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 250);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [clientType, setClientType] = useState<ClientRow['clientType']>('walkin');
  const [err, setErr] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['clients', debouncedQ, page],
    queryFn: async () =>
      (
        await api.get<{ clients: ClientRow[]; meta: PageMeta }>('/clients', {
          params: { q: debouncedQ || undefined, page, pageSize },
        })
      ).data,
  });

  const create = useMutation({
    mutationFn: async () => {
      await api.post('/clients', {
        fullName,
        phone,
        clientType,
      });
    },
    onSuccess: () => {
      setFullName('');
      setPhone('');
      setClientType('walkin');
      setErr(null);
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (e) => setErr(apiError(e).message),
  });

  return (
    <>
      <PageHeader title="Clients" subtitle="Base clients legacy-compatible" />

      <section className="card p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className="input" placeholder="Nom complet" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <input className="input" placeholder="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <select className="input" value={clientType} onChange={(e) => setClientType(e.target.value as ClientRow['clientType'])}>
            <option value="walkin">Passage</option>
            <option value="boutique">Boutique</option>
            <option value="wholesale">Grossiste</option>
            <option value="passager">Passager</option>
            <option value="other">Autre</option>
          </select>
          <button className="btn-primary" disabled={!fullName || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Ajout…' : 'Ajouter client'}
          </button>
        </div>
        {err && <div className="mt-3 text-sm text-rose-600">{err}</div>}
      </section>

      <section className="card p-4">
        <div className="mb-3">
          <input
            className="input"
            placeholder="Recherche (nom / téléphone / email)"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Nom</th>
                <th className="th">Téléphone</th>
                <th className="th">Type</th>
                <th className="th">Email</th>
              </tr>
            </thead>
            <tbody>
              {(query.data?.clients ?? []).map((c) => (
                <tr key={c._id}>
                  <td className="td font-medium">{c.fullName}</td>
                  <td className="td">{c.phone || '—'}</td>
                  <td className="td capitalize">{c.clientType}</td>
                  <td className="td">{c.email || '—'}</td>
                </tr>
              ))}
              {!query.isLoading && (query.data?.clients.length ?? 0) === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={4}>Aucun client trouvé.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination meta={query.data?.meta} onPageChange={setPage} />
      </section>
    </>
  );
}
