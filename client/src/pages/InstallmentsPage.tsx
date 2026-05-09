import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { api, apiError, uploadUrl } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ContactActions } from "../components/ContactActions";
import { Modal } from "../components/Modal";
import { TablePagination } from "../components/TablePagination";
import { dateOnly, dateTime, money } from "../lib/money";
import { useAuth } from "../auth/AuthContext";
import type {
  Client,
  Franchise,
  Installment,
  PageMeta,
  Sale,
} from "../lib/types";

function toLocalDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function statusBadge(status: Installment["status"]) {
  if (status === "paid") return "badge-success";
  if (status === "late") return "badge-danger";
  if (status === "renegotiated") return "badge-muted";
  return "badge-warning";
}

function installmentLabel(installment: Installment): string {
  if (typeof installment.saleId === "object" && installment.saleId) {
    return (
      installment.saleId.invoiceNumber || dateTime(installment.saleId.createdAt)
    );
  }
  return "votre vente";
}

type ReminderTemplateKey = "d7" | "d3" | "due" | "overdue";

const reminderTemplates: Array<{
  key: ReminderTemplateKey;
  label: string;
  timing: string;
}> = [
  { key: "d7", label: "D-7", timing: "Une semaine avant" },
  { key: "d3", label: "D-3", timing: "Trois jours avant" },
  { key: "due", label: "Jour J", timing: "Le jour de l'echeance" },
  { key: "overdue", label: "Retard", timing: "Apres echeance depassee" },
];

