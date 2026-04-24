import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, uploadUrl } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { SearchableSelect, type SearchableSelectOption } from '../components/SearchableSelect';
import { dateOnly, dateTime, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import type { Franchise, Product, Reception, Supplier } from '../lib/types';

type ReceptionStatus = 'draft' | 'validated' | 'cancelled';

interface DraftLine {
  productId: string;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
}

interface OcrSuggestionLine {
  rawText: string;
  productName: string;
  productId: string | null;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
  confidence: number;
}

interface OcrResponse {
  documentPath: string;
  extraction: {
    engine: string;
    warnings: string[];
    textPreview: string;
  };
  suggestion: {
    header: {
      number?: string;
      receptionDate?: string;
      supplierName?: string;
      supplierId?: string | null;
    };
    lines: OcrSuggestionLine[];
  };
}

function receptionFranchiseName(reception: Reception): string {
  return typeof reception.franchiseId === 'object' && reception.franchiseId
    ? reception.franchiseId.name
    : '-';
}

function receptionSupplierName(reception: Reception): string {
  if (!reception.supplierId) return '-';
  if (typeof reception.supplierId === 'object') return reception.supplierId.name;
  return '-';
}

function lineProductId(
  product: string | Product,
): string {
  return typeof product === 'object' ? product._id : product;
}

function lineTotalTtc(line: DraftLine): number {
  const unitTtc = line.unitPriceHt * (1 + line.vatRate / 100);
  return unitTtc * line.quantity;
}

function toDateInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function isoDate(dateInput: string): string | undefined {
  if (!dateInput) return undefined;
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function ReceptionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isGlobal = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'superadmin';
  const defaultFranchiseId = isGlobal ? '' : user?.franchiseId ?? '';

  const [franchiseId, setFranchiseId] = useState(defaultFranchiseId);
  const [statusFilter, setStatusFilter] = useState<'' | ReceptionStatus>('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Reception | null>(null);
  const [error, setError] = useState<string | null>(null);

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ['franchises'],
    queryFn: async () => (await api.get<{ franchises: Franchise[] }>('/franchises')).data.franchises,
  });

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<{ suppliers: Supplier[] }>('/suppliers')).data.suppliers,
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

  const validateReception = useMutation({
    mutationFn: async (id: string) => api.post(`/receptions/${id}/validate`),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['receptions'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => setError(apiError(err).message),
  });

  const cancelReception = useMutation({
    mutationFn: async (id: string) => api.delete(`/receptions/${id}`),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['receptions'] });
    },
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <>
      <PageHeader
        title="Bons de reception"
        subtitle="Create, edit and validate reception notes with OCR-assisted line import"
        actions={
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + Nouveau bon
          </button>
        }
      />

      <section className="card mb-5 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
            <input
              className="input"
              disabled
              value={user?.franchiseId ? 'Franchise courante' : 'Aucune franchise'}
            />
          )}
          <select
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as '' | ReceptionStatus)}
          >
            <option value="">Tous statuts</option>
            <option value="draft">Brouillon</option>
            <option value="validated">Valide</option>
            <option value="cancelled">Annule</option>
          </select>
          <div className="self-center text-sm text-slate-500">
            {receptions.data?.length ?? 0} resultat(s)
          </div>
        </div>
        {error && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </section>

      <section className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Numero</th>
                <th className="th">Date</th>
                <th className="th">Franchise</th>
                <th className="th">Fournisseur</th>
                <th className="th">Statut</th>
                <th className="th text-right">Lignes</th>
                <th className="th text-right">Total TTC</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(receptions.data ?? []).map((reception) => (
                <tr key={reception._id}>
                  <td className="td font-medium">{reception.number}</td>
                  <td className="td">{dateTime(reception.createdAt)}</td>
                  <td className="td">{receptionFranchiseName(reception)}</td>
                  <td className="td">{receptionSupplierName(reception)}</td>
                  <td className="td capitalize">{reception.status}</td>
                  <td className="td text-right">{reception.lines.length}</td>
                  <td className="td text-right font-semibold">{money(reception.totalTtc)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-2">
                      {reception.status === 'draft' && (
                        <>
                          <button
                            className="btn-secondary !px-3 !py-1.5"
                            onClick={() => {
                              setEditing(reception);
                              setFormOpen(true);
                            }}
                          >
                            Modifier
                          </button>
                          <button
                            className="btn-secondary !px-3 !py-1.5"
                            disabled={validateReception.isPending}
                            onClick={() => validateReception.mutate(reception._id)}
                          >
                            Valider
                          </button>
                          <button
                            className="btn-danger !px-3 !py-1.5"
                            disabled={cancelReception.isPending}
                            onClick={() => cancelReception.mutate(reception._id)}
                          >
                            Annuler
                          </button>
                        </>
                      )}
                      {reception.status !== 'draft' && (
                        <button
                          className="btn-secondary !px-3 !py-1.5"
                          onClick={() => {
                            setEditing(reception);
                            setFormOpen(true);
                          }}
                        >
                          Voir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!receptions.isLoading && (receptions.data?.length ?? 0) === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={8}>
                    Aucun bon de reception.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {formOpen && (
        <ReceptionFormModal
          initial={editing}
          defaultFranchiseId={franchiseId || defaultFranchiseId}
          isGlobal={isGlobal}
          userFranchiseId={user?.franchiseId ?? null}
          franchises={franchises.data ?? []}
          suppliers={suppliers.data ?? []}
          products={products.data ?? []}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setFormOpen(false);
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['receptions'] });
            queryClient.invalidateQueries({ queryKey: ['stock'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      )}
    </>
  );
}

function ReceptionFormModal({
  initial,
  defaultFranchiseId,
  isGlobal,
  userFranchiseId,
  franchises,
  suppliers,
  products,
  onClose,
  onSaved,
}: {
  initial: Reception | null;
  defaultFranchiseId: string;
  isGlobal: boolean;
  userFranchiseId: string | null;
  franchises: Franchise[];
  suppliers: Supplier[];
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const canEdit = !initial || initial.status === 'draft';
  const [franchiseId, setFranchiseId] = useState(
    initial
      ? typeof initial.franchiseId === 'object'
        ? initial.franchiseId._id
        : initial.franchiseId
      : defaultFranchiseId || userFranchiseId || '',
  );
  const [supplierId, setSupplierId] = useState(
    initial
      ? typeof initial.supplierId === 'object'
        ? initial.supplierId._id
        : initial.supplierId ?? ''
      : '',
  );
  const [number, setNumber] = useState(initial?.number ?? '');
  const [receptionDate, setReceptionDate] = useState(toDateInput(initial?.receptionDate ?? initial?.createdAt ?? null));
  const [status, setStatus] = useState<'draft' | 'validated'>(initial?.status === 'validated' ? 'validated' : 'draft');
  const [note, setNote] = useState(initial?.note ?? '');
  const [sourceDocumentPath, setSourceDocumentPath] = useState(initial?.sourceDocumentPath ?? '');
  const [error, setError] = useState<string | null>(null);

  const [lines, setLines] = useState<DraftLine[]>(
    (initial?.lines ?? []).map((line) => ({
      productId: lineProductId(line.productId),
      quantity: line.quantity,
      unitPriceHt: line.unitPriceHt,
      vatRate: line.vatRate,
    })),
  );

  const [lineProductIdState, setLineProductIdState] = useState('');
  const [lineQuantity, setLineQuantity] = useState(1);
  const [lineUnitPriceHt, setLineUnitPriceHt] = useState(0);
  const [lineVatRate, setLineVatRate] = useState(19);
  const [lineEditIndex, setLineEditIndex] = useState<number | null>(null);

  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);

  const productMap = useMemo(() => new Map(products.map((product) => [product._id, product])), [products]);
  const supplierMap = useMemo(() => new Map(suppliers.map((supplier) => [supplier._id, supplier])), [suppliers]);
  const productOptions: SearchableSelectOption[] = useMemo(
    () =>
      products.map((product) => ({
        value: product._id,
        label: product.name,
        subtitle: [product.reference, product.brand].filter(Boolean).join(' | ') || undefined,
        keywords: [product.reference, product.barcode, product.brand].filter(Boolean).join(' '),
      })),
    [products],
  );

  const totals = useMemo(() => {
    const totalHt = lines.reduce((sum, line) => sum + line.unitPriceHt * line.quantity, 0);
    const totalTtc = lines.reduce((sum, line) => sum + lineTotalTtc(line), 0);
    return {
      totalHt,
      vat: totalTtc - totalHt,
      totalTtc,
    };
  }, [lines]);

  const save = useMutation({
    mutationFn: async () => {
      if (!franchiseId) throw new Error('Franchise requise');
      if (lines.length === 0) throw new Error('Ajoutez au moins une ligne');
      const payloadBase = {
        number: number || undefined,
        supplierId: supplierId || null,
        receptionDate: isoDate(receptionDate),
        note: note || undefined,
        sourceDocumentPath: sourceDocumentPath || undefined,
        lines: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPriceHt: line.unitPriceHt,
          vatRate: line.vatRate,
        })),
      };
      if (initial) {
        await api.patch(`/receptions/${initial._id}`, payloadBase);
      } else {
        await api.post('/receptions', {
          ...payloadBase,
          franchiseId,
          status,
        });
      }
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  const runOcr = useMutation({
    mutationFn: async () => {
      if (!ocrFile) throw new Error('Document OCR requis');
      const formData = new FormData();
      formData.append('document', ocrFile);
      const response = await api.post<OcrResponse>('/receptions/ocr', formData);
      return response.data;
    },
    onSuccess: (data) => {
      setError(null);
      setOcrResult(data);
      setSourceDocumentPath(data.documentPath);
    },
    onError: (err) => setError(apiError(err).message),
  });

  const addOrUpdateLine = () => {
    if (!lineProductIdState) {
      setError('Produit requis');
      return;
    }
    if (lineQuantity <= 0) {
      setError('Quantite invalide');
      return;
    }
    if (lineUnitPriceHt < 0) {
      setError('Prix invalide');
      return;
    }
    const line: DraftLine = {
      productId: lineProductIdState,
      quantity: lineQuantity,
      unitPriceHt: lineUnitPriceHt,
      vatRate: lineVatRate,
    };
    setLines((current) => {
      if (lineEditIndex === null) return [...current, line];
      return current.map((item, index) => (index === lineEditIndex ? line : item));
    });
    setLineEditIndex(null);
    setLineProductIdState('');
    setLineQuantity(1);
    setLineUnitPriceHt(0);
    setLineVatRate(19);
    setError(null);
  };

  const editLine = (index: number) => {
    const line = lines[index];
    if (!line) return;
    setLineEditIndex(index);
    setLineProductIdState(line.productId);
    setLineQuantity(line.quantity);
    setLineUnitPriceHt(line.unitPriceHt);
    setLineVatRate(line.vatRate);
  };

  const importOcrLines = () => {
    if (!ocrResult) return;
    const matchedLines = ocrResult.suggestion.lines
      .filter((line) => !!line.productId && line.quantity > 0)
      .map((line) => ({
        productId: line.productId as string,
        quantity: line.quantity,
        unitPriceHt: line.unitPriceHt,
        vatRate: line.vatRate,
      }));
    if (matchedLines.length === 0) {
      setError('OCR termine, mais aucune ligne n a pu etre rattachee a un produit existant.');
      return;
    }
    setLines((current) => [...current, ...matchedLines]);

    if (!number && ocrResult.suggestion.header.number) setNumber(ocrResult.suggestion.header.number);
    if (!receptionDate && ocrResult.suggestion.header.receptionDate) setReceptionDate(ocrResult.suggestion.header.receptionDate);
    if (!supplierId && ocrResult.suggestion.header.supplierId) setSupplierId(ocrResult.suggestion.header.supplierId);

    setError(null);
  };

  return (
    <Modal
      open
      size="lg"
      title={initial ? (canEdit ? 'Modifier bon de reception' : 'Details bon de reception') : 'Nouveau bon de reception'}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Fermer
          </button>
          {canEdit && (
            <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        <section className="grid gap-3 md:grid-cols-2">
          {isGlobal ? (
            <div>
              <label className="label">Franchise</label>
              <select className="input" value={franchiseId} disabled={!canEdit} onChange={(event) => setFranchiseId(event.target.value)}>
                <option value="">Selectionner</option>
                {franchises.map((franchise) => (
                  <option key={franchise._id} value={franchise._id}>
                    {franchise.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="label">Franchise</label>
              <input className="input" disabled value={franchiseId || '-'} />
            </div>
          )}
          <div>
            <label className="label">Fournisseur</label>
            <select className="input" value={supplierId} disabled={!canEdit} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">-</option>
              {suppliers.map((supplier) => (
                <option key={supplier._id} value={supplier._id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Numero</label>
            <input className="input" value={number} disabled={!canEdit} onChange={(event) => setNumber(event.target.value)} />
          </div>
          <div>
            <label className="label">Date reception</label>
            <input
              type="date"
              className="input"
              value={receptionDate}
              disabled={!canEdit}
              onChange={(event) => setReceptionDate(event.target.value)}
            />
          </div>
          {!initial && (
            <div>
              <label className="label">Mode creation</label>
              <select className="input" value={status} onChange={(event) => setStatus(event.target.value as 'draft' | 'validated')}>
                <option value="draft">Creer en brouillon</option>
                <option value="validated">Creer et valider</option>
              </select>
            </div>
          )}
          <div className="md:col-span-2">
            <label className="label">Note</label>
            <textarea
              rows={2}
              className="input"
              value={note}
              disabled={!canEdit}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {sourceDocumentPath && (
            <div className="md:col-span-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
              Document source: <a className="underline" href={uploadUrl(sourceDocumentPath)} target="_blank" rel="noreferrer">ouvrir</a>
            </div>
          )}
        </section>

        {canEdit && (
          <section className="rounded-2xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">OCR assistant</h3>
            <p className="mt-1 text-xs text-slate-500">
              Upload supplier document then import detected lines matched against existing products.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <input
                type="file"
                className="input"
                accept="image/*,.pdf,.txt"
                onChange={(event) => setOcrFile(event.target.files?.[0] ?? null)}
              />
              <button className="btn-secondary" disabled={!ocrFile || runOcr.isPending} onClick={() => runOcr.mutate()}>
                {runOcr.isPending ? 'OCR en cours...' : 'Analyser'}
              </button>
            </div>
            {ocrResult && (
              <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600">
                  Engine: <span className="font-semibold">{ocrResult.extraction.engine}</span>
                </div>
                {ocrResult.extraction.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {ocrResult.extraction.warnings.join(' ')}
                  </div>
                )}
                <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                  {ocrResult.extraction.textPreview || 'No text extracted.'}
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {ocrResult.suggestion.header.number && (
                    <span className="badge-info">Numero detecte: {ocrResult.suggestion.header.number}</span>
                  )}
                  {ocrResult.suggestion.header.receptionDate && (
                    <span className="badge-info">Date detectee: {dateOnly(ocrResult.suggestion.header.receptionDate)}</span>
                  )}
                  {ocrResult.suggestion.header.supplierName && (
                    <span className="badge-info">Fournisseur detecte: {ocrResult.suggestion.header.supplierName}</span>
                  )}
                </div>
                <div className="text-xs text-slate-600">
                  Lignes detectees: {ocrResult.suggestion.lines.length}
                </div>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="th">Produit OCR</th>
                        <th className="th">Match</th>
                        <th className="th text-right">Qty</th>
                        <th className="th text-right">PU HT</th>
                        <th className="th text-right">TVA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ocrResult.suggestion.lines.map((line, index) => (
                        <tr key={`${line.rawText}-${index}`}>
                          <td className="td">{line.productName}</td>
                          <td className="td">
                            {line.productId ? (
                              <span className="text-emerald-700">
                                {productMap.get(line.productId)?.name ?? line.productName} ({Math.round(line.confidence * 100)}%)
                              </span>
                            ) : (
                              <span className="text-rose-600">No match</span>
                            )}
                          </td>
                          <td className="td text-right">{line.quantity}</td>
                          <td className="td text-right">{money(line.unitPriceHt)}</td>
                          <td className="td text-right">{line.vatRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <button className="btn-primary" onClick={importOcrLines}>
                    Importer lignes OCR
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Lignes du bon</h3>
          {canEdit && (
            <div className="mt-3 grid gap-3 md:grid-cols-[2fr_100px_140px_100px_auto]">
              <SearchableSelect
                value={lineProductIdState}
                options={productOptions}
                placeholder="Search product..."
                onChange={setLineProductIdState}
              />
              <input
                type="number"
                min={0.001}
                step="0.001"
                className="input"
                value={lineQuantity}
                onChange={(event) => setLineQuantity(Math.max(0, Number(event.target.value) || 0))}
              />
              <input
                type="number"
                min={0}
                step="0.001"
                className="input"
                value={lineUnitPriceHt}
                onChange={(event) => setLineUnitPriceHt(Math.max(0, Number(event.target.value) || 0))}
              />
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                className="input"
                value={lineVatRate}
                onChange={(event) => setLineVatRate(Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
              />
              <button className="btn-secondary" onClick={addOrUpdateLine}>
                {lineEditIndex === null ? 'Ajouter' : 'Mettre a jour'}
              </button>
            </div>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Produit</th>
                  <th className="th text-right">Qty</th>
                  <th className="th text-right">PU HT</th>
                  <th className="th text-right">TVA</th>
                  <th className="th text-right">Total TTC</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={`${line.productId}-${index}`}>
                    <td className="td">
                      <div className="font-medium text-slate-900">
                        {productMap.get(line.productId)?.name ?? line.productId}
                      </div>
                      <div className="text-xs text-slate-500">
                        {[productMap.get(line.productId)?.reference, productMap.get(line.productId)?.brand].filter(Boolean).join(' | ')}
                      </div>
                    </td>
                    <td className="td text-right">{line.quantity}</td>
                    <td className="td text-right">{money(line.unitPriceHt)}</td>
                    <td className="td text-right">{line.vatRate}%</td>
                    <td className="td text-right font-semibold">{money(lineTotalTtc(line))}</td>
                    <td className="td">
                      <div className="flex justify-end gap-2">
                        {canEdit && (
                          <>
                            <button className="btn-secondary !px-3 !py-1.5" onClick={() => editLine(index)}>
                              Modifier
                            </button>
                            <button
                              className="btn-danger !px-3 !py-1.5"
                              onClick={() => setLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                            >
                              Supprimer
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td className="td text-slate-400" colSpan={6}>
                      Aucune ligne.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Total HT: <span className="font-semibold text-slate-900">{money(totals.totalHt)}</span>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
              TVA: <span className="font-semibold text-slate-900">{money(totals.vat)}</span>
            </div>
            <div className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">
              Total TTC: <span className="font-semibold">{money(totals.totalTtc)}</span>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!canEdit && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            This reception is {initial?.status}. Edition is disabled.
          </div>
        )}
      </div>
    </Modal>
  );
}
