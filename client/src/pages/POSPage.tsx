import { useMemo, useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ScanLine,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  CreditCard,
  Banknote,
  Landmark,
  CalendarClock,
  Receipt,
  FileText,
  FileSignature,
  AlertCircle,
  CheckCircle2,
  Store,
  Package,
  ChevronLeft,
  ChevronRight,
  PauseCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { api, apiError } from "../lib/api";
import { money } from "../lib/money";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { useDebouncedValue } from "../lib/hooks";
import type {
  Client,
  Franchise,
  Installment,
  Product,
  Sale,
  StockItem,
} from "../lib/types";
import { ScannerModal } from "../components/ScannerModal";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "../components/SearchableSelect";
import clsx from "clsx";

interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  available: number;
  reference?: string;
  productType?: Product["productType"];
  priceMode?: Product["priceMode"];
  stockManaged: boolean;
}

interface HeldSaleDraft {
  id: string;
  name: string;
  createdAt: string;
  franchiseId: string;
  cart: CartLine[];
  discount: number;
  saleType: SaleType;
  paymentMethod: PaymentMethod;
  clientId: string;
  amountReceived: string;
  creditOverrideReason: string;
  discountApprovalReason: string;
  note: string;
  nbLots: number;
  intervalDays: number;
  firstDueDate: string;
}

type PaymentMethod = Sale["paymentMethod"];
type SaleType = Sale["saleType"];

const paymentMethodConfig: Record<
  PaymentMethod,
  { label: string; icon: any; color: string }
> = {
  cash: { label: "Espèces", icon: Banknote, color: "text-emerald-500" },
  card: { label: "Carte", icon: CreditCard, color: "text-indigo-500" },
  transfer: { label: "Virement", icon: Landmark, color: "text-blue-500" },
  installment: {
    label: "Échéance",
    icon: CalendarClock,
    color: "text-amber-500",
  },
  other: { label: "Autre", icon: Receipt, color: "text-slate-500" },
};

const saleTypeConfig: Record<SaleType, { label: string; icon: any }> = {
  ticket: { label: "Ticket", icon: Receipt },
  facture: { label: "Facture", icon: FileText },
  devis: { label: "Devis", icon: FileSignature },
};

function toLocalDateTimeInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function userCanOverridePrices(user: ReturnType<typeof useAuth>["user"]) {
  if (!user) return false;
  if (user.customPermissions?.revokes.includes("sales.price.override"))
    return false;
  if (user.customPermissions?.grants.includes("sales.price.override"))
    return true;
  return ["admin", "superadmin", "manager", "franchise"].includes(user.role);
}

function userCanOverrideCredit(user: ReturnType<typeof useAuth>["user"]) {
  if (!user) return false;
  if (user.customPermissions?.revokes.includes("sales.credit.override"))
    return false;
  if (user.customPermissions?.grants.includes("sales.credit.override"))
    return true;
  return ["admin", "superadmin", "manager", "franchise"].includes(user.role);
}

function clientCreditGuard(
  client: Client | undefined,
  newCreditAmount: number,
  installmentCount: number,
) {
  if (!client?.creditScore) return null;
  const projectedDebt = roundCurrency(
    (client.balanceDue ?? 0) + Math.max(0, newCreditAmount),
  );
  const recommendedCreditLimit = client.creditScore.recommendedCreditLimit ?? 0;
  const estimatedMonthlyPayment = roundCurrency(
    Math.max(0, newCreditAmount) / Math.max(1, installmentCount),
  );
  const reasons: string[] = [];
  if (client.creditScore.tier === "risky")
    reasons.push(`Score risque (${client.creditScore.score}/100)`);
  if ((client.lateInstallments ?? 0) > 0)
    reasons.push(`${client.lateInstallments} echeance(s) en retard`);
  if (projectedDebt > recommendedCreditLimit)
    reasons.push(
      `Dette projetee ${money(projectedDebt)} > plafond ${money(recommendedCreditLimit)}`,
    );
  if (
    client.creditScore.maxMonthlyPayment > 0 &&
    estimatedMonthlyPayment > client.creditScore.maxMonthlyPayment
  ) {
    reasons.push(
      `Mensualite estimee ${money(estimatedMonthlyPayment)} > capacite ${money(client.creditScore.maxMonthlyPayment)}`,
    );
  }
  return {
    requiresOverride: reasons.length > 0,
    reasons,
    projectedDebt,
    recommendedCreditLimit,
    estimatedMonthlyPayment,
  };
}

function productTypeLabel(product: Product) {
  if (product.productType === "asel_recharge") return "Recharge";
  if (product.productType === "asel_forfait") return "Forfait";
  return "Stock";
}

function productPriceLabel(product: Product) {
  if (product.priceMode === "variable") return "Montant libre";
  return money(product.sellPrice);
}

function stockSellPrice(item: StockItem) {
  return item.sellPrice ?? item.product.sellPrice;
}

function parseMoneyInput(value: string | null) {
  if (value == null) return null;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? roundCurrency(parsed) : null;
}

function buildInstallmentPreview(
  totalAmount: number,
  upfrontAmount: number,
  lotCount: number,
  startDate: string,
  intervalDays: number,
) {
  const remainingAmount = roundCurrency(totalAmount - upfrontAmount);
  if (remainingAmount <= 0 || !Number.isInteger(lotCount) || lotCount <= 0)
    return [];

  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return [];

  const baseAmount = Math.floor((remainingAmount / lotCount) * 100) / 100;
  const remainder = roundCurrency(remainingAmount - baseAmount * lotCount);
  const preview: { amount: number; dueDate: string }[] = [];
  const cursor = new Date(start);

  for (let index = 0; index < lotCount; index += 1) {
    preview.push({
      amount:
        index === lotCount - 1
          ? roundCurrency(baseAmount + remainder)
          : baseAmount,
      dueDate: cursor.toISOString(),
    });
    cursor.setDate(cursor.getDate() + intervalDays);
  }

  return preview;
}