function recommendedReminderTemplate(
  installment: Installment,
): ReminderTemplateKey {
  if (installment.status === "late") return "overdue";
  const dueDate = new Date(installment.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);
  const daysUntilDue = Math.ceil(
    (dueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (daysUntilDue <= 0) return "due";
  if (daysUntilDue <= 3) return "d3";
  return "d7";
}

function installmentReminderMessage(
  installment: Installment,
  template: ReminderTemplateKey = recommendedReminderTemplate(installment),
): string {
  const clientName =
    typeof installment.clientId === "object" && installment.clientId?.fullName
      ? installment.clientId.fullName
      : "cher client";
  const sale = installmentLabel(installment);

  if (installment.status === "paid") {
    return `Bonjour ${clientName}, ASEL Mobile Tunisie vous remercie pour votre paiement de ${money(installment.paidAmount || installment.amount)} pour ${sale}. Merci pour votre confiance.`;
  }

  if (template === "d7") {
    return `Bonjour ${clientName}, rappel ASEL Mobile Tunisie : votre échéance de ${money(installment.amount)} pour ${sale} est prévue le ${dateOnly(installment.dueDate)}. Merci de préparer votre règlement.`;
  }

  if (template === "d3") {
    return `Bonjour ${clientName}, rappel ASEL Mobile Tunisie : votre échéance de ${money(installment.amount)} pour ${sale} approche et doit être réglée le ${dateOnly(installment.dueDate)}. Merci de confirmer votre disponibilité.`;
  }

  if (template === "due") {
    return `Bonjour ${clientName}, rappel ASEL Mobile Tunisie : votre échéance de ${money(installment.amount)} pour ${sale} est à régler aujourd'hui. Merci de passer au paiement ou de nous contacter.`;
  }

  return `Bonjour ${clientName}, rappel ASEL Mobile Tunisie : votre échéance de ${money(installment.amount)} pour ${sale} est en retard depuis le ${dateOnly(installment.dueDate)}. Merci de régulariser rapidement ou de nous contacter.`;
}

type InstallmentStatusFilter =
  | ""
  | "pending"
  | "paid"
  | "late"
  | "renegotiated";

interface InstallmentSummary {
  totalCount: number;
  pendingCount: number;
  pendingAmount: number;
  lateCount: number;
  lateAmount: number;
  dueAmount: number;
  paidCount: number;
  paidAmount: number;
  receiptCount: number;
  collectionRate: number;
  agingBuckets: Record<AgingBucketKey, { count: number; amount: number }>;
}

type AgingBucketKey = "late0To7" | "late8To30" | "late31To60" | "late60Plus";
type CollectionRiskTier = "excellent" | "good" | "watch" | "risky" | "unknown";

interface CollectionRiskBucket {
  clients: number;
  balanceDue: number;
  pendingDue: number;
  lateDue: number;
}

interface CollectionDashboard {
  summary: {
    clientsDue: number;
    dueAmount: number;
    pendingDue: number;
    lateDue: number;
    pendingInstallments: number;
    lateInstallments: number;
    riskyClients: number;
    byTier: Record<CollectionRiskTier, CollectionRiskBucket>;
    byFranchise: Array<
      CollectionRiskBucket & {
        franchiseId: string | null;
        franchiseName: string;
      }
    >;
  };
  clients: Array<{
    clientId: string;
    clientName: string;
    phone?: string | null;
    phone2?: string | null;
    franchiseId: string;
    franchiseName: string;
    balanceDue: number;
    pendingDue: number;
    lateDue: number;
    pendingInstallments: number;
    lateInstallments: number;
    nextDueDate?: string | null;
    oldestLateDate?: string | null;
    riskTier: CollectionRiskTier;
    creditScore?: Client["creditScore"] | null;
  }>;
}

const agingBucketConfig: Array<{
  key: AgingBucketKey;
  label: string;
  hint: string;
  className: string;
}> = [
  {
    key: "late0To7",
    label: "0-7 jours",
    hint: "Retard recent",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  {
    key: "late8To30",
    label: "8-30 jours",
    hint: "A relancer",
    className: "border-orange-200 bg-orange-50 text-orange-900",
  },
  {
    key: "late31To60",
    label: "31-60 jours",
    hint: "Risque fort",
    className: "border-rose-200 bg-rose-50 text-rose-900",
  },
  {
    key: "late60Plus",
    label: "60+ jours",
    hint: "Critique",
    className: "border-red-300 bg-red-50 text-red-950",
  },
];

const riskTierLabel: Record<CollectionRiskTier, string> = {
  excellent: "Excellent",
  good: "Fiable",
  watch: "A surveiller",
  risky: "Risque",
  unknown: "Inconnu",
};

const riskTierClass: Record<CollectionRiskTier, string> = {
  excellent: "badge-success",
  good: "badge-info",
  watch: "badge-warning",
  risky: "badge-danger",
  unknown: "badge-muted",
};

const collectionTierOrder: CollectionRiskTier[] = [
  "risky",
  "watch",
  "good",
  "excellent",
  "unknown",
];

function collectionReminderMessage(
  client: CollectionDashboard["clients"][number],
): string {
  const oldestLateDate = client.oldestLateDate
    ? ` dont un retard depuis le ${dateOnly(client.oldestLateDate)}`
    : "";
  return `Bonjour ${client.clientName}, rappel ASEL Mobile Tunisie : votre solde restant est de ${money(client.balanceDue)}${oldestLateDate}. Merci de nous contacter pour regulariser votre echeance.`;
}

function CollectionDashboardPanel({
  data,
  isError,
  isFetching,
}: {
  data?: CollectionDashboard;
  isError: boolean;
  isFetching: boolean;
}) {
  if (isError) {
    return (
      <section className="card mb-5 p-4 text-sm text-rose-700">
        Impossible de charger le tableau de recouvrement.
      </section>
    );
  }

  return (
    <section className="card mb-5 p-4">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">
            Tableau recouvrement
          </div>
          <div className="text-xs text-slate-500">
            Priorite par risque client, franchise et retard.
          </div>
        </div>
        {isFetching && <div className="text-xs text-slate-400">Refresh...</div>}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase text-slate-500">
            Clients a relancer
          </div>
          <div className="mt-1 text-xl font-black text-slate-950">
            {data?.summary.clientsDue ?? 0}
          </div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="text-xs font-semibold uppercase text-blue-600">
            Restant total
          </div>
          <div className="mt-1 text-xl font-black text-blue-950">
            {money(data?.summary.dueAmount ?? 0)}
          </div>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <div className="text-xs font-semibold uppercase text-rose-600">
            Retard expose
          </div>
          <div className="mt-1 text-xl font-black text-rose-950">
            {money(data?.summary.lateDue ?? 0)}
          </div>
          <div className="mt-1 text-xs text-rose-700">
            {data?.summary.lateInstallments ?? 0} echeance(s)
          </div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-semibold uppercase text-amber-600">
            Clients risque
          </div>
          <div className="mt-1 text-xl font-black text-amber-950">
            {data?.summary.riskyClients ?? 0}
          </div>
          <div className="mt-1 text-xs text-amber-700">
            Retard ou score faible
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-3 text-sm font-bold text-slate-900">
          Exposition par risque credit
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          {collectionTierOrder.map((tier) => {
            const bucket = data?.summary.byTier[tier];
            return (
              <div
                key={tier}
                className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <span className={riskTierClass[tier]}>
                  {riskTierLabel[tier]}
                </span>
                <div className="mt-2 text-lg font-black text-slate-950">
                  {money(bucket?.balanceDue ?? 0)}
                </div>
                <div className="text-xs text-slate-500">
                  {bucket?.clients ?? 0} client(s)
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-3 text-sm font-bold text-slate-900">
            Franchises exposees
          </div>
          <div className="space-y-2">
            {(data?.summary.byFranchise ?? []).slice(0, 4).map((row) => (
              <div
                key={row.franchiseId ?? row.franchiseName}
                className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"
              >
                <div>
                  <div className="font-semibold text-slate-900">
                    {row.franchiseName}
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.clients} client(s)
                  </div>
                </div>
                <div className="text-right text-sm font-bold text-slate-900">
                  {money(row.balanceDue)}
                </div>
              </div>
            ))}
            {(data?.summary.byFranchise.length ?? 0) === 0 && (
              <div className="text-sm text-slate-400">Aucune exposition.</div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-3 text-sm font-bold text-slate-900">
            Clients prioritaires
          </div>
          <div className="space-y-2">
            {(data?.clients ?? []).slice(0, 8).map((client) => (
              <div
                key={client.clientId}
                className="flex flex-col gap-2 rounded-lg bg-slate-50 px-3 py-2 lg:flex-row lg:items-center lg:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {client.clientName}
                    </span>
                    <span className={riskTierClass[client.riskTier]}>
                      {riskTierLabel[client.riskTier]}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {client.franchiseName} · restant {money(client.balanceDue)}
                    {client.lateDue > 0
                      ? ` · retard ${money(client.lateDue)}`
                      : ""}
                  </div>
                </div>
                <ContactActions
                  phone={client.phone}
                  phone2={client.phone2}
                  message={collectionReminderMessage(client)}
                  compact
                />
              </div>
            ))}
            {(data?.clients.length ?? 0) === 0 && (
              <div className="text-sm text-slate-400">
                Aucun client a relancer.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function readStatusParam(value: string | null): InstallmentStatusFilter {
  return value === "pending" ||
    value === "paid" ||
    value === "late" ||
    value === "renegotiated"
    ? value
    : "";
}

function canActOnInstallment(installment: Installment) {
  return installment.status === "pending" || installment.status === "late";
}

function refId(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "_id" in value) {
    return String((value as { _id?: string })._id ?? "");
  }
  return "";
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function emptyInstallmentSummary(): InstallmentSummary {
  return {
    totalCount: 0,
    pendingCount: 0,
    pendingAmount: 0,
    lateCount: 0,
    lateAmount: 0,
    dueAmount: 0,
    paidCount: 0,
    paidAmount: 0,
    receiptCount: 0,
    collectionRate: 0,
    agingBuckets: {
      late0To7: { count: 0, amount: 0 },
      late8To30: { count: 0, amount: 0 },
      late31To60: { count: 0, amount: 0 },
      late60Plus: { count: 0, amount: 0 },
    },
  };
}

function agingBucketDateRange(bucket: AgingBucketKey) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (bucket === "late0To7")
    return { from: localDateKey(addDays(today, -7)), to: localDateKey(today) };
  if (bucket === "late8To30")
    return {
      from: localDateKey(addDays(today, -30)),
      to: localDateKey(addDays(today, -8)),
    };
  if (bucket === "late31To60")
    return {
      from: localDateKey(addDays(today, -60)),
      to: localDateKey(addDays(today, -31)),
    };
  return { from: "", to: localDateKey(addDays(today, -61)) };
}

function installmentAgingBucket(installment: Installment): AgingBucketKey {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(installment.dueDate);
  due.setHours(0, 0, 0, 0);
  const daysLate = Math.max(
    0,
    Math.floor((today.getTime() - due.getTime()) / (24 * 60 * 60 * 1000)),
  );
  if (daysLate <= 7) return "late0To7";
  if (daysLate <= 30) return "late8To30";
  if (daysLate <= 60) return "late31To60";
  return "late60Plus";
}

export function InstallmentsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isGlobal =
    user?.role === "ceo" ||
    user?.role === "admin" ||
    user?.role === "manager" ||
    user?.role === "superadmin" ||
    user?.role === "cash_central_maintainer";
  const canCreateInstallments =
    user?.role === "ceo" ||
    user?.role === "admin" ||
    user?.role === "manager" ||
    user?.role === "superadmin" ||
    user?.role === "franchise";
  const canRenegotiateInstallments =
    user?.customPermissions?.grants.includes("sales.credit.override") ||
    (!!user &&
      !user.customPermissions?.revokes.includes("sales.credit.override") &&
      ["ceo", "admin", "superadmin", "manager", "franchise"].includes(
        user.role,
      ));
  const defaultFid = isGlobal ? "" : (user?.franchiseId ?? "");

  const qc = useQueryClient();
  const [franchiseId, setFranchiseId] = useState(defaultFid);
  const [statusFilter, setStatusFilter] = useState<InstallmentStatusFilter>(
    () => readStatusParam(searchParams.get("status")),
  );
  const [fromDate, setFromDate] = useState(searchParams.get("from") ?? "");
  const [toDate, setToDate] = useState(searchParams.get("to") ?? "");
  const [page, setPage] = useState(1);
  const pageSize = 40;
  const [saleId, setSaleId] = useState("");
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState(0);
  const [dueDateLocal, setDueDateLocal] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
  );
  const [paying, setPaying] = useState<Installment | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentDateLocal, setPaymentDateLocal] = useState(
    toLocalDateTimeInputValue(new Date()),
  );
  const [remainingDueDateLocal, setRemainingDueDateLocal] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 4 * 24 * 60 * 60 * 1000)),
  );
  const [paymentNote, setPaymentNote] = useState("");
  const [rescheduling, setRescheduling] = useState<Installment | null>(null);
  const [reminderTemplateInstallment, setReminderTemplateInstallment] =
    useState<Installment | null>(null);
  const [renegotiating, setRenegotiating] = useState<Installment | null>(null);
  const [rescheduleDueDateLocal, setRescheduleDueDateLocal] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [editingPaymentDate, setEditingPaymentDate] =
    useState<Installment | null>(null);
  const [editedPaymentDateLocal, setEditedPaymentDateLocal] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setStatusFilter(readStatusParam(searchParams.get("status")));
    setFromDate(searchParams.get("from") ?? "");
    setToDate(searchParams.get("to") ?? "");
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [franchiseId, statusFilter, fromDate, toDate]);

  function updateStatusFilter(value: InstallmentStatusFilter) {
    setStatusFilter(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set("status", value);
    else next.delete("status");
    setSearchParams(next, { replace: true });
  }

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ["franchises"],
    queryFn: async () =>
      (await api.get<{ franchises: Franchise[] }>("/franchises")).data
        .franchises,
  });

  const sales = useQuery({
    enabled: canCreateInstallments,
    queryKey: ["sales", franchiseId],
    queryFn: async () =>
      (
        await api.get<{ sales: Sale[] }>("/sales", {
          params: {
            franchiseId: franchiseId || undefined,
            limit: 200,
          },
        })
      ).data.sales,
  });

  const clients = useQuery({
    enabled: canCreateInstallments,
    queryKey: ["clients-for-installments", franchiseId],
    queryFn: async () =>
      (
        await api.get<{ clients: Client[] }>("/clients", {
          params: {
            franchiseId: franchiseId || undefined,
            limit: 200,
          },
        })
      ).data.clients,
  });

  const installments = useQuery({
    queryKey: [
      "installments",
      franchiseId,
      statusFilter,
      fromDate,
      toDate,
      page,
    ],
    queryFn: async () =>
      (
        await api.get<{
          installments: Installment[];
          summary: InstallmentSummary;
          meta: PageMeta;
        }>("/installments", {
          params: {
            franchiseId: franchiseId || undefined,
            status: statusFilter || undefined,
            from: fromDate || undefined,
            to: toDate || undefined,
            page,
            pageSize,
          },
        })
      ).data,
  });

  const collectionDashboard = useQuery({
    queryKey: ["installments-collection", franchiseId],
    queryFn: async () =>
      (
        await api.get<CollectionDashboard>("/installments/collection", {
          params: {
            franchiseId: franchiseId || undefined,
            limit: 12,
          },
        })
      ).data,
  });

  const installmentRows = installments.data?.installments ?? [];
  const installmentSummary = useMemo<InstallmentSummary>(() => {
    if (installments.data?.summary) return installments.data.summary;
    const summary = installmentRows.reduce<InstallmentSummary>(
      (current, installment) => {
        const remaining = Math.max(
          0,
          installment.amount - (installment.paidAmount ?? 0),
        );
        current.totalCount += 1;
        if (installment.status === "pending") {
          current.pendingCount += 1;
          current.pendingAmount += remaining;
          current.dueAmount += remaining;
        } else if (installment.status === "late") {
          current.lateCount += 1;
          current.lateAmount += remaining;
          current.dueAmount += remaining;
          const bucket = installmentAgingBucket(installment);
          current.agingBuckets[bucket].count += 1;
          current.agingBuckets[bucket].amount += remaining;
        } else if (installment.status === "paid") {
          current.paidCount += 1;
          current.paidAmount += installment.paidAmount || installment.amount;
          if (installment.receiptPath) current.receiptCount += 1;
        }
        return current;
      },
      emptyInstallmentSummary(),
    );
    const collectibleAmount = summary.paidAmount + summary.dueAmount;
    summary.collectionRate =
      collectibleAmount > 0
        ? Math.round((summary.paidAmount / collectibleAmount) * 10000) / 100
        : 0;
    return summary;
  }, [installmentRows, installments.data?.summary]);

  const selectedSaleAmount = useMemo(() => {
    const selected = (sales.data ?? []).find((sale) => sale._id === saleId);
    return selected?.total ?? 0;
  }, [saleId, sales.data]);

  const create = useMutation({
    mutationFn: async () => {
      if (!saleId) throw new Error("Vente requise");
      const due = new Date(dueDateLocal);
      if (Number.isNaN(due.getTime()))
        throw new Error("Date d'échéance invalide");
      await api.post("/installments", {
        saleId,
        clientId: clientId || null,
        amount,
        dueDate: due.toISOString(),
      });
    },
    onSuccess: () => {
      setErr(null);
      setSaleId("");
      setClientId("");
      setAmount(0);
      qc.invalidateQueries({ queryKey: ["installments"] });
    },
    onError: (error) =>
      setErr(error instanceof Error ? error.message : apiError(error).message),
  });

  const pay = useMutation({
    mutationFn: async () => {
      if (!paying) throw new Error("Echeance requise");
      const numericPaymentAmount = Math.max(0, Number(paymentAmount) || 0);
      if (numericPaymentAmount <= 0) throw new Error("Montant paye requis");
      const isPartial = numericPaymentAmount < paying.amount;
      const remainingDueDate = new Date(remainingDueDateLocal);
      if (isPartial && Number.isNaN(remainingDueDate.getTime())) {
        throw new Error("Date du reste invalide");
      }
      const paidAt = new Date(paymentDateLocal);
      if (Number.isNaN(paidAt.getTime()))
        throw new Error("Date d'encaissement invalide");
      await api.post(`/installments/${paying._id}/pay`, {
        paymentMethod,
        amount: numericPaymentAmount,
        paidAt: paidAt.toISOString(),
        remainingDueDate: isPartial
          ? remainingDueDate.toISOString()
          : undefined,
        note: paymentNote || undefined,
      });
    },
    onSuccess: () => {
      setPaying(null);
      setPaymentAmount("");
      setPaymentMethod("cash");
      setPaymentDateLocal(toLocalDateTimeInputValue(new Date()));
      setPaymentNote("");
      qc.invalidateQueries({ queryKey: ["installments"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error) =>
      setErr(error instanceof Error ? error.message : apiError(error).message),
  });

  const updateInstallment = useMutation({
    mutationFn: async (payload: {
      id: string;
      dueDate?: string;
      paidAt?: string;
      note?: string;
      reason?: string;
    }) => {
      await api.patch(`/installments/${payload.id}`, payload);
    },
    onSuccess: () => {
      setErr(null);
      setRescheduling(null);
      setEditingPaymentDate(null);
      setRescheduleReason("");
      qc.invalidateQueries({ queryKey: ["installments"] });
    },
    onError: (error) =>
      setErr(error instanceof Error ? error.message : apiError(error).message),
  });

  function openPaymentModal(installment: Installment) {
    setPaying(installment);
    setPaymentAmount(String(installment.amount));
    setPaymentDateLocal(toLocalDateTimeInputValue(new Date()));
    setRemainingDueDateLocal(
      toLocalDateTimeInputValue(new Date(Date.now() + 4 * 24 * 60 * 60 * 1000)),
    );
    setPaymentMethod("cash");
    setPaymentNote("");
    setErr(null);
  }

  function openRescheduleModal(installment: Installment) {
    setRescheduling(installment);
    setRescheduleDueDateLocal(
      toLocalDateTimeInputValue(new Date(installment.dueDate)),
    );
    setRescheduleReason("");
    setErr(null);
  }

  function openPaymentDateModal(installment: Installment) {
    setEditingPaymentDate(installment);
    setEditedPaymentDateLocal(
      toLocalDateTimeInputValue(new Date(installment.paidAt || new Date())),
    );
    setErr(null);
  }

  function applyAgingBucketFilter(bucket: AgingBucketKey) {
    const range = agingBucketDateRange(bucket);
    updateStatusFilter("late");
    setFromDate(range.from);
    setToDate(range.to);
    setPage(1);
  }

  const collection = collectionDashboard.data;

  return (
    <>
      <PageHeader title="Échéances" subtitle="Suivi des paiements à terme" />

      <section className="card mb-5 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {isGlobal ? (
            <select
              className="input"
              value={franchiseId}
              onChange={(e) => setFranchiseId(e.target.value)}
            >
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
              value={
                user?.franchiseId ? "Franchise courante" : "Aucune franchise"
              }
            />
          )}
          <select
            className="input"
            value={statusFilter}
            onChange={(e) =>
              updateStatusFilter(e.target.value as InstallmentStatusFilter)
            }
          >
            <option value="">Tous statuts</option>
            <option value="pending">En attente</option>
            <option value="paid">Payée</option>
            <option value="late">En retard</option>
            <option value="renegotiated">Renégociée</option>
          </select>
          <input
            type="date"
            className="input"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
          <input
            type="date"
            className="input"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
          <div className="self-center text-sm text-slate-500">
            {installments.data?.meta.total ?? 0} échéance(s)
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 !text-xs"
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10);
              setFromDate(today);
              setToDate(today);
            }}
          >
            Aujourd'hui
          </button>
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 !text-xs"
            onClick={() => {
              const now = new Date();
              setFromDate(
                new Date(now.getFullYear(), now.getMonth(), 1)
                  .toISOString()
                  .slice(0, 10),
              );
              setToDate(
                new Date(now.getFullYear(), now.getMonth() + 1, 0)
                  .toISOString()
                  .slice(0, 10),
              );
            }}
          >
            Ce mois
          </button>
          <button
            type="button"
            className="btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={() => {
              updateStatusFilter("");
              setFromDate("");
              setToDate("");
              setFranchiseId(defaultFid);
            }}
          >
            Effacer filtres
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <article className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase text-slate-400">
              A encaisser
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900">
              {money(installmentSummary.dueAmount)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {installmentSummary.pendingCount + installmentSummary.lateCount}{" "}
              echeance(s)
            </div>
          </article>
          <article className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-semibold uppercase text-amber-600">
              En attente
            </div>
            <div className="mt-1 text-xl font-bold text-amber-950">
              {money(installmentSummary.pendingAmount)}
            </div>
            <div className="mt-1 text-xs text-amber-700">
              {installmentSummary.pendingCount} dossier(s)
            </div>
          </article>
          <article className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <div className="text-xs font-semibold uppercase text-rose-600">
              En retard
            </div>
            <div className="mt-1 text-xl font-bold text-rose-950">
              {money(installmentSummary.lateAmount)}
            </div>
            <div className="mt-1 text-xs text-rose-700">
              {installmentSummary.lateCount} dossier(s)
            </div>
          </article>
          <article className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-semibold uppercase text-emerald-600">
              Encaisse
            </div>
            <div className="mt-1 text-xl font-bold text-emerald-950">
              {money(installmentSummary.paidAmount)}
            </div>
            <div className="mt-1 text-xs text-emerald-700">
              {installmentSummary.paidCount} paiement(s),{" "}
              {installmentSummary.receiptCount} recu(s)
            </div>
          </article>
          <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase text-slate-500">
              Recouvrement
            </div>
            <div className="mt-1 text-xl font-bold text-slate-950">
              {installmentSummary.collectionRate.toFixed(2)}%
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Encaisse / encaisse + restant
            </div>
          </article>
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900">
                Vieillissement des retards
              </div>
              <div className="text-xs text-slate-500">
                Clique sur une tranche pour filtrer les relances.
              </div>
            </div>
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 !text-xs"
              onClick={() => updateStatusFilter("late")}
            >
              Voir tous les retards
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {agingBucketConfig.map((bucket) => {
              const value = installmentSummary.agingBuckets[bucket.key];
              return (
                <button
                  key={bucket.key}
                  type="button"
                  className={`rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${bucket.className}`}
                  onClick={() => applyAgingBucketFilter(bucket.key)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase">
                        {bucket.label}
                      </div>
                      <div className="mt-1 text-[11px] opacity-75">
                        {bucket.hint}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black">{value.count}</div>
                      <div className="text-[11px] font-semibold">
                        {money(value.amount)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <TablePagination
          meta={installments.data?.meta}
          onPageChange={setPage}
          className="px-1 py-3"
        />
      </section>

      <CollectionDashboardPanel
        data={collection}
        isError={collectionDashboard.isError}
        isFetching={collectionDashboard.isFetching}
      />

      {canCreateInstallments && (
        <section className="card mb-5 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <select
              className="input"
              value={saleId}
              onChange={(e) => setSaleId(e.target.value)}
            >
              <option value="">— Vente —</option>
              {(sales.data ?? []).map((sale) => (
                <option key={sale._id} value={sale._id}>
                  {sale.invoiceNumber || dateTime(sale.createdAt)} ·{" "}
                  {money(sale.total)}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">Sans client</option>
              {(clients.data ?? []).map((client) => (
                <option key={client._id} value={client._id}>
                  {client.fullName}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={amount}
              onChange={(e) =>
                setAmount(Math.max(0, Number(e.target.value) || 0))
              }
            />
            <input
              type="datetime-local"
              className="input"
              value={dueDateLocal}
              onChange={(e) => setDueDateLocal(e.target.value)}
            />
            <button
              className="btn-primary"
              disabled={!saleId || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Création…" : "Créer échéance"}
            </button>
          </div>
          {saleId && (
            <div className="mt-2 text-sm text-slate-500">
              Montant de la vente: {money(selectedSaleAmount)}
            </div>
          )}
          {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
        </section>
      )}

      <section className="grid gap-3 md:hidden">
        {installmentRows.map((installment) => {
          const saleLabel =
            typeof installment.saleId === "object" && installment.saleId
              ? installment.saleId.invoiceNumber ||
                dateTime(installment.saleId.createdAt)
              : "-";
          const clientLabel =
            typeof installment.clientId === "object" && installment.clientId
              ? installment.clientId.fullName
              : "Sans client";
          return (
            <article key={installment._id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">
                    {saleLabel}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {clientLabel}
                  </div>
                </div>
                <span className={statusBadge(installment.status)}>
                  {installment.status}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-400">
                    Montant
                  </div>
                  <div className="font-bold text-slate-900">
                    {money(installment.amount)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-400">
                    Date
                  </div>
                  <div className="font-bold text-slate-900">
                    {dateOnly(installment.dueDate)}
                  </div>
                </div>
              </div>
              {typeof installment.clientId === "object" &&
                installment.clientId && (
                  <ContactActions
                    phone={installment.clientId.phone}
                    phone2={installment.clientId.phone2}
                    message={installmentReminderMessage(installment)}
                    compact
                    className="mt-3"
                  />
                )}
              {canActOnInstallment(installment) ? (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    className="btn-secondary !px-3 !py-1.5"
                    onClick={() => setReminderTemplateInstallment(installment)}
                  >
                    <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    Rappels
                  </button>
                  {canRenegotiateInstallments && (
                    <button
                      className="btn-secondary !px-3 !py-1.5"
                      onClick={() => setRenegotiating(installment)}
                    >
                      Renegocier
                    </button>
                  )}
                  <button
                    className="btn-ghost !px-3 !py-1.5"
                    onClick={() => openRescheduleModal(installment)}
                  >
                    Reporter
                  </button>
                  <button
                    className="btn-secondary !px-3 !py-1.5"
                    onClick={() => openPaymentModal(installment)}
                  >
                    Encaisser
                  </button>
                </div>
              ) : installment.status === "paid" ? (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {installment.receiptPath && (
                    <a
                      className="btn-secondary !px-3 !py-1.5"
                      href={uploadUrl(installment.receiptPath)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {installment.receiptNumber || "Recu"}
                    </a>
                  )}
                  <button
                    className="btn-ghost !px-3 !py-1.5"
                    onClick={() => openPaymentDateModal(installment)}
                  >
                    Modifier date paiement
                  </button>
                </div>
              ) : (
                <div className="mt-3 text-right text-xs text-slate-400">
                  Echeance remplacee par renegociation.
                </div>
              )}
            </article>
          );
        })}
        {!installments.isLoading && installmentRows.length === 0 && (
          <div className="card p-5 text-sm text-slate-400">
            Aucune echeance.
          </div>
        )}
      </section>

      <section className="card hidden p-4 md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Pièce</th>
                <th className="th">Échéance</th>
                <th className="th text-right">Montant</th>
                <th className="th">Statut</th>
                <th className="th">Client</th>
                <th className="th">Paiement</th>
                <th className="th-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {installmentRows.map((installment) => (
                <tr key={installment._id}>
                  <td className="td-action">
                    {typeof installment.saleId === "object" &&
                    installment.saleId
                      ? installment.saleId.invoiceNumber ||
                        dateTime(installment.saleId.createdAt)
                      : "—"}
                  </td>
                  <td className="td">{dateOnly(installment.dueDate)}</td>
                  <td className="td text-right">{money(installment.amount)}</td>
                  <td className="td">
                    <span className={statusBadge(installment.status)}>
                      {installment.status}
                    </span>
                  </td>
                  <td className="td">
                    {typeof installment.clientId === "object" &&
                    installment.clientId ? (
                      <div>
                        <div className="font-medium text-slate-900">
                          {installment.clientId.fullName}
                        </div>
                        <div className="text-xs text-slate-500">
                          {installment.clientId.phone ||
                            installment.clientId.phone2 ||
                            "Sans numéro"}
                        </div>
                        <ContactActions
                          phone={installment.clientId.phone}
                          phone2={installment.clientId.phone2}
                          message={installmentReminderMessage(installment)}
                          compact
                          className="mt-2"
                        />
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="td">
                    <div>
                      {installment.paidAt ? dateOnly(installment.paidAt) : "—"}
                    </div>
                    {installment.receiptPath && (
                      <a
                        className="mt-1 inline-flex text-xs font-semibold text-brand-600 hover:underline"
                        href={uploadUrl(installment.receiptPath)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {installment.receiptNumber || "Recu"}
                      </a>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap justify-end gap-2">
                      {canActOnInstallment(installment) ? (
                        <>
                          <button
                            className="btn-secondary !px-3 !py-1.5"
                            onClick={() =>
                              setReminderTemplateInstallment(installment)
                            }
                          >
                            <MessageSquare
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                            Rappels
                          </button>
                          {canRenegotiateInstallments && (
                            <button
                              className="btn-secondary !px-3 !py-1.5"
                              onClick={() => setRenegotiating(installment)}
                            >
                              Renegocier
                            </button>
                          )}
                          <button
                            className="btn-ghost !px-3 !py-1.5"
                            onClick={() => openRescheduleModal(installment)}
                            disabled={updateInstallment.isPending}
                          >
                            Reporter
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => openPaymentModal(installment)}
                            disabled={pay.isPending}
                          >
                            Encaisser
                          </button>
                        </>
                      ) : installment.status === "paid" ? (
                        <button
                          className="btn-ghost !px-3 !py-1.5"
                          onClick={() => openPaymentDateModal(installment)}
                          disabled={updateInstallment.isPending}
                        >
                          Modifier date
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Remplacee
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!installments.isLoading && installmentRows.length === 0 && (
                <tr>
                  <td className="td text-slate-400" colSpan={7}>
                    Aucune échéance.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          meta={installments.data?.meta}
          onPageChange={setPage}
          className="px-1 py-3"
        />
      </section>

      {paying && (
        <Modal
          open
          size="md"
          title="Encaisser echeance"
          onClose={() => setPaying(null)}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button className="btn-secondary" onClick={() => setPaying(null)}>
                Annuler
              </button>
              <button
                className="btn-primary"
                onClick={() => pay.mutate()}
                disabled={pay.isPending}
              >
                {pay.isPending ? "Encaissement..." : "Valider paiement"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Montant echeance
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {money(paying.amount)}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {typeof paying.clientId === "object" && paying.clientId
                  ? paying.clientId.fullName
                  : "Client non renseigne"}
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                Paiement total ou partiel accepte. Si le client paye une partie,
                le reste devient une nouvelle echeance.
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Montant paye</label>
                <input
                  type="number"
                  min={0}
                  max={paying.amount}
                  step="0.01"
                  className="input"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
              </div>
              <div>
                <label className="label">Mode paiement</label>
                <select
                  className="input"
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                >
                  <option value="cash">Especes</option>
                  <option value="card">Carte</option>
                  <option value="transfer">Virement</option>
                  <option value="other">Autre</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Date d'encaissement</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={paymentDateLocal}
                  onChange={(event) => setPaymentDateLocal(event.target.value)}
                />
              </div>
            </div>
            {Math.max(0, Number(paymentAmount) || 0) < paying.amount && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-3 text-sm font-semibold text-amber-900">
                  Reste a planifier:{" "}
                  {money(
                    Math.max(0, paying.amount - (Number(paymentAmount) || 0)),
                  )}
                </div>
                <label className="label !text-amber-700">
                  Nouvelle date du reste
                </label>
                <input
                  type="datetime-local"
                  className="input !bg-white"
                  value={remainingDueDateLocal}
                  onChange={(event) =>
                    setRemainingDueDateLocal(event.target.value)
                  }
                />
              </div>
            )}
            <div>
              <label className="label">Note paiement</label>
              <textarea
                className="input min-h-[88px]"
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
              />
            </div>
            {err && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {err}
              </div>
            )}
          </div>
        </Modal>
      )}

      {rescheduling && (
        <Modal
          open
          size="md"
          title="Reporter echeance"
          onClose={() => setRescheduling(null)}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                className="btn-secondary"
                onClick={() => setRescheduling(null)}
              >
                Annuler
              </button>
              <button
                className="btn-primary"
                disabled={updateInstallment.isPending}
                onClick={() => {
                  const dueDate = new Date(rescheduleDueDateLocal);
                  if (Number.isNaN(dueDate.getTime())) {
                    setErr("Nouvelle date invalide");
                    return;
                  }
                  updateInstallment.mutate({
                    id: rescheduling._id,
                    dueDate: dueDate.toISOString(),
                    reason: rescheduleReason || undefined,
                  });
                }}
              >
                {updateInstallment.isPending
                  ? "Modification..."
                  : "Valider report"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Si le client ne peut pas payer a la date prevue, on garde la trace
              de l'ancienne date et on reporte cette echeance.
            </div>
            <div>
              <label className="label">Nouvelle date d'echeance</label>
              <input
                type="datetime-local"
                className="input"
                value={rescheduleDueDateLocal}
                onChange={(event) =>
                  setRescheduleDueDateLocal(event.target.value)
                }
              />
            </div>
            <div>
              <label className="label">Motif / note</label>
              <textarea
                className="input min-h-[88px]"
                value={rescheduleReason}
                onChange={(event) => setRescheduleReason(event.target.value)}
                placeholder="Client indisponible, salaire reporte, arrangement..."
              />
            </div>
            {err && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {err}
              </div>
            )}
          </div>
        </Modal>
      )}

      {editingPaymentDate && (
        <Modal
          open
          size="md"
          title="Modifier date d'encaissement"
          onClose={() => setEditingPaymentDate(null)}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                className="btn-secondary"
                onClick={() => setEditingPaymentDate(null)}
              >
                Annuler
              </button>
              <button
                className="btn-primary"
                disabled={updateInstallment.isPending}
                onClick={() => {
                  const paidAt = new Date(editedPaymentDateLocal);
                  if (Number.isNaN(paidAt.getTime())) {
                    setErr("Date d'encaissement invalide");
                    return;
                  }
                  updateInstallment.mutate({
                    id: editingPaymentDate._id,
                    paidAt: paidAt.toISOString(),
                  });
                }}
              >
                {updateInstallment.isPending
                  ? "Modification..."
                  : "Enregistrer"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Paiement encaisse
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {money(
                  editingPaymentDate.paidAmount || editingPaymentDate.amount,
                )}
              </div>
            </div>
            <div>
              <label className="label">Date d'encaissement</label>
              <input
                type="datetime-local"
                className="input"
                value={editedPaymentDateLocal}
                onChange={(event) =>
                  setEditedPaymentDateLocal(event.target.value)
                }
              />
            </div>
            {err && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {err}
              </div>
            )}
          </div>
        </Modal>
      )}

      {reminderTemplateInstallment && (
        <ReminderTemplatesModal
          installment={reminderTemplateInstallment}
          onClose={() => setReminderTemplateInstallment(null)}
        />
      )}

      {renegotiating && (
        <RenegotiationModal
          installment={renegotiating}
          candidates={installmentRows}
          onClose={() => setRenegotiating(null)}
          onSaved={() => {
            setRenegotiating(null);
            qc.invalidateQueries({ queryKey: ["installments"] });
            qc.invalidateQueries({ queryKey: ["installments-collection"] });
            qc.invalidateQueries({ queryKey: ["clients"] });
          }}
        />
      )}
    </>
  );
}

function ReminderTemplatesModal({
  installment,
  onClose,
}: {
  installment: Installment;
  onClose: () => void;
}) {
  const client =
    typeof installment.clientId === "object" && installment.clientId
      ? installment.clientId
      : null;
  const recommended = recommendedReminderTemplate(installment);

  return (
    <Modal
      open
      size="lg"
      title="Templates rappel echeance"
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button className="btn-secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-900">
            {client?.fullName ?? "Client non renseigne"} ·{" "}
            {money(installment.amount)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Echeance {dateOnly(installment.dueDate)} ·{" "}
            {installmentLabel(installment)}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {reminderTemplates.map((template) => {
            const message = installmentReminderMessage(
              installment,
              template.key,
            );
            return (
              <article
                key={template.key}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {template.label}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {template.timing}
                    </div>
                  </div>
                  {template.key === recommended && (
                    <span className="badge-success">Recommande</span>
                  )}
                </div>
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                  {message}
                </p>
                {client ? (
                  <ContactActions
                    phone={client.phone}
                    phone2={client.phone2}
                    whatsappText={message}
                    smsText={message}
                    compact
                    className="mt-3"
                  />
                ) : (
                  <div className="mt-3 text-xs text-slate-400">
                    Aucun numero client disponible.
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

type RenegotiationMode = "split" | "merge" | "waive";

interface SplitPartDraft {
  id: string;
  amount: string;
  dueDateLocal: string;
}

function roundAmount(value: number) {
  return Math.round(value * 1000) / 1000;
}

function addDaysLocal(days: number) {
  return toLocalDateTimeInputValue(
    new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  );
}

function RenegotiationModal({
  installment,
  candidates,
  onClose,
  onSaved,
}: {
  installment: Installment;
  candidates: Installment[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const half = roundAmount(installment.amount / 2);
  const [mode, setMode] = useState<RenegotiationMode>("split");
  const [reason, setReason] = useState("");
  const [splitParts, setSplitParts] = useState<SplitPartDraft[]>([
    {
      id: crypto.randomUUID(),
      amount: String(half),
      dueDateLocal: toLocalDateTimeInputValue(new Date(installment.dueDate)),
    },
    {
      id: crypto.randomUUID(),
      amount: String(roundAmount(installment.amount - half)),
      dueDateLocal: addDaysLocal(30),
    },
  ]);
  const [selectedMergeIds, setSelectedMergeIds] = useState<string[]>([]);
  const [mergeDueDateLocal, setMergeDueDateLocal] = useState(
    toLocalDateTimeInputValue(new Date(installment.dueDate)),
  );
  const [waiveAmount, setWaiveAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mergeCandidates = candidates.filter(
    (candidate) =>
      candidate._id !== installment._id &&
      canActOnInstallment(candidate) &&
      refId(candidate.saleId) === refId(installment.saleId) &&
      refId(candidate.clientId) === refId(installment.clientId),
  );
  const splitTotal = splitParts.reduce(
    (sum, part) => sum + (Number(part.amount) || 0),
    0,
  );
  const selectedMergeTotal = mergeCandidates
    .filter((candidate) => selectedMergeIds.includes(candidate._id))
    .reduce((sum, candidate) => sum + candidate.amount, installment.amount);

  const save = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("Motif requis");
      if (mode === "split") {
        await api.post(`/installments/${installment._id}/renegotiate`, {
          type: "split",
          reason: reason.trim(),
          parts: splitParts.map((part) => {
            const dueDate = new Date(part.dueDateLocal);
            if (Number.isNaN(dueDate.getTime()))
              throw new Error("Date de split invalide");
            return {
              amount: roundAmount(Number(part.amount) || 0),
              dueDate: dueDate.toISOString(),
            };
          }),
        });
      } else if (mode === "merge") {
        if (selectedMergeIds.length === 0)
          throw new Error("Selectionnez au moins une echeance a fusionner");
        const dueDate = new Date(mergeDueDateLocal);
        if (Number.isNaN(dueDate.getTime()))
          throw new Error("Date de fusion invalide");
        await api.post(`/installments/${installment._id}/renegotiate`, {
          type: "merge",
          reason: reason.trim(),
          mergeInstallmentIds: selectedMergeIds,
          dueDate: dueDate.toISOString(),
        });
      } else {
        const amount = roundAmount(Number(waiveAmount) || 0);
        if (amount <= 0) throw new Error("Montant remise requis");
        await api.post(`/installments/${installment._id}/renegotiate`, {
          type: "waive",
          reason: reason.trim(),
          amount,
        });
      }
    },
    onSuccess: onSaved,
    onError: (err) =>
      setError(err instanceof Error ? err.message : apiError(err).message),
  });

  const updatePart = (
    id: string,
    patch: Partial<Omit<SplitPartDraft, "id">>,
  ) => {
    setSplitParts((parts) =>
      parts.map((part) => (part.id === id ? { ...part, ...patch } : part)),
    );
  };

  return (
    <Modal
      open
      size="lg"
      title="Renegocier echeance"
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn-primary"
            form="renegotiation-form"
            disabled={save.isPending}
          >
            {save.isPending ? "Renegociation..." : "Valider"}
          </button>
        </div>
      }
    >
      <form
        id="renegotiation-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Echeance courante
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {money(installment.amount)}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {dateOnly(installment.dueDate)} · {installmentLabel(installment)}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {(["split", "merge", "waive"] as RenegotiationMode[]).map((item) => (
            <button
              key={item}
              type="button"
              className={
                mode === item
                  ? "btn-primary justify-center"
                  : "btn-secondary justify-center"
              }
              onClick={() => setMode(item)}
            >
              {item === "split"
                ? "Split"
                : item === "merge"
                  ? "Fusion"
                  : "Remise"}
            </button>
          ))}
        </div>

        {mode === "split" && (
          <section className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Nouveau calendrier
                </h3>
                <p className="text-xs text-slate-500">
                  Le total doit rester egal a {money(installment.amount)}.
                </p>
              </div>
              <span
                className={
                  roundAmount(splitTotal) === roundAmount(installment.amount)
                    ? "badge-success"
                    : "badge-warning"
                }
              >
                {money(roundAmount(splitTotal))}
              </span>
            </div>
            <div className="space-y-2">
              {splitParts.map((part, index) => (
                <div
                  key={part.id}
                  className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1.5fr_auto]"
                >
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    className="input"
                    value={part.amount}
                    onChange={(event) =>
                      updatePart(part.id, { amount: event.target.value })
                    }
                  />
                  <input
                    type="datetime-local"
                    className="input"
                    value={part.dueDateLocal}
                    onChange={(event) =>
                      updatePart(part.id, { dueDateLocal: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={splitParts.length <= 2}
                    onClick={() =>
                      setSplitParts((parts) =>
                        parts.filter((candidate) => candidate.id !== part.id),
                      )
                    }
                  >
                    Retirer {index + 1}
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary mt-3"
              onClick={() =>
                setSplitParts((parts) => [
                  ...parts,
                  {
                    id: crypto.randomUUID(),
                    amount: "0",
                    dueDateLocal: addDaysLocal(30 * (parts.length + 1)),
                  },
                ])
              }
            >
              Ajouter une date
            </button>
          </section>
        )}

        {mode === "merge" && (
          <section className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Fusionner des echeances
                </h3>
                <p className="text-xs text-slate-500">
                  Meme vente et meme client, visibles dans la liste actuelle.
                </p>
              </div>
              <div>
                <label className="label">Nouvelle date</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={mergeDueDateLocal}
                  onChange={(event) => setMergeDueDateLocal(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              {mergeCandidates.map((candidate) => (
                <label
                  key={candidate._id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                >
                  <span>
                    <input
                      type="checkbox"
                      className="mr-2"
                      checked={selectedMergeIds.includes(candidate._id)}
                      onChange={(event) =>
                        setSelectedMergeIds((ids) =>
                          event.target.checked
                            ? [...ids, candidate._id]
                            : ids.filter((id) => id !== candidate._id),
                        )
                      }
                    />
                    {dateOnly(candidate.dueDate)}
                  </span>
                  <span className="font-semibold text-slate-900">
                    {money(candidate.amount)}
                  </span>
                </label>
              ))}
              {mergeCandidates.length === 0 && (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-400">
                  Aucune autre echeance compatible sur cette page.
                </div>
              )}
            </div>
            <div className="mt-3 rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">
              Total apres fusion: {money(roundAmount(selectedMergeTotal))}
            </div>
          </section>
        )}

        {mode === "waive" && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <label className="label !text-amber-800">Montant remise</label>
            <input
              type="number"
              min={0}
              max={installment.amount}
              step="0.001"
              className="input !bg-white"
              value={waiveAmount}
              onChange={(event) => setWaiveAmount(event.target.value)}
            />
            <p className="mt-2 text-xs text-amber-800">
              Une remise diminue le solde a recouvrer et reste auditee comme
              validation manager.
            </p>
          </section>
        )}

        <div>
          <label className="label">Motif manager</label>
          <textarea
            className="input min-h-[88px]"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Arrangement client, regroupement des echeances, remise validee..."
          />
        </div>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
