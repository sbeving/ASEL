import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, uploadUrl } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { SearchableSelect, type SearchableSelectOption } from '../components/SearchableSelect';
import { dateOnly, dateTime, money } from '../lib/money';
import { useAuth } from '../auth/AuthContext';
import type { Franchise, Product, Reception, Supplier } from '../lib/types';
import {
  AlertTriangle,
  CheckCircle,
  ClipboardCheck,
  Eye,
  FileText,
  KeyRound,
  PackagePlus,
  Pencil,
  Plus,
  ScanLine,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';

type ReceptionStatus = 'draft' | 'validated' | 'cancelled';

interface DraftLine {
  productId?: string;
  productName?: string;
  productCreate?: {
    name: string;
    reference?: string;
    barcode?: string;
  };
  quantity: number;
  unitPriceHt: number;
  unitPriceTtc: number;
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

interface OcrSettings {
  googleAiStudioConfigured: boolean;
  googleAiStudioLast4?: string | null;
  googleAiStudioUpdatedAt?: string | null;
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

function roundMoney(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function unitTtcFromHt(ht: number, vatRate: number): number {
  return roundMoney(ht * (1 + vatRate / 100));
}

function unitHtFromTtc(ttc: number, vatRate: number): number {
  return roundMoney(vatRate > 0 ? ttc / (1 + vatRate / 100) : ttc);
}

function lineTotalTtc(line: DraftLine): number {
  return line.unitPriceTtc * line.quantity;
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

function statusLabel(status: ReceptionStatus): string {
  if (status === 'draft') return 'Brouillon';
  if (status === 'validated') return 'Valide';
  return 'Annule';
}

function statusBadge(status: ReceptionStatus): string {
  if (status === 'validated') return 'badge-success';
  if (status === 'cancelled') return 'badge-danger';
  return 'badge-warning';
}

function ocrStats(result: OcrResponse | null, overrides: Record<number, string>) {
  const lines = result?.suggestion.lines ?? [];
  const matched = lines.filter((line, index) => Boolean(overrides[index] || line.productId)).length;
  const usable = lines.filter((line) => line.quantity > 0 && line.productName.trim().length > 0).length;
  return {
    total: lines.length,
    matched,
    unmatched: Math.max(0, lines.length - matched),
    usable,
    averageConfidence:
      lines.length === 0 ? 0 : Math.round((lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length) * 100),
  };
}

function fileName(file: File | null): string {
  if (!file) return 'Aucun fichier selectionne';
  return `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`;
}

async function optimizeOcrImage(file: File): Promise<{ file: File; note: string | null }> {
  if (!file.type.startsWith('image/')) return { file, note: null };

  const image = await createImageBitmap(file);
  const maxEdge = 2400;
  const longest = Math.max(image.width, image.height);
  const scale = Math.min(1, maxEdge / longest);
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));

  if (scale === 1 && file.size <= 2_500_000) {
    image.close?.();
    return { file, note: null };
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    image.close?.();
    return { file, note: null };
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  image.close?.();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) return { file, note: null };

  const optimized = new File(
    [blob],
    `${file.name.replace(/\.[^.]+$/, '') || 'document'}-ocr.jpg`,
    { type: 'image/jpeg', lastModified: Date.now() },
  );

  if (optimized.size >= file.size && scale === 1) return { file, note: null };

  const beforeKb = Math.max(1, Math.round(file.size / 1024));
  const afterKb = Math.max(1, Math.round(optimized.size / 1024));
  return {
    file: optimized,
    note: `Image optimisee pour OCR: ${beforeKb} KB -> ${afterKb} KB (${targetWidth}x${targetHeight}).`,
  };
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
  const [startWithOcr, setStartWithOcr] = useState(false);

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

  const receptionRows = receptions.data ?? [];
  const receptionSummary = {
    total: receptionRows.length,
    draft: receptionRows.filter((reception) => reception.status === 'draft').length,
    validated: receptionRows.filter((reception) => reception.status === 'validated').length,
    totalTtc: receptionRows.reduce((sum, reception) => sum + reception.totalTtc, 0),
  };

  return (
    <>
      <PageHeader
        title="Bons de reception"
        subtitle="Saisie fournisseur, facture OCR et validation stock"
        actions={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <button
              className="btn-secondary"
              onClick={() => {
                setEditing(null);
                setStartWithOcr(true);
                setFormOpen(true);
              }}
            >
              <ScanLine className="h-4 w-4" />
              OCR facture
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setEditing(null);
                setStartWithOcr(false);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Nouveau bon
            </button>
          </div>
        }
      />

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-700 dark:bg-surface-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-surface-500">Bons filtres</span>
            <FileText className="h-4 w-4 text-surface-400" />
          </div>
          <div className="mt-2 text-2xl font-black text-surface-900 dark:text-white">{receptionSummary.total}</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-900/50 dark:bg-amber-900/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">A valider</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-amber-900 dark:text-amber-300">{receptionSummary.draft}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-900/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Valides</span>
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-900 dark:text-emerald-300">{receptionSummary.validated}</div>
        </div>
        <button
          type="button"
          className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-left shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-100 dark:border-brand-900/60 dark:bg-brand-900/20 dark:hover:bg-brand-900/30"
          onClick={() => {
            setEditing(null);
            setStartWithOcr(true);
            setFormOpen(true);
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">Assistant facture</span>
            <ScanLine className="h-4 w-4 text-brand-700 dark:text-brand-300" />
          </div>
          <div className="mt-2 text-sm font-bold text-brand-900 dark:text-brand-100">OCR + matching produit</div>
          <div className="mt-1 text-xs font-medium text-brand-700/80 dark:text-brand-300/80">Deposer PDF, image ou TXT</div>
        </button>
      </section>

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
          <div className="self-center rounded-xl bg-surface-50 px-3 py-2 text-sm font-semibold text-surface-600">
            {receptionSummary.total} resultat(s)
          </div>
        </div>
        {error && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      </section>

      <section className="card p-4">
        <div className="space-y-3 md:hidden">
          {receptionRows.map((reception) => (
            <div key={reception._id} className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-surface-900">{reception.number}</div>
                  <div className="mt-1 text-xs font-medium text-surface-500">{dateTime(reception.createdAt)}</div>
                </div>
                <span className={statusBadge(reception.status)}>{statusLabel(reception.status)}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-surface-50 px-3 py-2">
                  <div className="font-semibold text-surface-500">Fournisseur</div>
                  <div className="mt-1 truncate font-bold text-surface-900">{receptionSupplierName(reception)}</div>
                </div>
                <div className="rounded-lg bg-surface-50 px-3 py-2">
                  <div className="font-semibold text-surface-500">Total TTC</div>
                  <div className="mt-1 font-bold text-brand-700">{money(reception.totalTtc)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {reception.status === 'draft' ? (
                  <>
                    <button
                      className="btn-secondary !px-3 !py-1.5"
                      onClick={() => {
                        setEditing(reception);
                        setStartWithOcr(false);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Modifier
                    </button>
                    <button className="btn-secondary !px-3 !py-1.5" disabled={validateReception.isPending} onClick={() => validateReception.mutate(reception._id)}>
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      Valider
                    </button>
                    <button className="btn-danger !px-3 !py-1.5" disabled={cancelReception.isPending} onClick={() => cancelReception.mutate(reception._id)}>
                      <XCircle className="h-3.5 w-3.5" />
                      Annuler
                    </button>
                  </>
                ) : (
                  <button
                    className="btn-secondary !px-3 !py-1.5"
                    onClick={() => {
                      setEditing(reception);
                      setStartWithOcr(false);
                      setFormOpen(true);
                    }}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Voir
                  </button>
                )}
              </div>
            </div>
          ))}
          {!receptions.isLoading && receptionRows.length === 0 && (
            <div className="rounded-xl border border-dashed border-surface-300 bg-surface-50 p-6 text-center text-sm font-medium text-surface-500">
              Aucun bon de reception.
            </div>
          )}
        </div>
        <div className="hidden overflow-x-auto md:block">
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
                <th className="th-action">Actions</th>
              </tr>
            </thead>
            <tbody>
              {receptionRows.map((reception) => (
                <tr key={reception._id}>
                  <td className="td font-medium">{reception.number}</td>
                  <td className="td">{dateTime(reception.createdAt)}</td>
                  <td className="td">{receptionFranchiseName(reception)}</td>
                  <td className="td">{receptionSupplierName(reception)}</td>
                  <td className="td">
                    <span className={statusBadge(reception.status)}>{statusLabel(reception.status)}</span>
                  </td>
                  <td className="td text-right">{reception.lines.length}</td>
                  <td className="td text-right font-semibold">{money(reception.totalTtc)}</td>
                  <td className="td-action">
                    <div className="flex justify-end gap-2">
                      {reception.status === 'draft' && (
                        <>
                          <button
                            className="btn-secondary !px-3 !py-1.5"
                            onClick={() => {
                              setEditing(reception);
                              setStartWithOcr(false);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Modifier
                          </button>
                          <button
                            className="btn-secondary !px-3 !py-1.5"
                            disabled={validateReception.isPending}
                            onClick={() => validateReception.mutate(reception._id)}
                          >
                            <ClipboardCheck className="h-3.5 w-3.5" />
                            Valider
                          </button>
                          <button
                            className="btn-danger !px-3 !py-1.5"
                            disabled={cancelReception.isPending}
                            onClick={() => cancelReception.mutate(reception._id)}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Annuler
                          </button>
                        </>
                      )}
                      {reception.status !== 'draft' && (
                        <button
                          className="btn-secondary !px-3 !py-1.5"
                          onClick={() => {
                            setEditing(reception);
                            setStartWithOcr(false);
                            setFormOpen(true);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
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
          initialOcrFocus={startWithOcr}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
            setStartWithOcr(false);
          }}
          onSaved={() => {
            setFormOpen(false);
            setEditing(null);
            setStartWithOcr(false);
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
  initialOcrFocus,
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
  initialOcrFocus?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const { refresh } = useAuth();
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
      ? initial.supplierId && typeof initial.supplierId === 'object'
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
      unitPriceTtc: line.unitPriceTtc ?? unitTtcFromHt(line.unitPriceHt, line.vatRate),
      vatRate: line.vatRate,
    })),
  );

  const [lineMode, setLineMode] = useState<'existing' | 'new'>('existing');
  const [lineProductIdState, setLineProductIdState] = useState('');
  const [lineProductName, setLineProductName] = useState('');
  const [lineReference, setLineReference] = useState('');
  const [lineBarcode, setLineBarcode] = useState('');
  const [lineQuantity, setLineQuantity] = useState(1);
  const [lineUnitPriceHt, setLineUnitPriceHt] = useState(0);
  const [lineUnitPriceTtc, setLineUnitPriceTtc] = useState(0);
  const [lineVatRate, setLineVatRate] = useState(19);
  const [lineEditIndex, setLineEditIndex] = useState<number | null>(null);

  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrOptimizationNote, setOcrOptimizationNote] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);
  const [ocrLineProductOverrides, setOcrLineProductOverrides] = useState<Record<number, string>>({});
  const [ocrPanelOpen, setOcrPanelOpen] = useState(Boolean(initialOcrFocus));
  const [ocrApiKey, setOcrApiKey] = useState('');

  const ocrSettings = useQuery({
    queryKey: ['ocr-settings'],
    queryFn: async () => (await api.get<{ ocrSettings: OcrSettings }>('/auth/ocr-settings')).data.ocrSettings,
  });
  const hasOcrApiKey = Boolean(ocrSettings.data?.googleAiStudioConfigured);

  const saveOcrApiKey = useMutation({
    mutationFn: async () => {
      const apiKey = ocrApiKey.trim();
      if (!apiKey) throw new Error('Cle Google AI Studio requise');
      return (await api.put<{ ocrSettings: OcrSettings }>('/auth/ocr-settings/google-aistudio-key', { apiKey })).data.ocrSettings;
    },
    onSuccess: async () => {
      setError(null);
      setOcrApiKey('');
      await queryClient.invalidateQueries({ queryKey: ['ocr-settings'] });
      await refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : apiError(err).message),
  });

  const deleteOcrApiKey = useMutation({
    mutationFn: async () => (await api.delete<{ ocrSettings: OcrSettings }>('/auth/ocr-settings/google-aistudio-key')).data.ocrSettings,
    onSuccess: async () => {
      setError(null);
      setOcrApiKey('');
      setOcrResult(null);
      await queryClient.invalidateQueries({ queryKey: ['ocr-settings'] });
      await refresh();
    },
    onError: (err) => setError(apiError(err).message),
  });

  const productMap = useMemo(() => new Map(products.map((product) => [product._id, product])), [products]);
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
  const currentOcrStats = ocrStats(ocrResult, ocrLineProductOverrides);

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
          productId: line.productId || undefined,
          productName: line.productName || line.productCreate?.name || undefined,
          productCreate: line.productCreate,
          quantity: line.quantity,
          unitPriceHt: line.unitPriceHt,
          unitPriceTtc: line.unitPriceTtc,
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
      if (!hasOcrApiKey) throw new Error('Ajoutez votre cle Google AI Studio personnelle avant de lancer OCR.');
      const formData = new FormData();
      formData.append('document', ocrFile);
      const response = await api.post<OcrResponse>('/receptions/ocr', formData, { timeout: 180_000 });
      return response.data;
    },
    onSuccess: (data) => {
      setError(null);
      setOcrResult(data);
      setOcrLineProductOverrides({});
      setSourceDocumentPath(data.documentPath);
      if (!number && data.suggestion.header.number) setNumber(data.suggestion.header.number);
      if (!receptionDate && data.suggestion.header.receptionDate) {
        setReceptionDate(toDateInput(data.suggestion.header.receptionDate) || data.suggestion.header.receptionDate);
      }
      if (!supplierId && data.suggestion.header.supplierId) setSupplierId(data.suggestion.header.supplierId);
      setOcrPanelOpen(true);
    },
    onError: (err) => setError(err instanceof Error ? err.message : apiError(err).message),
  });

  const handleOcrFileSelected = async (file: File | null | undefined) => {
    setOcrResult(null);
    setOcrLineProductOverrides({});
    setOcrOptimizationNote(null);
    if (!file) {
      setOcrFile(null);
      return;
    }

    try {
      const optimized = await optimizeOcrImage(file);
      setOcrFile(optimized.file);
      setOcrOptimizationNote(optimized.note);
    } catch {
      setOcrFile(file);
      setOcrOptimizationNote('Image gardee originale: optimisation locale impossible.');
    }
  };

  const setHtPrice = (value: number) => {
    const next = Math.max(0, value);
    setLineUnitPriceHt(next);
    setLineUnitPriceTtc(unitTtcFromHt(next, lineVatRate));
  };

  const setTtcPrice = (value: number) => {
    const next = Math.max(0, value);
    setLineUnitPriceTtc(next);
    setLineUnitPriceHt(unitHtFromTtc(next, lineVatRate));
  };

  const setLineTax = (value: number) => {
    const next = Math.min(100, Math.max(0, value));
    setLineVatRate(next);
    setLineUnitPriceTtc(unitTtcFromHt(lineUnitPriceHt, next));
  };

  const addOrUpdateLine = () => {
    if (lineMode === 'existing' && !lineProductIdState) {
      setError('Produit requis');
      return;
    }
    if (lineMode === 'new' && !lineProductName.trim()) {
      setError('Nom du nouveau produit requis');
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
      productId: lineMode === 'existing' ? lineProductIdState : undefined,
      productName: lineMode === 'new' ? lineProductName.trim() : undefined,
      productCreate:
        lineMode === 'new'
          ? {
              name: lineProductName.trim(),
              reference: lineReference.trim() || undefined,
              barcode: lineBarcode.trim() || undefined,
            }
          : undefined,
      quantity: lineQuantity,
      unitPriceHt: lineUnitPriceHt,
      unitPriceTtc: lineUnitPriceTtc,
      vatRate: lineVatRate,
    };
    setLines((current) => {
      if (lineEditIndex === null) return [...current, line];
      return current.map((item, index) => (index === lineEditIndex ? line : item));
    });
    setLineEditIndex(null);
    setLineMode('existing');
    setLineProductIdState('');
    setLineProductName('');
    setLineReference('');
    setLineBarcode('');
    setLineQuantity(1);
    setLineUnitPriceHt(0);
    setLineUnitPriceTtc(0);
    setLineVatRate(19);
    setError(null);
  };

  const editLine = (index: number) => {
    const line = lines[index];
    if (!line) return;
    setLineEditIndex(index);
    setLineMode(line.productId ? 'existing' : 'new');
    setLineProductIdState(line.productId ?? '');
    setLineProductName(line.productCreate?.name ?? line.productName ?? '');
    setLineReference(line.productCreate?.reference ?? '');
    setLineBarcode(line.productCreate?.barcode ?? '');
    setLineQuantity(line.quantity);
    setLineUnitPriceHt(line.unitPriceHt);
    setLineUnitPriceTtc(line.unitPriceTtc);
    setLineVatRate(line.vatRate);
  };

  const importOcrLines = () => {
    if (!ocrResult) return;
    const matchedLines = ocrResult.suggestion.lines
      .map((line, index) => ({
        ...line,
        productId: ocrLineProductOverrides[index] || line.productId,
      }))
      .filter((line) => line.quantity > 0 && line.productName.trim().length > 0)
      .map((line) => ({
        productId: line.productId || undefined,
        productName: line.productId ? undefined : line.productName,
        productCreate: line.productId
          ? undefined
          : {
              name: line.productName,
            },
        quantity: line.quantity,
        unitPriceHt: line.unitPriceHt,
        unitPriceTtc: unitTtcFromHt(line.unitPriceHt, line.vatRate),
        vatRate: line.vatRate,
      }));
    if (matchedLines.length === 0) {
      setError('OCR termine, mais aucune ligne produit exploitable n a ete detectee.');
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
      size="xl"
      title={initial ? (canEdit ? 'Modifier bon de reception' : 'Details bon de reception') : 'Nouveau bon de reception'}
      onClose={onClose}
      footer={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:justify-end">
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
          <section className="rounded-xl border border-brand-200 bg-brand-50/70 p-4 dark:border-brand-900/60 dark:bg-brand-900/10">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => setOcrPanelOpen((value) => !value)}
            >
              <span className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white text-brand-700 shadow-sm dark:bg-brand-900/40 dark:text-brand-300">
                  <ScanLine className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-bold text-surface-900 dark:text-white">Assistant OCR facture</span>
                  <span className="block text-xs font-medium text-surface-500">Cle Google personnelle, puis validation du matching produit.</span>
                </span>
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
                {ocrPanelOpen ? 'Masquer' : 'Ouvrir'}
              </span>
            </button>

            {ocrPanelOpen && (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-surface-200 bg-white p-3 shadow-sm dark:border-surface-700 dark:bg-surface-900">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                        <KeyRound className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-surface-900 dark:text-white">Cle OCR personnelle</div>
                        <p className="mt-1 text-xs leading-5 text-surface-500">
                          OCR utilise votre propre cle Google AI Studio. L'entreprise ne consomme pas ses ressources pour cette analyse.
                        </p>
                        {hasOcrApiKey && (
                          <div className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            Cle active terminee par {ocrSettings.data?.googleAiStudioLast4 ?? '****'}.
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] lg:w-[430px]">
                      <input
                        className="input min-w-0"
                        type="password"
                        autoComplete="off"
                        placeholder={hasOcrApiKey ? 'Coller une nouvelle cle pour remplacer' : 'Coller votre cle Google AI Studio'}
                        value={ocrApiKey}
                        onChange={(event) => setOcrApiKey(event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={saveOcrApiKey.isPending || !ocrApiKey.trim()}
                        onClick={() => saveOcrApiKey.mutate()}
                      >
                        {saveOcrApiKey.isPending ? 'Sauvegarde...' : hasOcrApiKey ? 'Remplacer' : 'Activer'}
                      </button>
                      {hasOcrApiKey && (
                        <button
                          type="button"
                          className="btn-secondary sm:col-span-2"
                          disabled={deleteOcrApiKey.isPending}
                          onClick={() => deleteOcrApiKey.mutate()}
                        >
                          <Trash2 className="h-4 w-4" />
                          Retirer la cle OCR
                        </button>
                      )}
                    </div>
                  </div>
                  {!hasOcrApiKey && !ocrSettings.isLoading && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                      Analyse facture bloquee jusqu'a ce que votre compte ait sa propre cle API.
                    </div>
                  )}
                </div>

                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <label
                    htmlFor="ocr-document-input"
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-brand-300 bg-white p-4 transition-colors hover:border-brand-500 dark:border-brand-800 dark:bg-surface-900"
                  >
                    <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                      <Upload className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-surface-900 dark:text-white">{fileName(ocrFile)}</span>
                      <span className="block text-xs font-medium text-surface-500">Formats acceptes: PDF, image, TXT.</span>
                    </span>
                  </label>
                  <input
                    id="ocr-document-input"
                    type="file"
                    className="sr-only"
                    accept="image/*,.pdf,.txt"
                    onChange={(event) => void handleOcrFileSelected(event.target.files?.[0])}
                  />
                  <button
                    className="btn-primary min-h-[76px] lg:min-w-[180px]"
                    disabled={!ocrFile || runOcr.isPending || ocrSettings.isLoading || !hasOcrApiKey}
                    onClick={() => runOcr.mutate()}
                  >
                    {runOcr.isPending ? 'Analyse...' : 'Analyser facture'}
                  </button>
                </div>
                {ocrOptimizationNote && (
                  <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                    {ocrOptimizationNote}
                  </p>
                )}

                {ocrResult && (
                  <div className="space-y-4 rounded-xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-700 dark:bg-surface-900">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-lg bg-surface-50 px-3 py-2 dark:bg-surface-800">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500">Engine</div>
                        <div className="mt-1 truncate text-sm font-bold text-surface-900 dark:text-white">{ocrResult.extraction.engine}</div>
                      </div>
                      <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-900/10">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Matches</div>
                        <div className="mt-1 text-sm font-bold text-emerald-800 dark:text-emerald-300">{currentOcrStats.matched}/{currentOcrStats.total}</div>
                      </div>
                      <div className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-900/10">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">A revoir</div>
                        <div className="mt-1 text-sm font-bold text-amber-800 dark:text-amber-300">{currentOcrStats.unmatched}</div>
                      </div>
                      <div className="rounded-lg bg-surface-50 px-3 py-2 dark:bg-surface-800">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500">Confiance</div>
                        <div className="mt-1 text-sm font-bold text-surface-900 dark:text-white">{currentOcrStats.averageConfidence}%</div>
                      </div>
                    </div>

                    {ocrResult.extraction.warnings.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                        {ocrResult.extraction.warnings.join(' ')}
                      </div>
                    )}

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
                      <div className="max-h-32 overflow-y-auto rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-xs leading-5 text-surface-600 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-300">
                        {ocrResult.extraction.textPreview || 'No text extracted.'}
                      </div>
                      <div className="space-y-2 text-xs">
                        {ocrResult.suggestion.header.number && <span className="badge-info">Numero: {ocrResult.suggestion.header.number}</span>}
                        {ocrResult.suggestion.header.receptionDate && <span className="badge-info">Date: {dateOnly(ocrResult.suggestion.header.receptionDate)}</span>}
                        {ocrResult.suggestion.header.supplierName && <span className="badge-info">Fournisseur: {ocrResult.suggestion.header.supplierName}</span>}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-bold text-surface-900 dark:text-white">Lignes detectees</h4>
                        <span className="text-xs font-semibold text-surface-500">{currentOcrStats.usable} importable(s)</span>
                      </div>
                      <div className="grid max-h-[360px] gap-3 overflow-y-auto pr-1 custom-scrollbar lg:grid-cols-2">
                        {ocrResult.suggestion.lines.map((line, index) => {
                          const resolvedProductId = ocrLineProductOverrides[index] || line.productId || '';
                          return (
                            <div key={`${line.rawText}-${index}`} className="rounded-xl border border-surface-200 bg-surface-50 p-3 dark:border-surface-700 dark:bg-surface-950">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-bold text-surface-900 dark:text-white">{line.productName || 'Ligne OCR'}</div>
                                  <div className="mt-1 line-clamp-2 text-xs text-surface-500">{line.rawText}</div>
                                </div>
                                <span className={resolvedProductId ? 'badge-success' : 'badge-danger'}>
                                  {resolvedProductId ? `${Math.round(line.confidence * 100)}%` : 'No match'}
                                </span>
                              </div>
                              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                                <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-surface-900">
                                  <div className="font-semibold text-surface-500">Qty</div>
                                  <div className="font-bold text-surface-900 dark:text-white">{line.quantity}</div>
                                </div>
                                <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-surface-900">
                                  <div className="font-semibold text-surface-500">PU HT</div>
                                  <div className="font-bold text-surface-900 dark:text-white">{money(line.unitPriceHt)}</div>
                                </div>
                                <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-surface-900">
                                  <div className="font-semibold text-surface-500">TVA</div>
                                  <div className="font-bold text-surface-900 dark:text-white">{line.vatRate}%</div>
                                </div>
                              </div>
                              <div className="mt-3">
                                <label className="label">Produit associe</label>
                                <select
                                  className="input"
                                  value={resolvedProductId}
                                  onChange={(event) =>
                                    setOcrLineProductOverrides((current) => ({ ...current, [index]: event.target.value }))
                                  }
                                >
                                  <option value="">Aucun match</option>
                                  {products.map((product) => (
                                    <option key={product._id} value={product._id}>
                                      {[product.reference, product.name].filter(Boolean).join(' - ')}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 border-t border-surface-200 pt-4 dark:border-surface-700 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-xs font-medium text-surface-500">
                        Les lignes sans produit associe restent en attente et ne seront pas importees.
                      </div>
                      <button className="btn-primary" onClick={importOcrLines} disabled={currentOcrStats.usable === 0}>
                        <PackagePlus className="h-4 w-4" />
                        Importer {currentOcrStats.usable} ligne(s)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Lignes du bon</h3>
            {canEdit && (
              <div className="grid grid-cols-2 rounded-xl bg-surface-100 p-1 text-xs font-semibold">
                <button
                  type="button"
                  className={`rounded-lg px-3 py-2 ${lineMode === 'existing' ? 'bg-white text-brand-700 shadow-sm' : 'text-surface-500'}`}
                  onClick={() => setLineMode('existing')}
                >
                  Produit existant
                </button>
                <button
                  type="button"
                  className={`rounded-lg px-3 py-2 ${lineMode === 'new' ? 'bg-white text-brand-700 shadow-sm' : 'text-surface-500'}`}
                  onClick={() => setLineMode('new')}
                >
                  Nouveau produit
                </button>
              </div>
            )}
          </div>
          {canEdit && (
            <div className="mt-3 space-y-3 rounded-xl border border-surface-200 bg-surface-50 p-3">
              {lineMode === 'existing' ? (
                <div>
                  <label className="label">Produit</label>
                  <SearchableSelect
                    value={lineProductIdState}
                    options={productOptions}
                    placeholder="Rechercher un produit..."
                    onChange={setLineProductIdState}
                  />
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_180px_180px]">
                  <div>
                    <label className="label">Nom du nouveau produit</label>
                    <input
                      className="input"
                      value={lineProductName}
                      placeholder="Produit facture fournisseur..."
                      onChange={(event) => setLineProductName(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Reference</label>
                    <input className="input" value={lineReference} onChange={(event) => setLineReference(event.target.value)} />
                  </div>
                  <div>
                    <label className="label">Code barre</label>
                    <input className="input" value={lineBarcode} onChange={(event) => setLineBarcode(event.target.value)} />
                  </div>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-[110px_150px_110px_150px_auto]">
                <div>
                  <label className="label">Quantite</label>
                  <input
                    type="number"
                    min={0.001}
                    step="0.001"
                    className="input"
                    value={lineQuantity}
                    onChange={(event) => setLineQuantity(Math.max(0, Number(event.target.value) || 0))}
                  />
                </div>
                <div>
                  <label className="label">Prix HT</label>
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    className="input"
                    value={lineUnitPriceHt}
                    onChange={(event) => setHtPrice(Number(event.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="label">TVA %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    className="input"
                    value={lineVatRate}
                    onChange={(event) => setLineTax(Number(event.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="label">Prix TTC</label>
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    className="input"
                    value={lineUnitPriceTtc}
                    onChange={(event) => setTtcPrice(Number(event.target.value) || 0)}
                  />
                </div>
                <div className="flex items-end">
                  <button className="btn-secondary w-full" onClick={addOrUpdateLine}>
                    {lineEditIndex === null ? 'Ajouter' : 'Mettre a jour'}
                  </button>
                </div>
              </div>
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
	                  <tr key={`${line.productId || line.productName}-${index}`}>
	                    <td className="td">
	                      <div className="font-medium text-slate-900">
	                        {line.productId ? productMap.get(line.productId)?.name ?? line.productId : line.productName ?? line.productCreate?.name}
	                      </div>
	                      <div className="text-xs text-slate-500">
	                        {line.productId
	                          ? [productMap.get(line.productId)?.reference, productMap.get(line.productId)?.brand].filter(Boolean).join(' | ')
	                          : [line.productCreate?.reference, line.productCreate?.barcode, 'sera cree'].filter(Boolean).join(' | ')}
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