function heldSalesStorageKey(franchiseId: string, userId?: string) {
  return `asel.pos.heldSales.${userId || "user"}.${franchiseId || "franchise"}`;
}

function readHeldSales(key: string): HeldSaleDraft[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHeldSales(key: string, drafts: HeldSaleDraft[]) {
  localStorage.setItem(key, JSON.stringify(drafts.slice(0, 12)));
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

export function POSPage() {
  const { user } = useAuth();
  const isGlobal =
    user?.role === "admin" ||
    user?.role === "superadmin" ||
    user?.role === "manager";
  const canOverridePrices = userCanOverridePrices(user);
  const canOverrideCredit = userCanOverrideCredit(user);
  const qc = useQueryClient();

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ["franchises"],
    queryFn: async () =>
      (await api.get<{ franchises: Franchise[] }>("/franchises")).data
        .franchises,
  });

  const [selectedFid, setSelectedFid] = useState("");
  const effectiveFid = isGlobal ? selectedFid : (user?.franchiseId ?? "");

  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "available" | "low">(
    "all",
  );
  const [posPage, setPosPage] = useState(1);
  const ITEMS_PER_PAGE = 12;
  const debouncedSearch = useDebouncedValue(search, 250);

  // Reset pagination on search or filter change
  useEffect(() => {
    setPosPage(1);
  }, [debouncedSearch, filterMode]);

  const stock = useQuery({
    enabled: !!effectiveFid,
    queryKey: ["stock-pos", effectiveFid, debouncedSearch],
    queryFn: async () =>
      (
        await api.get<{ items: StockItem[] }>("/stock", {
          params: {
            franchiseId: effectiveFid,
            q: debouncedSearch || undefined,
            pageSize: 100,
          },
        })
      ).data.items,
  });

  const nonStockProducts = useQuery({
    enabled: !!effectiveFid,
    queryKey: ["non-stock-products-pos", effectiveFid, debouncedSearch],
    queryFn: async () =>
      (
        await api.get<{ products: Product[] }>("/products", {
          params: {
            active: true,
            stockManaged: false,
            q: debouncedSearch || undefined,
            pageSize: 100,
          },
        })
      ).data.products,
  });

  const catalogItems = useMemo<StockItem[]>(() => {
    const stockItems = stock.data ?? [];
    const stockedProductIds = new Set(stockItems.map((item) => item.productId));
    const serviceItems = (nonStockProducts.data ?? [])
      .filter((product) => !stockedProductIds.has(product._id))
      .map((product) => ({
        _id: `service-${product._id}`,
        franchiseId: effectiveFid,
        productId: product._id,
        quantity: 999999,
        product,
      }));
    return [...serviceItems, ...stockItems];
  }, [effectiveFid, nonStockProducts.data, stock.data]);

  const clients = useQuery({
    enabled: !!effectiveFid,
    queryKey: ["clients-pos", effectiveFid],
    queryFn: async () =>
      (
        await api.get<{ clients: Client[] }>("/clients", {
          params: { franchiseId: effectiveFid, pageSize: 200 },
        })
      ).data.clients,
  });

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [saleType, setSaleType] = useState<SaleType>("ticket");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [clientId, setClientId] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [creditOverrideReason, setCreditOverrideReason] = useState("");
  const [discountApprovalReason, setDiscountApprovalReason] = useState("");
  const [note, setNote] = useState("");
  const [nbLots, setNbLots] = useState(2);
  const [intervalDays, setIntervalDays] = useState(30);
  const [firstDueDate, setFirstDueDate] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const heldSalesKey = useMemo(
    () =>
      heldSalesStorageKey(
        effectiveFid,
        user?.id || user?._id || user?.username,
      ),
    [effectiveFid, user?._id, user?.id, user?.username],
  );
  const [heldSales, setHeldSales] = useState<HeldSaleDraft[]>([]);

  useEffect(() => {
    setHeldSales(effectiveFid ? readHeldSales(heldSalesKey) : []);
  }, [effectiveFid, heldSalesKey]);

  useEffect(() => {
    setCreditOverrideReason("");
  }, [clientId, paymentMethod]);

  function resetCheckoutState() {
    setCart([]);
    setDiscount(0);
    setClientId("");
    setAmountReceived("");
    setCreditOverrideReason("");
    setDiscountApprovalReason("");
    setNote("");
    setPaymentMethod("cash");
    setSaleType("ticket");
    setNbLots(2);
    setIntervalDays(30);
    setFirstDueDate(
      toLocalDateTimeInputValue(
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ),
    );
  }

  function persistHeldSales(next: HeldSaleDraft[]) {
    setHeldSales(next);
    writeHeldSales(heldSalesKey, next);
  }

  function holdCurrentSale() {
    if (!effectiveFid || cart.length === 0) return;
    const clientName = selectedClient?.fullName;
    const defaultName =
      clientName ||
      `${cart[0]?.name ?? "Panier"}${cart.length > 1 ? ` +${cart.length - 1}` : ""}`;
    const name = window.prompt("Nom du panier en attente", defaultName);
    if (name === null) return;
    const draft: HeldSaleDraft = {
      id: crypto.randomUUID(),
      name: name.trim() || defaultName,
      createdAt: new Date().toISOString(),
      franchiseId: effectiveFid,
      cart,
      discount,
      saleType,
      paymentMethod,
      clientId,
      amountReceived,
      creditOverrideReason,
      discountApprovalReason,
      note,
      nbLots,
      intervalDays,
      firstDueDate,
    };
    persistHeldSales([
      draft,
      ...heldSales.filter((item) => item.id !== draft.id),
    ]);
    resetCheckoutState();
    setSuccess(`Panier mis en attente: ${draft.name}`);
    setError(null);
    setTimeout(() => setSuccess(null), 3500);
  }

  function resumeHeldSale(draft: HeldSaleDraft) {
    if (cart.length > 0) {
      const confirmed = window.confirm(
        "Le panier actuel sera remplace par ce panier en attente. Continuer ?",
      );
      if (!confirmed) return;
    }
    setCart(draft.cart);
    setDiscount(draft.discount);
    setSaleType(draft.saleType);
    setPaymentMethod(draft.paymentMethod);
    setClientId(draft.clientId);
    setAmountReceived(draft.amountReceived);
    setCreditOverrideReason(draft.creditOverrideReason);
    setDiscountApprovalReason(draft.discountApprovalReason ?? "");
    setNote(draft.note);
    setNbLots(draft.nbLots);
    setIntervalDays(draft.intervalDays);
    setFirstDueDate(draft.firstDueDate);
    persistHeldSales(heldSales.filter((item) => item.id !== draft.id));
    setError(null);
  }

  function deleteHeldSale(id: string) {
    persistHeldSales(heldSales.filter((item) => item.id !== id));
  }

  const clientOptions: SearchableSelectOption[] = useMemo(
    () =>
      (clients.data ?? []).map((client) => ({
        value: client._id,
        label: client.fullName,
        subtitle:
          [client.phone, client.clientType].filter(Boolean).join(" | ") ||
          undefined,
        keywords: [client.phone, client.email, client.company, client.cin]
          .filter(Boolean)
          .join(" "),
      })),
    [clients.data],
  );

  const selectedClient = useMemo(
    () => (clients.data ?? []).find((client) => client._id === clientId),
    [clientId, clients.data],
  );

  function addToCart(item: StockItem) {
    const stockManaged = item.product.stockManaged !== false;
    if (stockManaged && item.quantity <= 0) return;
    const isVariablePrice = item.product.priceMode === "variable";
    let unitPrice = stockSellPrice(item);
    if (isVariablePrice) {
      const amount = parseMoneyInput(
        window.prompt(`Montant ${item.product.name} en TND`, ""),
      );
      if (amount == null) {
        setError("Montant obligatoire pour une recharge a prix libre.");
        return;
      }
      unitPrice = amount;
    }
    setCart((current) => {
      const existingIndex = current.findIndex(
        (line) => line.productId === item.productId,
      );
      if (existingIndex >= 0) {
        const existing = current[existingIndex];
        if (
          !existing ||
          (existing.stockManaged && existing.quantity >= item.quantity)
        )
          return current;
        const copy = [...current];
        copy[existingIndex] = {
          ...existing,
          quantity: existing.quantity + 1,
          unitPrice: isVariablePrice ? unitPrice : existing.unitPrice,
        };
        return copy;
      }

      return [
        ...current,
        {
          productId: item.productId,
          name: item.product.name,
          quantity: 1,
          unitPrice,
          discount: 0,
          available: item.quantity,
          reference: item.product.reference,
          productType: item.product.productType,
          priceMode: item.product.priceMode,
          stockManaged,
        },
      ];
    });
  }

  function updateCartQuantity(productId: string, delta: number) {
    setCart((current) =>
      current.map((line) => {
        if (line.productId === productId) {
          const maxQuantity = line.stockManaged ? line.available : 999;
          const newQ = Math.max(
            1,
            Math.min(line.quantity + delta, maxQuantity),
          );
          const lineSubtotal = roundCurrency(newQ * line.unitPrice);
          return {
            ...line,
            quantity: newQ,
            discount: Math.min(line.discount || 0, lineSubtotal),
          };
        }
        return line;
      }),
    );
  }

  function updateCartUnitPrice(productId: string, price: number) {
    setCart((current) =>
      current.map((line) => {
        const canEditPrice = canOverridePrices || line.priceMode === "variable";
        if (line.productId !== productId || !canEditPrice) return line;
        const unitPrice = roundCurrency(Math.max(0, price));
        return {
          ...line,
          unitPrice,
          discount: Math.min(
            line.discount || 0,
            roundCurrency(line.quantity * unitPrice),
          ),
        };
      }),
    );
  }

  function updateCartLineDiscount(productId: string, discountValue: number) {
    setCart((current) =>
      current.map((line) => {
        if (line.productId !== productId) return line;
        const lineSubtotal = roundCurrency(line.quantity * line.unitPrice);
        return {
          ...line,
          discount: roundCurrency(
            Math.max(0, Math.min(discountValue, lineSubtotal)),
          ),
        };
      }),
    );
  }

  const subtotal = useMemo(
    () =>
      roundCurrency(
        cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
      ),
    [cart],
  );
  const lineDiscountTotal = useMemo(
    () =>
      roundCurrency(cart.reduce((sum, line) => sum + (line.discount || 0), 0)),
    [cart],
  );
  const discountBase = Math.max(0, roundCurrency(subtotal - lineDiscountTotal));
  const total = Math.max(
    0,
    roundCurrency(subtotal - lineDiscountTotal - discount),
  );
  const discountThresholdRate = 5;
  const lineDiscountViolations = cart.filter((line) => {
    const maxDiscount = roundCurrency(
      line.quantity * line.unitPrice * (discountThresholdRate / 100),
    );
    return (line.discount || 0) > maxDiscount;
  });
  const globalDiscountViolation =
    discount > roundCurrency(subtotal * (discountThresholdRate / 100));
  const discountRequiresApproval =
    lineDiscountViolations.length > 0 || globalDiscountViolation;
  const isInstallment = paymentMethod === "installment";
  const numericAmountReceived =
    amountReceived.trim() === ""
      ? null
      : Math.max(0, Number(amountReceived) || 0);
  const changeDue =
    !isInstallment && numericAmountReceived !== null
      ? Math.max(0, roundCurrency(numericAmountReceived - total))
      : 0;
  const remainingInstallmentBalance = isInstallment
    ? Math.max(0, roundCurrency(total - (numericAmountReceived ?? 0)))
    : 0;
  const installmentPreview = useMemo(
    () =>
      isInstallment
        ? buildInstallmentPreview(
            total,
            numericAmountReceived ?? 0,
            nbLots,
            firstDueDate,
            intervalDays,
          )
        : [],
    [
      firstDueDate,
      intervalDays,
      isInstallment,
      nbLots,
      numericAmountReceived,
      total,
    ],
  );
  const hasInvalidVariableAmount = cart.some(
    (line) => line.priceMode === "variable" && line.unitPrice <= 0,
  );
  const creditGuard = useMemo(
    () =>
      isInstallment
        ? clientCreditGuard(selectedClient, remainingInstallmentBalance, nbLots)
        : null,
    [isInstallment, nbLots, remainingInstallmentBalance, selectedClient],
  );

  const checkout = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ sale: Sale; installments: Installment[] }>("/sales", {
          franchiseId: effectiveFid,
          clientId: clientId || null,
          items: cart.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount || 0,
          })),
          saleType,
          discount,
          paymentMethod,
          amountReceived: numericAmountReceived ?? undefined,
          creditOverrideReason: creditGuard?.requiresOverride
            ? creditOverrideReason.trim()
            : undefined,
          discountApprovalReason: discountRequiresApproval
            ? discountApprovalReason.trim()
            : undefined,
          installmentPlan: isInstallment
            ? {
                nbLots,
                startDate: new Date(firstDueDate).toISOString(),
                intervalDays,
                note: note || undefined,
              }
            : undefined,
          note: note || undefined,
        })
      ).data,
    onSuccess: (payload) => {
      const label = payload.sale.invoiceNumber || "transaction enregistrée";
      const suffix =
        payload.installments.length > 0
          ? ` • ${payload.installments.length} échéance(s)`
          : "";
      setSuccess(`${label} • ${money(payload.sale.total)}${suffix}`);
      setError(null);
      resetCheckoutState();
      qc.invalidateQueries({ queryKey: ["stock-pos"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["installments"] });
      setTimeout(() => setSuccess(null), 5000);
    },
    onError: (err) => {
      setError(apiError(err).message);
      setSuccess(null);
    },
  });

  const canCheckout =
    !!effectiveFid &&
    cart.length > 0 &&
    !hasInvalidVariableAmount &&
    discount <= discountBase &&
    (!discountRequiresApproval ||
      (canOverridePrices && !!discountApprovalReason.trim())) &&
    (!isInstallment || !!clientId) &&
    (!creditGuard?.requiresOverride ||
      (canOverrideCredit && !!creditOverrideReason.trim()));

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const command = event.ctrlKey || event.metaKey;

      if (event.key === "Escape" && cameraOpen) {
        event.preventDefault();
        setCameraOpen(false);
        return;
      }

      if ((command && key === "k") || event.key === "F2") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (command && event.key === "Enter") {
        event.preventDefault();
        if (canCheckout && !checkout.isPending) checkout.mutate();
        return;
      }

      if (isEditableElement(event.target) || cart.length === 0) return;
      const lastLine = cart.at(-1);
      if (!lastLine) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        updateCartQuantity(lastLine.productId, 1);
      } else if (event.key === "-") {
        event.preventDefault();
        updateCartQuantity(lastLine.productId, -1);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cameraOpen, canCheckout, cart, checkout.isPending, checkout.mutate]);

  return (
    <div className="min-h-full">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <PageHeader
          title="Terminal de Vente"
          subtitle="Encaissement rapide et gestion des échéances"
        />
        {isGlobal && (
          <div className="w-full md:w-72">
            <select
              className="input shadow-sm"
              value={selectedFid}
              onChange={(e) => setSelectedFid(e.target.value)}
            >
              <option value="">— Sélectionner une franchise —</option>
              {(franchises.data ?? []).map((franchise) => (
                <option key={franchise._id} value={franchise._id}>
                  {franchise.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!effectiveFid ? (
        <div className="flex-1 flex flex-col items-center justify-center text-surface-400">
          <Store className="w-16 h-16 mb-4 text-surface-300" strokeWidth={1} />
          <p className="text-lg">Sélectionnez une franchise pour commencer.</p>
        </div>
      ) : (
        <div className="grid items-start gap-6 pb-10 xl:grid-cols-[minmax(0,1fr)_minmax(390px,460px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(430px,500px)]">
          {/* CATALOG SECTION */}
          <section className="flex min-h-[560px] flex-col overflow-hidden rounded-3xl border border-surface-200/60 bg-white/60 shadow-glass backdrop-blur-xl xl:min-h-[calc(100dvh-13rem)]">
            <div className="border-b border-surface-200/50 bg-white/80 p-5 backdrop-blur-md">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-surface-400" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    placeholder="Rechercher un produit ou référence..."
                    autoFocus
                    className="input pl-11 !rounded-2xl !py-2.5 !text-sm shadow-sm"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 hide-scrollbar">
                  {(["all", "available", "low"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setFilterMode(mode)}
                      className={clsx(
                        "whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-all border",
                        filterMode === mode
                          ? "bg-brand-50 border-brand-200 text-brand-700 dark:bg-brand-900/40 dark:border-brand-700 dark:text-brand-300"
                          : "bg-surface-50 border-surface-200 text-surface-600 hover:bg-surface-100 dark:bg-surface-800 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-700",
                      )}
                    >
                      {mode === "all" && "Tous"}
                      {mode === "available" && "En Stock"}
                      {mode === "low" && "Stock Faible"}
                    </button>
                  ))}
                  <div className="w-px h-6 bg-surface-200 dark:bg-surface-700 mx-1"></div>
                  <button
                    type="button"
                    className="btn-secondary !rounded-xl !py-2 !px-3 whitespace-nowrap shadow-sm hover:border-brand-300 hover:text-brand-600 group"
                    onClick={() => {
                      setCameraError(null);
                      setCameraOpen(true);
                    }}
                  >
                    <ScanLine className="h-4 w-4 text-surface-400 group-hover:text-brand-500 transition-colors" />
                    <span className="text-xs hidden sm:inline">Scanner</span>
                  </button>
                </div>
              </div>
              {cameraError && (
                <p className="mt-2 text-xs text-rose-500 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {cameraError}
                </p>
              )}
            </div>

            {cameraOpen && (
              <ScannerModal
                onScan={(raw) => {
                  if (raw) {
                    setCameraError(null);
                    setSearch(raw.trim());
                    setCameraOpen(false);
                  }
                }}
                onClose={() => setCameraOpen(false)}
                onError={(message) => setCameraError(message)}
              />
            )}

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar sm:p-5">
              {stock.isLoading || nonStockProducts.isLoading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div
                      key={i}
                      className="h-32 rounded-2xl bg-surface-100/50 animate-pulse border border-surface-200/50"
                    ></div>
                  ))}
                </div>
              ) : catalogItems.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-surface-400 opacity-60">
                  <Package
                    className="h-16 w-16 mb-4 text-surface-300"
                    strokeWidth={1}
                  />
                  <p>Aucun produit trouvé pour "{search}".</p>
                </div>
              ) : (
                (() => {
                  const filteredStock = catalogItems.filter((item) => {
                    const stockManaged = item.product.stockManaged !== false;
                    if (filterMode === "available")
                      return !stockManaged || item.quantity > 0;
                    if (filterMode === "low")
                      return (
                        stockManaged &&
                        item.quantity <= item.product.lowStockThreshold
                      );
                    return true;
                  });
                  const totalPages = Math.max(
                    1,
                    Math.ceil(filteredStock.length / ITEMS_PER_PAGE),
                  );
                  const paginatedStock = filteredStock.slice(
                    (posPage - 1) * ITEMS_PER_PAGE,
                    posPage * ITEMS_PER_PAGE,
                  );

                  if (filteredStock.length === 0) {
                    return (
                      <div className="flex h-full flex-col items-center justify-center text-surface-400 opacity-60">
                        <Package
                          className="h-16 w-16 mb-4 text-surface-300"
                          strokeWidth={1}
                        />
                        <p>Aucun produit ne correspond à ces filtres.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="flex flex-col h-full">
                      <motion.div
                        layout
                        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 flex-1 content-start"
                      >
                        <AnimatePresence mode="popLayout">
                          {paginatedStock.map((item) => (
                            <motion.button
                              layout
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.9 }}
                              transition={{ duration: 0.2 }}
                              key={item._id}
                              type="button"
                              disabled={
                                item.product.stockManaged !== false &&
                                item.quantity <= 0
                              }
                              onClick={() => addToCart(item)}
                              className="group relative flex flex-col text-left overflow-hidden rounded-2xl border border-surface-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-1 hover:border-brand-400 hover:shadow-glass-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
                            >
                              <div className="mb-4 flex items-start justify-between gap-2 w-full">
                                <div className="flex-1 min-w-0">
                                  <h3 className="truncate font-semibold text-surface-900 group-hover:text-brand-700 transition-colors">
                                    {item.product.name}
                                  </h3>
                                  <p className="truncate text-xs text-surface-500 mt-0.5">
                                    {item.product.reference ||
                                      "Réf. non renseignée"}
                                  </p>
                                </div>
                                <span
                                  className={clsx(
                                    "badge whitespace-nowrap",
                                    item.product.stockManaged === false
                                      ? "badge-success"
                                      : item.quantity <=
                                          item.product.lowStockThreshold
                                        ? "badge-warning"
                                        : "badge-success",
                                  )}
                                >
                                  {item.product.stockManaged === false
                                    ? productTypeLabel(item.product)
                                    : `Stock: ${item.quantity}`}
                                </span>
                              </div>
                              <div className="mt-auto flex w-full items-center justify-between">
                                <span className="text-xl font-bold tracking-tight text-surface-900">
                                  {item.product.priceMode === "variable"
                                    ? productPriceLabel(item.product)
                                    : money(stockSellPrice(item))}
                                </span>
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 opacity-0 transition-all group-hover:opacity-100">
                                  <Plus className="h-5 w-5" />
                                </div>
                              </div>
                            </motion.button>
                          ))}
                        </AnimatePresence>
                      </motion.div>

                      {totalPages > 1 && (
                        <div className="mt-6 flex items-center justify-between border-t border-surface-200 pt-4">
                          <span className="text-sm text-surface-500 font-medium">
                            Page {posPage} sur {totalPages}
                          </span>
                          <div className="flex gap-2">
                            <button
                              className="btn-secondary !p-2"
                              disabled={posPage === 1}
                              onClick={() =>
                                setPosPage((p) => Math.max(1, p - 1))
                              }
                            >
                              <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button
                              className="btn-secondary !p-2"
                              disabled={posPage === totalPages}
                              onClick={() =>
                                setPosPage((p) => Math.min(totalPages, p + 1))
                              }
                            >
                              <ChevronRight className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </div>
          </section>

          {/* CHECKOUT SECTION */}
          <aside className="overflow-hidden rounded-3xl border border-surface-200/60 bg-white shadow-glass xl:sticky xl:top-0">
            <div className="border-b border-surface-100 bg-surface-50/50 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold flex items-center gap-2 text-surface-900">
                  <ShoppingCart className="h-5 w-5 text-brand-500" />
                  Panier
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                    onClick={holdCurrentSale}
                    disabled={cart.length === 0}
                  >
                    <PauseCircle className="h-3.5 w-3.5" />
                    Attente
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-xs font-semibold text-rose-500 hover:text-rose-600 transition-colors disabled:opacity-50"
                    onClick={() => setCart([])}
                    disabled={cart.length === 0}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Vider
                  </button>
                </div>
              </div>

              <div className="max-h-[300px] min-h-[160px] overflow-y-auto pr-2 custom-scrollbar xl:max-h-[240px] 2xl:max-h-[320px]">
                <AnimatePresence initial={false}>
                  {cart.length === 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex h-full items-center justify-center text-sm text-surface-400"
                    >
                      Votre panier est vide.
                    </motion.div>
                  )}
                  {cart.map((line) => (
                    <motion.div
                      key={line.productId}
                      layout
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{
                        opacity: 0,
                        x: -20,
                        transition: { duration: 0.15 },
                      }}
                      className="group mb-3 rounded-xl border border-surface-100 bg-white p-3 shadow-sm hover:border-brand-200 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-surface-900">
                            {line.name}
                          </div>
                          {line.priceMode === "variable" ||
                          (isInstallment && canOverridePrices) ? (
                            <label className="mt-1 block text-xs text-surface-500">
                              {line.priceMode === "variable"
                                ? "Montant recharge"
                                : "Prix echeance"}
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className="mt-1 h-8 w-32 rounded-lg border border-surface-200 bg-surface-50 px-2 text-xs font-semibold text-surface-900"
                                value={line.unitPrice}
                                onChange={(event) =>
                                  updateCartUnitPrice(
                                    line.productId,
                                    Number(event.target.value) || 0,
                                  )
                                }
                              />
                            </label>
                          ) : (
                            <div className="text-xs text-surface-500">
                              {money(line.unitPrice)} unitaire
                              {line.productType &&
                              line.productType !== "standard"
                                ? ` | ${line.productType === "asel_recharge" ? "recharge" : "forfait"}`
                                : ""}
                            </div>
                          )}
                          <label className="mt-2 block text-xs text-surface-500">
                            Remise ligne
                            <input
                              type="number"
                              min={0}
                              max={line.quantity * line.unitPrice}
                              step="0.01"
                              className="mt-1 h-8 w-32 rounded-lg border border-surface-200 bg-surface-50 px-2 text-xs font-semibold text-emerald-700"
                              value={line.discount ? line.discount : ""}
                              placeholder="0.00"
                              onChange={(event) =>
                                updateCartLineDiscount(
                                  line.productId,
                                  Number(event.target.value) || 0,
                                )
                              }
                            />
                          </label>
                        </div>
                        <button
                          className="ml-2 p-1 text-surface-300 hover:text-rose-500 transition-colors rounded-md hover:bg-rose-50"
                          onClick={() =>
                            setCart((current) =>
                              current.filter(
                                (item) => item.productId !== line.productId,
                              ),
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center rounded-lg border border-surface-200 bg-surface-50/50 p-1">
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-surface-600 shadow-sm hover:text-brand-600 disabled:opacity-50"
                            onClick={() =>
                              updateCartQuantity(line.productId, -1)
                            }
                            disabled={line.quantity <= 1}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-10 text-center text-sm font-semibold">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-surface-600 shadow-sm hover:text-brand-600 disabled:opacity-50"
                            onClick={() =>
                              updateCartQuantity(line.productId, 1)
                            }
                            disabled={
                              line.stockManaged &&
                              line.quantity >= line.available
                            }
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="text-base font-bold text-surface-900">
                          {money(
                            Math.max(
                              0,
                              roundCurrency(
                                line.quantity * line.unitPrice -
                                  (line.discount || 0),
                              ),
                            ),
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              {heldSales.length > 0 && (
                <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-bold uppercase tracking-wide text-amber-700">
                      Paniers en attente
                    </div>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      {heldSales.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {heldSales.slice(0, 4).map((draft) => {
                      const draftTotal = roundCurrency(
                        draft.cart.reduce(
                          (sum, line) =>
                            sum +
                            Math.max(
                              0,
                              line.quantity * line.unitPrice -
                                (line.discount || 0),
                            ),
                          0,
                        ) - draft.discount,
                      );
                      return (
                        <div
                          key={draft.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-amber-50/60 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-surface-900">
                              {draft.name}
                            </div>
                            <div className="text-xs text-surface-500">
                              {draft.cart.length} article(s) ·{" "}
                              {money(Math.max(0, draftTotal))}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-brand-600 ring-1 ring-amber-100 hover:bg-brand-50"
                              title="Reprendre"
                              onClick={() => resumeHeldSale(draft)}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-rose-500 ring-1 ring-amber-100 hover:bg-rose-50"
                              title="Supprimer"
                              onClick={() => deleteHeldSale(draft.id)}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white p-5">
              <div className="space-y-5">
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-surface-900">
                      Document & paiement
                    </h3>
                    <span className="rounded-full bg-surface-100 px-2.5 py-1 text-[11px] font-semibold text-surface-500">
                      {cart.length} article(s)
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="label">Type de document</label>
                      <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-100 p-1">
                        {Object.entries(saleTypeConfig).map(([val, conf]) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setSaleType(val as SaleType)}
                            className={clsx(
                              "flex flex-col items-center justify-center rounded-lg py-1.5 transition-all duration-200",
                              saleType === val
                                ? "bg-white shadow-sm text-surface-900 font-semibold"
                                : "text-surface-500 hover:text-surface-700",
                            )}
                          >
                            <conf.icon
                              className={clsx(
                                "h-4 w-4 mb-1",
                                saleType === val ? "text-brand-500" : "",
                              )}
                            />
                            <span className="text-[10px] uppercase tracking-wider">
                              {conf.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="label">Paiement</label>
                      <div className="relative">
                        <select
                          className="input appearance-none pl-10"
                          value={paymentMethod}
                          onChange={(e) =>
                            setPaymentMethod(e.target.value as PaymentMethod)
                          }
                        >
                          {Object.entries(paymentMethodConfig).map(
                            ([val, conf]) => (
                              <option key={val} value={val}>
                                {conf.label}
                              </option>
                            ),
                          )}
                        </select>
                        {(() => {
                          const Icon = paymentMethodConfig[paymentMethod].icon;
                          const colorClass =
                            paymentMethodConfig[paymentMethod].color;
                          return (
                            <Icon
                              className={clsx(
                                "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4",
                                colorClass,
                              )}
                            />
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-surface-100 bg-surface-50/60 p-3">
                  <label className="label">Client</label>
                  <SearchableSelect
                    value={clientId}
                    options={clientOptions}
                    onChange={setClientId}
                    allowClear
                    placeholder={
                      isInstallment
                        ? "Client obligatoire pour échéance..."
                        : "Client occasionnel (optionnel)"
                    }
                    emptyMessage="Aucun client trouvé"
                  />
                </div>

                {isInstallment && selectedClient?.creditScore && (
                  <div
                    className={clsx(
                      "rounded-2xl border p-3 text-sm",
                      creditGuard?.requiresOverride
                        ? "border-amber-200 bg-amber-50 text-amber-950"
                        : "border-emerald-200 bg-emerald-50 text-emerald-950",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase">
                          Controle credit client
                        </div>
                        <div className="mt-1 font-semibold">
                          {selectedClient.creditScore.score}/100 ·{" "}
                          {selectedClient.creditScore.label}
                        </div>
                        <div className="mt-1 text-xs opacity-75">
                          Dette projetee{" "}
                          {money(
                            creditGuard?.projectedDebt ??
                              selectedClient.balanceDue ??
                              0,
                          )}{" "}
                          / plafond{" "}
                          {money(
                            selectedClient.creditScore.recommendedCreditLimit,
                          )}
                        </div>
                      </div>
                      <span
                        className={
                          creditGuard?.requiresOverride
                            ? "badge-warning"
                            : "badge-success"
                        }
                      >
                        {creditGuard?.requiresOverride
                          ? "Validation requise"
                          : "OK"}
                      </span>
                    </div>
                    {creditGuard?.requiresOverride && (
                      <div className="mt-3 space-y-2">
                        <ul className="list-disc pl-5 text-xs">
                          {creditGuard.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                        {canOverrideCredit ? (
                          <textarea
                            className="input min-h-[76px] !bg-white"
                            value={creditOverrideReason}
                            onChange={(event) =>
                              setCreditOverrideReason(event.target.value)
                            }
                            placeholder="Motif validation superieur obligatoire"
                          />
                        ) : (
                          <div className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold">
                            Demander validation franchise/manager avant de
                            vendre a echeance.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <div>
                    <label className="label">Remise globale</label>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={discountBase}
                        step="0.01"
                        className="input pr-8"
                        value={discount === 0 ? "" : discount}
                        placeholder="0.00"
                        onChange={(e) =>
                          setDiscount(
                            Math.max(
                              0,
                              Math.min(
                                discountBase,
                                Number(e.target.value) || 0,
                              ),
                            ),
                          )
                        }
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm">
                        TND
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="label">
                      {isInstallment ? "Apport initial" : "Montant reçu"}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input pr-8 font-semibold text-brand-700"
                        value={amountReceived}
                        placeholder={String(total)}
                        onChange={(e) => setAmountReceived(e.target.value)}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm">
                        TND
                      </span>
                    </div>
                  </div>
                </div>

                {(lineDiscountTotal > 0 || discountRequiresApproval) && (
                  <div
                    className={clsx(
                      "rounded-2xl border p-3 text-sm",
                      discountRequiresApproval
                        ? "border-amber-200 bg-amber-50 text-amber-950"
                        : "border-emerald-200 bg-emerald-50 text-emerald-950",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase">
                          Remises
                        </div>
                        <div className="mt-1 text-xs opacity-80">
                          Ligne {money(lineDiscountTotal)} · globale{" "}
                          {money(discount)}
                        </div>
                      </div>
                      <span
                        className={
                          discountRequiresApproval
                            ? "badge-warning"
                            : "badge-success"
                        }
                      >
                        {discountRequiresApproval ? "Validation" : "OK"}
                      </span>
                    </div>
                    {discountRequiresApproval && (
                      <div className="mt-3 space-y-2">
                        <div className="text-xs">
                          Seuil standard: {discountThresholdRate}% par ligne et
                          global.
                        </div>
                        {canOverridePrices ? (
                          <textarea
                            className="input min-h-[76px] !bg-white"
                            value={discountApprovalReason}
                            onChange={(event) =>
                              setDiscountApprovalReason(event.target.value)
                            }
                            placeholder="Motif remise superieure au seuil"
                          />
                        ) : (
                          <div className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold">
                            Remise au-dessus du seuil: validation
                            franchise/manager requise.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="label">Note (Optionnelle)</label>
                  <textarea
                    className="input min-h-[88px] resize-none text-sm"
                    value={note}
                    placeholder="Observations, référence..."
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>

                {isInstallment && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-2xl border border-amber-200/50 bg-amber-50/50 p-4 shadow-inner">
                      <h4 className="text-xs font-bold uppercase text-amber-800 mb-3 flex items-center gap-2">
                        <CalendarClock className="w-4 h-4" /> Plan d'Échéance
                      </h4>
                      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                        <div>
                          <label className="text-[10px] font-semibold text-amber-700">
                            Lots
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            className="input !bg-white/80 !py-1.5 !px-2 text-sm"
                            value={nbLots}
                            onChange={(e) =>
                              setNbLots(
                                Math.max(
                                  1,
                                  Math.min(60, Number(e.target.value) || 1),
                                ),
                              )
                            }
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-amber-700">
                            Jours
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={365}
                            className="input !bg-white/80 !py-1.5 !px-2 text-sm"
                            value={intervalDays}
                            onChange={(e) =>
                              setIntervalDays(
                                Math.max(
                                  1,
                                  Math.min(365, Number(e.target.value) || 1),
                                ),
                              )
                            }
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-amber-700">
                            Début
                          </label>
                          <input
                            type="datetime-local"
                            className="input !bg-white/80 !py-1.5 !px-2 text-xs"
                            value={firstDueDate}
                            onChange={(e) => setFirstDueDate(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex gap-2">
                        <div className="flex-1 rounded-xl bg-white/60 px-3 py-2 text-center">
                          <div className="text-[10px] uppercase text-amber-600/80">
                            Reste
                          </div>
                          <div className="font-bold text-amber-900">
                            {money(remainingInstallmentBalance)}
                          </div>
                        </div>
                        <div className="flex-1 rounded-xl bg-white/60 px-3 py-2 text-center">
                          <div className="text-[10px] uppercase text-amber-600/80">
                            Lots
                          </div>
                          <div className="font-bold text-amber-900">
                            {installmentPreview.length}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            <div className="z-10 border-t border-surface-200 bg-white p-5 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] xl:sticky xl:bottom-0">
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm text-surface-500">
                  <span>Sous-total</span>
                  <span>{money(subtotal)}</span>
                </div>
                {lineDiscountTotal > 0 && (
                  <div className="flex justify-between text-sm font-medium text-emerald-600">
                    <span>Remises lignes</span>
                    <span>-{money(lineDiscountTotal)}</span>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600 font-medium">
                    <span>Remise</span>
                    <span>-{money(discount)}</span>
                  </div>
                )}
                {!isInstallment &&
                  numericAmountReceived !== null &&
                  changeDue > 0 && (
                    <div className="flex justify-between text-sm text-amber-600 font-medium">
                      <span>Monnaie à rendre</span>
                      <span>{money(changeDue)}</span>
                    </div>
                  )}
                <div className="flex justify-between items-end border-t border-surface-100 pt-2 mt-2">
                  <span className="text-surface-900 font-semibold uppercase tracking-wider text-sm">
                    Total à Payer
                  </span>
                  <span className="text-3xl font-black tracking-tight text-brand-600">
                    {money(total)}
                  </span>
                </div>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-600 flex items-start gap-2 border border-rose-100"
                  >
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </motion.div>
                )}
                {success && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 flex items-start gap-2 border border-emerald-100"
                  >
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <span>{success}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                className="btn-primary w-full !py-4 !text-lg !rounded-2xl shadow-lg shadow-brand-500/25 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-500/30"
                disabled={!canCheckout || checkout.isPending}
                onClick={() => checkout.mutate()}
              >
                {checkout.isPending ? (
                  <span className="flex items-center gap-2 animate-pulse">
                    <Banknote className="w-6 h-6" /> Traitement...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Banknote className="w-6 h-6" /> Valider l'encaissement
                  </span>
                )}
              </button>

              {isInstallment && !clientId && (
                <p className="mt-3 text-center text-xs font-medium text-amber-600 flex items-center justify-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Un client est requis
                  pour l'échéance
                </p>
              )}
              {hasInvalidVariableAmount && (
                <p className="mt-3 text-center text-xs font-medium text-amber-600 flex items-center justify-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Renseignez le montant
                  de la recharge.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
