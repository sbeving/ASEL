import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, PackageSearch, RotateCcw, Save, ScanLine, Search, Trash2 } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { TablePagination } from '../components/TablePagination';
import { ScannerModal } from '../components/ScannerModal';
import { useDebouncedValue } from '../lib/hooks';
import type { Franchise, MonthlyInventory, PageMeta, StockItem } from '../lib/types';

interface CountLine {
  productId: string;
  name: string;
  reference?: string;
  barcode?: string;
  systemQuantity: number;
  countedQuantity: number;
  note?: string;
  applied?: boolean;
}

function currentMonthValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function normalizeCode(value: string) {
  return value.trim().toLowerCase();
}

export function MonthlyInventoryPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isGlobal =
    user?.role === 'ceo' ||
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    user?.role === 'superadmin' ||
    user?.role === 'stock_central_maintainer';
  const canAdminInventory = isGlobal;

  const [selectedFid, setSelectedFid] = useState('');
  const effectiveFid = isGlobal ? selectedFid : user?.franchiseId ?? '';
  const [month, setMonth] = useState(currentMonthValue);
  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(null);

  const [inventoryPage, setInventoryPage] = useState(1);
  const [lineSearch, setLineSearch] = useState('');
  const debouncedLineSearch = useDebouncedValue(lineSearch, 200);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [scanQuantity, setScanQuantity] = useState(1);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [lastAppliedProductId, setLastAppliedProductId] = useState('');

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
      setSelectedProductId('');
      setManualBarcode('');
      setLastAppliedProductId('');
      setLines(
        items.map((s) => ({
          productId: s.productId,
          name: s.product.name,
          reference: s.product.reference,
          barcode: s.product.barcode,
          systemQuantity: s.quantity,
          countedQuantity: s.quantity,
          note: '',
          applied: false,
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

      const payload = {
        franchiseId: effectiveFid,
        month,
        applyAdjustments,
        lines: lines.map((l) => ({
          productId: l.productId,
          countedQuantity: l.countedQuantity,
          note: l.note || undefined,
        })),
      };

      if (editingInventoryId) await api.patch(`/monthly-inventories/${editingInventoryId}`, payload);
      else await api.post('/monthly-inventories', payload);
    },
    onSuccess: () => {
      setFormError(null);
      setEditingInventoryId(null);
      qc.invalidateQueries({ queryKey: ['monthly-inventories'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (err) => setFormError(apiError(err).message),
  });

  const loadInventoryForEdit = useMutation({
    mutationFn: async (id: string) => (await api.get<{ inventory: MonthlyInventory }>(`/monthly-inventories/${id}`)).data.inventory,
    onSuccess: (inventory) => {
      const fid = typeof inventory.franchiseId === 'object' ? inventory.franchiseId._id : String(inventory.franchiseId);
      setFormError(null);
      setEditingInventoryId(inventory._id);
      setSelectedFid(fid);
      setMonth(inventory.month);
      setLines(
        inventory.lines.map((line) => {
          const product = typeof line.productId === 'object' ? line.productId : null;
          return {
            productId: product?._id ?? String(line.productId),
            name: product?.name ?? 'Produit',
            reference: product?.reference,
            barcode: product?.barcode,
            systemQuantity: line.systemQuantity,
            countedQuantity: line.countedQuantity,
            note: line.note ?? '',
            applied: true,
          };
        }),
      );
    },
    onError: (err) => setFormError(apiError(err).message),
  });

  const deleteInventory = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/monthly-inventories/${id}`);
    },
    onSuccess: () => {
      setFormError(null);
      setEditingInventoryId(null);
      qc.invalidateQueries({ queryKey: ['monthly-inventories'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (err) => setFormError(apiError(err).message),
  });

  const filteredLines = useMemo(() => {
    if (!debouncedLineSearch) return lines;
    const q = debouncedLineSearch.toLowerCase();
    return lines.filter((line) =>
      [line.name, line.reference ?? '', line.barcode ?? ''].some((value) => value.toLowerCase().includes(q)),
    );
  }, [lines, debouncedLineSearch]);

  const selectedLine = useMemo(
    () => lines.find((line) => line.productId === selectedProductId) ?? null,
    [lines, selectedProductId],
  );

  const inventoryStats = useMemo(() => {
    const totalSystem = lines.reduce((sum, line) => sum + line.systemQuantity, 0);
    const totalCounted = lines.reduce((sum, line) => sum + line.countedQuantity, 0);
    const totalVariance = totalCounted - totalSystem;
    const changedLines = lines.filter((line) => line.countedQuantity !== line.systemQuantity).length;
    const appliedLines = lines.filter((line) => line.applied).length;
    return { totalSystem, totalCounted, totalVariance, changedLines, appliedLines };
  }, [lines]);

  const selectLineByCode = (code: string, syncQuantity = true) => {
    const clean = normalizeCode(code);
    if (!clean) return null;
    const match = lines.find((line) =>
      [line.barcode, line.reference, line.productId].filter(Boolean).some((value) => normalizeCode(String(value)) === clean),
    );
    if (!match) {
      setSelectedProductId('');
      setLineSearch(code.trim());
      setFormError(`Produit introuvable pour le code: ${code.trim()}`);
      return null;
    }
    setFormError(null);
    setScannerError(null);
    setSelectedProductId(match.productId);
    setManualBarcode(code.trim());
    setLineSearch(code.trim());
    if (syncQuantity) setScanQuantity(match.countedQuantity);
    return match;
  };

  const applyQuantityToLine = (productId: string, quantity: number) => {
    const nextQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
    setLines((prev) =>
      prev.map((line) =>
        line.productId === productId
          ? { ...line, countedQuantity: nextQuantity, applied: true }
          : line,
      ),
    );
    setLastAppliedProductId(productId);
    setLineSearch('');
    setFormError(null);
  };

  const handleScannerCode = (code: string) => {
    const match = selectLineByCode(code, false);
    if (match) {
      applyQuantityToLine(match.productId, scanQuantity);
      setScannerOpen(false);
    }
  };

  return (
    <>
      <PageHeader title="Inventaire mensuel" subtitle="Comptage physique et ajustements de stock" />

      <section className="card mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[220px_170px_auto_minmax(0,1fr)_auto]">
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
            <PackageSearch className="h-4 w-4" />
            {loadStockForCounting.isPending ? 'Chargement...' : 'Charger stock'}
          </button>

          <input
            type="search"
            className="input"
            value={lineSearch}
            onChange={(e) => setLineSearch(e.target.value)}
            placeholder="Filtrer nom, reference, barcode..."
          />
          <button type="button" className="btn-secondary" disabled={!lineSearch} onClick={() => setLineSearch('')}>
            <RotateCcw className="h-4 w-4" />
            Effacer
          </button>
        </div>

        {formError && <div className="mt-3 text-sm text-rose-600">{formError}</div>}
        {editingInventoryId && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
            <span>Mode correction inventaire. Les ajustements deja finalises seront recalcules proprement.</span>
            <button
              type="button"
              className="btn-secondary !min-h-[34px] !px-3 !py-1"
              onClick={() => {
                setEditingInventoryId(null);
                setLines([]);
              }}
            >
              Annuler correction
            </button>
          </div>
        )}
      </section>

      <section className="card mb-5 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_140px_auto_auto]">
          <form
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              selectLineByCode(manualBarcode);
            }}
          >
            <div>
              <label className="label">Barcode / reference</label>
              <input
                className="input"
                value={manualBarcode}
                onChange={(event) => setManualBarcode(event.target.value)}
                placeholder="Scanner ou coller le code"
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn-secondary self-end" disabled={!lines.length || !manualBarcode.trim()}>
              <Search className="h-4 w-4" />
              Trouver
            </button>
          </form>

          <div>
            <label className="label">Qty comptee</label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className="input"
              value={scanQuantity}
              onChange={(event) => setScanQuantity(Math.max(0, Number(event.target.value) || 0))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && selectedLine) {
                  event.preventDefault();
                  applyQuantityToLine(selectedLine.productId, scanQuantity);
                }
              }}
            />
          </div>

          <button
            type="button"
            className="btn-secondary self-end"
            disabled={!effectiveFid || !lines.length}
            onClick={() => {
              setScannerError(null);
              setScannerOpen(true);
            }}
          >
            <ScanLine className="h-4 w-4" />
            Scanner
          </button>

          <button
            type="button"
            className="btn-primary self-end"
            disabled={!selectedLine}
            onClick={() => selectedLine && applyQuantityToLine(selectedLine.productId, scanQuantity)}
          >
            <CheckCircle2 className="h-4 w-4" />
            Appliquer qty
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Le scan applique automatiquement la quantite ci-dessus au produit trouve. Pour verifier sans changer, utilisez Trouver.
        </div>

        {selectedLine && (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-bold">{selectedLine.name}</div>
              <div className="mt-0.5 text-xs text-emerald-800">
                Ref: {selectedLine.reference || '-'} | Barcode: {selectedLine.barcode || '-'} | Systeme: {selectedLine.systemQuantity} | Actuel: {selectedLine.countedQuantity}
              </div>
            </div>
            {selectedLine.applied && <span className="badge-success">compte</span>}
          </div>
        )}
        {scannerError && <div className="mt-3 text-sm text-rose-600">{scannerError}</div>}
      </section>

      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Lignes chargees" value={String(lines.length)} />
        <MetricCard label="Lignes comptees" value={`${inventoryStats.appliedLines}/${lines.length}`} />
        <MetricCard label="Stock systeme" value={String(inventoryStats.totalSystem)} />
        <MetricCard label="Compte physique" value={String(inventoryStats.totalCounted)} />
        <MetricCard
          label="Ecart / lignes"
          value={`${inventoryStats.totalVariance > 0 ? '+' : ''}${inventoryStats.totalVariance} / ${inventoryStats.changedLines}`}
        />
      </section>

      <section className="mb-5 grid gap-3 lg:hidden">
        {filteredLines.map((line) => {
          const variance = line.countedQuantity - line.systemQuantity;
          return (
            <article
              key={line.productId}
              className={`mobile-record-card space-y-3 ${lastAppliedProductId === line.productId ? 'border-emerald-300 bg-emerald-50/70' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {line.applied && <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600" />}
                    <div className="truncate font-semibold text-surface-900">{line.name}</div>
                  </div>
                  <div className="mt-1 text-xs text-surface-500">{[line.reference, line.barcode].filter(Boolean).join(' | ') || 'Sans reference'}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={line.applied ? 'badge-success' : 'badge-warning'}>{line.applied ? 'compte' : 'a compter'}</span>
                  <span className={variance === 0 ? 'badge-muted' : variance > 0 ? 'badge-success' : 'badge-danger'}>
                    {variance > 0 ? `+${variance}` : variance}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Stock systeme</label>
                  <input className="input" disabled value={line.systemQuantity} />
                </div>
                <div>
                  <label className="label">Compte physique</label>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="input"
                    value={line.countedQuantity}
                    onChange={(e) => {
                      const next = Math.max(0, Number(e.target.value) || 0);
                      setLines((prev) =>
                        prev.map((l) => (l.productId === line.productId ? { ...l, countedQuantity: next, applied: true } : l)),
                      );
                      setLastAppliedProductId(line.productId);
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="label">Note</label>
                <input
                  className="input"
                  value={line.note ?? ''}
                  onChange={(e) => {
                    const next = e.target.value;
                    setLines((prev) =>
                      prev.map((l) => (l.productId === line.productId ? { ...l, note: next } : l)),
                    );
                  }}
                />
              </div>
            </article>
          );
        })}
        {!loadStockForCounting.isPending && filteredLines.length === 0 && (
          <div className="mobile-record-card text-sm text-surface-500">
            Aucune ligne. Chargez le stock pour demarrer l'inventaire.
          </div>
        )}
      </section>

      <section className="card mb-5 overflow-hidden">
        <div className="hidden overflow-x-auto lg:block">
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
                  <tr key={line.productId} className={lastAppliedProductId === line.productId ? 'bg-emerald-50/70' : undefined}>
                    <td className="td font-medium">
                      <div className="flex items-center gap-2">
                        {line.applied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <span className="h-4 w-4 rounded-full border border-amber-300 bg-amber-50" />}
                        <span>{line.name}</span>
                        <span className={line.applied ? 'badge-success' : 'badge-warning'}>{line.applied ? 'compte' : 'a compter'}</span>
                      </div>
                    </td>
                    <td className="td text-slate-500">
                      <div>{line.reference ?? '-'}</div>
                      {line.barcode && <div className="mt-1 text-xs text-slate-400">{line.barcode}</div>}
                    </td>
                    <td className="td text-right">{line.systemQuantity}</td>
                    <td className="td text-right">
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="input ml-auto w-24 !px-2 !py-1"
                        value={line.countedQuantity}
                        onChange={(e) => {
                          const next = Math.max(0, Number(e.target.value) || 0);
                          setLines((prev) =>
                            prev.map((l) => (l.productId === line.productId ? { ...l, countedQuantity: next, applied: true } : l)),
                          );
                          setLastAppliedProductId(line.productId);
                        }}
                      />
                    </td>
                    <td className={`td text-right font-semibold ${variance === 0 ? 'text-slate-600' : variance > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {variance > 0 ? `+${variance}` : variance}
                    </td>
                    <td className="td">
                      <input
                        className="input !px-2 !py-1"
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
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 p-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-secondary"
            disabled={lines.length === 0 || saveInventory.isPending}
            onClick={() => saveInventory.mutate(false)}
          >
            <Save className="h-4 w-4" />
            {editingInventoryId ? 'Mettre a jour brouillon' : 'Sauvegarder brouillon'}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={lines.length === 0 || saveInventory.isPending}
            onClick={() => saveInventory.mutate(true)}
          >
            <CheckCircle2 className="h-4 w-4" />
            {saveInventory.isPending ? 'Validation...' : editingInventoryId ? 'Enregistrer + ajuster' : 'Valider + ajuster stock'}
          </button>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold mb-3">Historique mensuel</h2>
        <div className="grid gap-3 lg:hidden">
          {(inventories.data?.inventories ?? []).map((inv) => (
            <article key={inv._id} className="mobile-record-card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-surface-900">{inv.month}</div>
                  <div className="mt-1 text-xs text-surface-500">Ajustements: {inv.appliedAdjustments ? 'Oui' : 'Non'}</div>
                </div>
                {inv.status === 'finalized' ? <span className="badge-success">finalise</span> : <span className="badge-warning">brouillon</span>}
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="mobile-record-label">Systeme</div>
                  <div className="mt-1 font-semibold text-surface-900">{inv.totalSystemQuantity}</div>
                </div>
                <div className="text-center">
                  <div className="mobile-record-label">Physique</div>
                  <div className="mt-1 font-semibold text-surface-900">{inv.totalCountedQuantity}</div>
                </div>
                <div className="text-right">
                  <div className="mobile-record-label">Ecart</div>
                  <div className={inv.totalVariance === 0 ? 'mt-1 font-semibold text-surface-700' : inv.totalVariance > 0 ? 'mt-1 font-semibold text-emerald-700' : 'mt-1 font-semibold text-rose-700'}>
                    {inv.totalVariance > 0 ? `+${inv.totalVariance}` : inv.totalVariance}
                  </div>
                </div>
              </div>
              {canAdminInventory && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="btn-secondary w-full"
                    disabled={loadInventoryForEdit.isPending}
                    onClick={() => loadInventoryForEdit.mutate(inv._id)}
                  >
                    <Pencil className="h-4 w-4" />
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="btn-danger w-full"
                    disabled={deleteInventory.isPending}
                    onClick={() => {
                      if (window.confirm('Supprimer cet inventaire et annuler ses ajustements ?')) deleteInventory.mutate(inv._id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Supprimer
                  </button>
                </div>
              )}
            </article>
          ))}
          {!inventories.isLoading && (inventories.data?.inventories.length ?? 0) === 0 && (
            <div className="mobile-record-card text-sm text-surface-500">Aucun inventaire pour ce mois.</div>
          )}
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Mois</th>
                <th className="th">Statut</th>
                <th className="th text-right">Stock systeme</th>
                <th className="th text-right">Compte physique</th>
                <th className="th text-right">Ecart total</th>
                <th className="th">Ajustements</th>
                {canAdminInventory && <th className="th-action">Action</th>}
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
                  {canAdminInventory && (
                    <td className="td-action">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn-secondary !min-h-[34px] !px-3 !py-1"
                          disabled={loadInventoryForEdit.isPending}
                          onClick={() => loadInventoryForEdit.mutate(inv._id)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-danger !min-h-[34px] !px-3 !py-1"
                          disabled={deleteInventory.isPending}
                          onClick={() => {
                            if (window.confirm('Supprimer cet inventaire et annuler ses ajustements ?')) deleteInventory.mutate(inv._id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Supprimer
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!inventories.isLoading && (inventories.data?.inventories.length ?? 0) === 0 && (
                <tr><td className="td text-slate-400" colSpan={canAdminInventory ? 7 : 6}>Aucun inventaire pour ce mois.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination meta={inventories.data?.meta} onPageChange={setInventoryPage} />
      </section>

      {scannerOpen && (
        <ScannerModal
          onClose={() => setScannerOpen(false)}
          onError={setScannerError}
          onScan={handleScannerCode}
        />
      )}
    </>
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
