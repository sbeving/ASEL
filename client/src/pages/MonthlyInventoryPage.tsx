import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { TablePagination } from '../components/TablePagination';
import { useDebouncedValue } from '../lib/hooks';
import type { Franchise, MonthlyInventory, PageMeta, StockItem } from '../lib/types';

interface CountLine {
  productId: string;
  name: string;
  reference?: string;
  systemQuantity: number;
  countedQuantity: number;
  note?: string;
}

function currentMonthValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function MonthlyInventoryPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'superadmin';

  const [selectedFid, setSelectedFid] = useState('');
  const effectiveFid = isGlobal ? selectedFid : user?.franchiseId ?? '';
  const [month, setMonth] = useState(currentMonthValue);

  const [inventoryPage, setInventoryPage] = useState(1);
  const [lineSearch, setLineSearch] = useState('');
  const debouncedLineSearch = useDebouncedValue(lineSearch, 200);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const inventories = useQuery({
    enabled: !!effectiveFid,
    queryKey: ['monthly-inventories', effectiveFid, month, inventoryPage],
    queryFn: async () =>
      (
        await api.get<{ inventories: MonthlyInventory[]; meta: PageMeta }>('/monthly-inventories', {
          params: { franchiseId: effectiveFid, month, page: inventoryPage, pageSize: 10 },
        })
      ).data,
  });

  const loadStockForCounting = useMutation({
    mutationFn: async () => {
      if (!effectiveFid) throw new Error('Selectionnez une franchise');

      const first = await api.get<{ items: StockItem[]; meta: PageMeta }>('/stock', {
        params: { franchiseId: effectiveFid, page: 1, pageSize: 500 },
      });
      const allItems = [...first.data.items];
      const totalPages = first.data.meta.totalPages;

      for (let page = 2; page <= totalPages; page += 1) {
        const next = await api.get<{ items: StockItem[] }>('/stock', {
          params: { franchiseId: effectiveFid, page, pageSize: 500 },
        });
        allItems.push(...next.data.items);
      }

      return allItems;
    },
    onSuccess: (items) => {
      setFormError(null);
      setLines(
        items.map((s) => ({
          productId: s.productId,
          name: s.product.name,
          reference: s.product.reference,
          systemQuantity: s.quantity,
          countedQuantity: s.quantity,
          note: '',
        })),
      );
    },
    onError: (err) => setFormError(apiError(err).message),
  });

  const saveInventory = useMutation({
    mutationFn: async (applyAdjustments: boolean) => {
      if (!effectiveFid) throw new Error('Selectionnez une franchise');
      if (!month) throw new Error('Mois requis');
      if (lines.length === 0) throw new Error('Chargez le stock avant enregistrement');

      await api.post('/monthly-inventories', {
        franchiseId: effectiveFid,
        month,
        applyAdjustments,
        lines: lines.map((l) => ({
          productId: l.productId,
          countedQuantity: l.countedQuantity,
          note: l.note || undefined,
        })),
      });
    },
    onSuccess: () => {
      setFormError(null);
      qc.invalidateQueries({ queryKey: ['monthly-inventories'] });
    },
    onError: (err) => setFormError(apiError(err).message),
  });

  const filteredLines = useMemo(() => {
    if (!debouncedLineSearch) return lines;
    const q = debouncedLineSearch.toLowerCase();
    return lines.filter((line) =>
      [line.name, line.reference ?? ''].some((value) => value.toLowerCase().includes(q)),
    );
  }, [lines, debouncedLineSearch]);

  return (
    <>
      <PageHeader title="Inventaire mensuel" subtitle="Comptage physique et ajustements de stock" />

      <section className="card p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {isGlobal ? (
            <select className="input" value={selectedFid} onChange={(e) => setSelectedFid(e.target.value)}>
              <option value="">Selectionner franchise</option>
              {(franchises.data ?? []).map((f) => (
                <option key={f._id} value={f._id}>{f.name}</option>
              ))}
            </select>
          ) : (
            <div className="input bg-slate-50">Franchise courante</div>
          )}

          <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />

          <button
            type="button"
            className="btn-secondary"
            disabled={!effectiveFid || loadStockForCounting.isPending}
            onClick={() => loadStockForCounting.mutate()}
          >
            {loadStockForCounting.isPending ? 'Chargement...' : 'Charger stock du mois'}
          </button>

          <input
            type="search"
            className="input"
            value={lineSearch}
            onChange={(e) => setLineSearch(e.target.value)}
            placeholder="Filtrer les lignes..."
          />
        </div>

        {formError && <div className="mt-3 text-sm text-rose-600">{formError}</div>}
      </section>

      <section className="card overflow-x-auto mb-5">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Produit</th>
              <th className="th">Reference</th>
              <th className="th text-right">Stock systeme</th>
              <th className="th text-right">Compte physique</th>
              <th className="th text-right">Ecart</th>
              <th className="th">Note</th>
            </tr>
          </thead>
          <tbody>
            {filteredLines.map((line) => {
              const variance = line.countedQuantity - line.systemQuantity;
              return (
                <tr key={line.productId}>
                  <td className="td font-medium">{line.name}</td>
                  <td className="td text-slate-500">{line.reference ?? '-'}</td>
                  <td className="td text-right">{line.systemQuantity}</td>
                  <td className="td text-right">
                    <input
                      type="number"
                      min={0}
                      className="input !py-1 !px-2 w-24 ml-auto"
                      value={line.countedQuantity}
                      onChange={(e) => {
                        const next = Math.max(0, Number(e.target.value) || 0);
                        setLines((prev) =>
                          prev.map((l) => (l.productId === line.productId ? { ...l, countedQuantity: next } : l)),
                        );
                      }}
                    />
                  </td>
                  <td className={`td text-right font-semibold ${variance === 0 ? 'text-slate-600' : variance > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {variance > 0 ? `+${variance}` : variance}
                  </td>
                  <td className="td">
                    <input
                      className="input !py-1 !px-2"
                      value={line.note ?? ''}
                      onChange={(e) => {
                        const next = e.target.value;
                        setLines((prev) =>
                          prev.map((l) => (l.productId === line.productId ? { ...l, note: next } : l)),
                        );
                      }}
                    />
                  </td>
                </tr>
              );
            })}
            {!loadStockForCounting.isPending && filteredLines.length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={6}>Aucune ligne. Chargez le stock pour demarrer l'inventaire.</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="p-3 border-t border-slate-200 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            className="btn-secondary"
            disabled={lines.length === 0 || saveInventory.isPending}
            onClick={() => saveInventory.mutate(false)}
          >
            Sauvegarder brouillon
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={lines.length === 0 || saveInventory.isPending}
            onClick={() => saveInventory.mutate(true)}
          >
            {saveInventory.isPending ? 'Validation...' : 'Valider + ajuster stock'}
          </button>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold mb-3">Historique mensuel</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Mois</th>
                <th className="th">Statut</th>
                <th className="th text-right">Stock systeme</th>
                <th className="th text-right">Compte physique</th>
                <th className="th text-right">Ecart total</th>
                <th className="th">Ajustements</th>
              </tr>
            </thead>
            <tbody>
              {(inventories.data?.inventories ?? []).map((inv) => (
                <tr key={inv._id}>
                  <td className="td font-medium">{inv.month}</td>
                  <td className="td">
                    {inv.status === 'finalized' ? <span className="badge-success">finalise</span> : <span className="badge-warning">brouillon</span>}
                  </td>
                  <td className="td text-right">{inv.totalSystemQuantity}</td>
                  <td className="td text-right">{inv.totalCountedQuantity}</td>
                  <td className={`td text-right font-semibold ${inv.totalVariance === 0 ? 'text-slate-600' : inv.totalVariance > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {inv.totalVariance > 0 ? `+${inv.totalVariance}` : inv.totalVariance}
                  </td>
                  <td className="td">{inv.appliedAdjustments ? 'Oui' : 'Non'}</td>
                </tr>
              ))}
              {!inventories.isLoading && (inventories.data?.inventories.length ?? 0) === 0 && (
                <tr><td className="td text-slate-400" colSpan={6}>Aucun inventaire pour ce mois.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination meta={inventories.data?.meta} onPageChange={setInventoryPage} />
      </section>
    </>
  );
}
