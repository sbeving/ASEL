import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Plus,
  Upload,
} from "lucide-react";
import { api, apiError, uploadUrl } from "../lib/api";
import { ContactActions } from "../components/ContactActions";
import { SaleDocumentModal } from "../components/SaleDocumentModal";
import { dateOnly, dateTime, money } from "../lib/money";
import { PageHeader } from "../components/PageHeader";
import { TablePagination } from "../components/TablePagination";
import { Modal } from "../components/Modal";
import { useDebouncedValue } from "../lib/hooks";
import { useAuth } from "../auth/AuthContext";
import type {
  Client,
  ClientCreditOverrideRequest,
  ClientOverview,
  Franchise,
  PageMeta,
} from "../lib/types";

const clientSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().min(1, "Nom requis").max(100),
  phone: z.string().max(40).optional(),
  phone2: z.string().max(40).optional(),
  email: z
    .string()
    .email("Email invalide")
    .max(160)
    .optional()
    .or(z.literal("")),
  address: z.string().max(300).optional(),
  clientType: z.enum(["walkin", "boutique", "wholesale", "passager", "other"]),
  company: z.string().max(160).optional(),
  taxId: z.string().max(80).optional(),
  cin: z.string().max(40).optional(),
  creditProfile: z.object({
    monthlySalary: z.coerce.number().min(0).nullable().optional(),
    additionalIncome: z.coerce.number().min(0).nullable().optional(),
    employmentStatus: z.enum([
      "unknown",
      "salaried",
      "self_employed",
      "business_owner",
      "unemployed",
      "retired",
      "student",
      "other",
    ]),
    employer: z.string().max(160).optional(),
    jobTitle: z.string().max(120).optional(),
    housingStatus: z.enum([
      "unknown",
      "owner",
      "family",
      "rent",
      "mortgage",
      "other",
    ]),
    monthlyRent: z.coerce.number().min(0).nullable().optional(),
    maritalStatus: z.enum([
      "unknown",
      "single",
      "married",
      "divorced",
      "widowed",
      "other",
    ]),
    childrenCount: z.coerce.number().int().min(0).max(20).optional(),
    spouseWorks: z.enum(["unknown", "yes", "no"]),
    distanceKmToFranchise: z.coerce.number().min(0).nullable().optional(),
    creditNotes: z.string().max(1500).optional(),
  }),
  notes: z.string().max(1000).optional(),
  franchiseId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

type ClientFormValues = z.infer<typeof clientSchema>;

const clientTypeLabels: Record<NonNullable<Client["clientType"]>, string> = {
  walkin: "Passage",
  boutique: "Boutique",
  wholesale: "Grossiste",
  passager: "Passager",
  other: "Autre",
};

const creditTierClasses: Record<
  NonNullable<Client["creditScore"]>["tier"],
  string
> = {
  excellent: "badge-success",
  good: "badge-info",
  watch: "badge-warning",
  risky: "badge-danger",
};

function scoreLabel(client: Client) {
  if (!client.creditScore)
    return { text: "Non calcule", className: "badge-muted" };
  return {
    text: `${client.creditScore.score}/100 | ${client.creditScore.label}`,
    className: creditTierClasses[client.creditScore.tier],
  };
}

function buildClientContactMessage(clientName: string): string {
  return `Bonjour ${clientName}, ici ASEL Mobile Tunisie. N'hésitez pas à nous contacter sur WhatsApp, SMS ou appel si vous avez besoin d'assistance.`;
}

function overrideStatusBadge(status: ClientCreditOverrideRequest["status"]) {
  if (status === "approved") return "badge-success";
  if (status === "rejected" || status === "cancelled") return "badge-danger";
  return "badge-warning";
}

function actorLabel(value: ClientCreditOverrideRequest["requestedBy"]) {
  if (value && typeof value === "object")
    return value.fullName || value.username;
  return "—";
}

const clientDocumentLabels: Array<{
  key: keyof NonNullable<Client["documents"]>;
  field: string;
  label: string;
  hint: string;
  accept: string;
}> = [
  {
    key: "cinImagePath",
    field: "cinImage",
    label: "CIN",
    hint: "Image ou PDF de la piece identite",
    accept: "image/png,image/jpeg,image/webp,application/pdf",
  },
  {
    key: "payslipPath",
    field: "payslip",
    label: "Fiche de paie",
    hint: "Justificatif revenu si vente a echeance",
    accept: "image/png,image/jpeg,image/webp,application/pdf",
  },
  {
    key: "proofOfAddressPath",
    field: "proofOfAddress",
    label: "Justificatif adresse",
    hint: "Facture, certificat residence, autre preuve",
    accept: "image/png,image/jpeg,image/webp,application/pdf",
  },
  {
    key: "signedAgreementPath",
    field: "signedAgreement",
    label: "Accord signe",
    hint: "Contrat ou engagement client signe",
    accept: "image/png,image/jpeg,image/webp,application/pdf",
  },
];

function userCanViewClientCredit(user: ReturnType<typeof useAuth>["user"]) {
  if (!user) return false;
  if (user.customPermissions?.revokes.includes("clients.credit.view"))
    return false;
  if (user.customPermissions?.grants.includes("clients.credit.view"))
    return true;
  return ["admin", "superadmin", "ceo", "manager", "franchise"].includes(
    user.role,
  );
}

function userCanApproveClientCredit(user: ReturnType<typeof useAuth>["user"]) {
  if (!user) return false;
  if (user.customPermissions?.revokes.includes("sales.credit.override"))
    return false;
  if (user.customPermissions?.grants.includes("sales.credit.override"))
    return true;
  return ["admin", "superadmin", "ceo", "manager", "franchise"].includes(
    user.role,
  );
}

export function ClientsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isGlobal =
    user?.role === "admin" ||
    user?.role === "superadmin" ||
    user?.role === "ceo" ||
    user?.role === "manager";
  const canManage = user?.role !== "viewer";
  const canViewCredit = userCanViewClientCredit(user);
  const canApproveCredit = userCanApproveClientCredit(user);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 250);
  const [page, setPage] = useState(1);
  const [franchiseFilter, setFranchiseFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<"true" | "false" | "">(
    "true",
  );
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [archiving, setArchiving] = useState<Client | null>(null);
  const [viewing, setViewing] = useState<Client | null>(null);
  const pageSize = 25;

  const franchises = useQuery({
    enabled: isGlobal,
    queryKey: ["franchises"],
    queryFn: async () =>
      (await api.get<{ franchises: Franchise[] }>("/franchises")).data
        .franchises,
  });

  const query = useQuery({
    queryKey: ["clients", debouncedQ, page, franchiseFilter, activeFilter],
    queryFn: async () =>
      (
        await api.get<{ clients: Client[]; meta: PageMeta }>("/clients", {
          params: {
            q: debouncedQ || undefined,
            franchiseId: franchiseFilter || undefined,
            active: activeFilter || undefined,
            page,
            pageSize,
          },
        })
      ).data,
  });

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Repertoire client avec achat cumule, solde du et detail relationnel"
        actions={
          canManage ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nouveau client
            </button>
          ) : undefined
        }
      />

      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_220px_180px]">
          <input
            className="input"
            placeholder="Nom, telephone, email, entreprise..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          {isGlobal ? (
            <select
              className="input"
              value={franchiseFilter}
              onChange={(e) => {
                setFranchiseFilter(e.target.value);
                setPage(1);
              }}
            >
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
            value={activeFilter}
            onChange={(e) => {
              setActiveFilter(e.target.value as "true" | "false" | "");
              setPage(1);
            }}
          >
            <option value="true">Actifs</option>
            <option value="false">Inactifs</option>
            <option value="">Tous</option>
          </select>
        </div>
      </section>

      <section className="grid gap-3 md:hidden">
        {(query.data?.clients ?? []).map((client) => {
          const label = scoreLabel(client);
          return (
            <article key={client._id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">
                    {client.fullName}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {client.company ||
                      client.cin ||
                      client.phone ||
                      "Sans detail"}
                  </div>
                </div>
                <span className={label.className}>{label.text}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-400">
                    Achats
                  </div>
                  <div className="font-bold text-slate-900">
                    {money(client.totalSpent ?? 0)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-slate-400">
                    Solde
                  </div>
                  <div
                    className={
                      (client.balanceDue ?? 0) > 0
                        ? "font-bold text-rose-700"
                        : "font-bold text-slate-900"
                    }
                  >
                    {money(client.balanceDue ?? 0)}
                  </div>
                </div>
              </div>
              <ContactActions
                phone={client.phone}
                phone2={client.phone2}
                message={buildClientContactMessage(client.fullName)}
                compact
                className="mt-3"
              />
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  className="btn-secondary !px-3 !py-1.5"
                  onClick={() => setViewing(client)}
                >
                  Voir
                </button>
                {canManage && (
                  <button
                    className="btn-secondary !px-3 !py-1.5"
                    onClick={() => setEditing(client)}
                  >
                    Modifier
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!query.isLoading && (query.data?.clients.length ?? 0) === 0 && (
          <div className="card p-5 text-sm text-slate-400">
            Aucun client trouve.
          </div>
        )}
        <TablePagination
          meta={query.data?.meta}
          onPageChange={setPage}
          className="px-2 py-3"
        />
      </section>

      <section className="card hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Client</th>
              <th className="th">Contact</th>
              <th className="th">Type</th>
              <th className="th">Franchise</th>
              <th className="th text-right">Achats</th>
              <th className="th text-right">Solde du</th>
              <th className="th">Score credit</th>
              <th className="th">Statut</th>
              <th className="th-action">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(query.data?.clients ?? []).map((client) => (
              <tr key={client._id}>
                <td className="td">
                  <div className="font-medium text-slate-900">
                    {client.fullName}
                  </div>
                  <div className="text-xs text-slate-500">
                    {client.company || client.cin || "Sans detail"}
                  </div>
                </td>
                <td className="td">
                  <div>{client.phone || client.phone2 || "—"}</div>
                  <div className="text-xs text-slate-500">
                    {client.email ||
                      (client.phone && client.phone2 ? client.phone2 : "—")}
                  </div>
                  <ContactActions
                    phone={client.phone}
                    phone2={client.phone2}
                    message={buildClientContactMessage(client.fullName)}
                    compact
                    className="mt-2"
                  />
                </td>
                <td className="td">
                  {client.clientType
                    ? clientTypeLabels[client.clientType]
                    : "—"}
                </td>
                <td className="td text-slate-500">
                  {typeof client.franchiseId === "object" && client.franchiseId
                    ? client.franchiseId.name
                    : "—"}
                </td>
                <td className="td text-right font-medium">
                  {money(client.totalSpent ?? 0)}
                </td>
                <td className="td text-right">
                  <span
                    className={
                      (client.balanceDue ?? 0) > 0
                        ? "font-semibold text-rose-700"
                        : "text-slate-500"
                    }
                  >
                    {money(client.balanceDue ?? 0)}
                  </span>
                </td>
                <td className="td">
                  {(() => {
                    const label = scoreLabel(client);
                    return (
                      <span className={label.className}>{label.text}</span>
                    );
                  })()}
                </td>
                <td className="td">
                  {(client.lateInstallments ?? 0) > 0 ? (
                    <span className="badge-danger">Retard</span>
                  ) : client.active ? (
                    <span className="badge-success">Actif</span>
                  ) : (
                    <span className="badge-muted">Inactif</span>
                  )}
                </td>
                <td className="td-action">
                  <div className="flex justify-end gap-2">
                    <button
                      className="btn-secondary !px-3 !py-1.5"
                      onClick={() => setViewing(client)}
                    >
                      Voir
                    </button>
                    {canManage && (
                      <>
                        <button
                          className="btn-secondary !px-3 !py-1.5"
                          onClick={() => setEditing(client)}
                        >
                          Modifier
                        </button>
                        {client.active && (
                          <button
                            className="btn-danger !px-3 !py-1.5"
                            onClick={() => setArchiving(client)}
                          >
                            Desactiver
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!query.isLoading && (query.data?.clients.length ?? 0) === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={9}>
                  Aucun client trouve.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination
          meta={query.data?.meta}
          onPageChange={setPage}
          className="px-4 py-3"
        />
      </section>

      {viewing && (
        <ClientOverviewModal
          client={viewing}
          canViewCredit={canViewCredit}
          canApproveCredit={canApproveCredit}
          onClose={() => setViewing(null)}
        />
      )}

      {(creating || editing) && (
        <ClientFormModal
          initial={editing}
          canViewCredit={canViewCredit}
          allowFranchiseSelection={isGlobal}
          franchises={franchises.data ?? []}
          defaultFranchiseId={
            !isGlobal ? (user?.franchiseId ?? "") : franchiseFilter
          }
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["clients"] });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {archiving && (
        <ArchiveClientModal
          client={archiving}
          onClose={() => setArchiving(null)}
          onArchived={() => {
            qc.invalidateQueries({ queryKey: ["clients"] });
            setArchiving(null);
          }}
        />
      )}
    </>
  );
}

function ClientOverviewModal({
  client,
  canViewCredit,
  canApproveCredit,
  onClose,
}: {
  client: Client;
  canViewCredit: boolean;
  canApproveCredit: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [viewingSaleId, setViewingSaleId] = useState<string | null>(null);
  const [editingDocuments, setEditingDocuments] = useState(false);
  const [overrideLimit, setOverrideLimit] = useState("");
  const [overrideMonthly, setOverrideMonthly] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideExpiresAt, setOverrideExpiresAt] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const overview = useQuery({
    queryKey: ["client-overview", client._id],
    queryFn: async () =>
      (await api.get<ClientOverview>(`/clients/${client._id}/overview`)).data,
  });
  const createOverride = useMutation({
    mutationFn: async () => {
      const requestedCreditLimit = Number(overrideLimit);
      if (!Number.isFinite(requestedCreditLimit) || requestedCreditLimit <= 0)
        throw new Error("Plafond demande requis");
      if (!overrideReason.trim()) throw new Error("Motif requis");
      await api.post(`/clients/${client._id}/credit-overrides`, {
        requestedCreditLimit,
        requestedMonthlyPayment: Math.max(0, Number(overrideMonthly) || 0),
        requestReason: overrideReason.trim(),
        expiresAt: overrideExpiresAt
          ? new Date(`${overrideExpiresAt}T23:59:59.999Z`).toISOString()
          : undefined,
      });
    },
    onSuccess: () => {
      setOverrideLimit("");
      setOverrideMonthly("");
      setOverrideReason("");
      setOverrideExpiresAt("");
      setOverrideError(null);
      qc.invalidateQueries({ queryKey: ["client-overview", client._id] });
    },
    onError: (error) =>
      setOverrideError(
        error instanceof Error ? error.message : apiError(error).message,
      ),
  });
  const reviewOverride = useMutation({
    mutationFn: async ({
      request,
      status,
    }: {
      request: ClientCreditOverrideRequest;
      status: "approved" | "rejected";
    }) => {
      await api.patch(
        `/clients/${client._id}/credit-overrides/${request._id}`,
        {
          status,
          approvedCreditLimit: request.requestedCreditLimit,
          approvedMonthlyPayment: request.requestedMonthlyPayment,
          expiresAt:
            request.expiresAt ??
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      );
    },
    onSuccess: () => {
      setOverrideError(null);
      qc.invalidateQueries({ queryKey: ["client-overview", client._id] });
    },
    onError: (error) =>
      setOverrideError(
        error instanceof Error ? error.message : apiError(error).message,
      ),
  });

  return (
    <Modal open size="xl" title={client.fullName} onClose={onClose}>
      {overview.isLoading || !overview.data ? (
        <div className="text-sm text-slate-500">Chargement...</div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              label="Total achats"
              value={money(overview.data.salesSummary.totalSpent)}
            />
            <MetricCard
              label="Ventes"
              value={String(overview.data.salesSummary.saleCount)}
            />
            <MetricCard
              label="Solde du"
              value={money(overview.data.installmentSummary.balanceDue)}
            />
            <MetricCard
              label="Retards"
              value={String(overview.data.installmentSummary.lateInstallments)}
            />
            <MetricCard
              label="Score credit"
              value={
                overview.data.creditScore
                  ? `${overview.data.creditScore.score}/100`
                  : "Restreint"
              }
            />
          </div>

          {canViewCredit && overview.data.creditScore ? (
            <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Scoring & confiance
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={
                        creditTierClasses[overview.data.creditScore.tier]
                      }
                    >
                      {overview.data.creditScore.label}
                    </span>
                    <span className="text-sm font-semibold text-slate-700">
                      Plafond recommande:{" "}
                      {money(overview.data.creditScore.recommendedCreditLimit)}
                    </span>
                    <span className="text-sm text-slate-500">
                      Mensualite max:{" "}
                      {money(overview.data.creditScore.maxMonthlyPayment)}
                    </span>
                  </div>
                </div>
                <div className="grid min-w-0 grid-cols-5 gap-2 text-center text-[11px] font-semibold text-slate-500">
                  {Object.entries(overview.data.creditScore.factors).map(
                    ([key, value]) => (
                      <div key={key} className="rounded-xl bg-white px-2 py-2">
                        <div className="text-sm font-bold text-slate-900">
                          {value}
                        </div>
                        <div className="truncate capitalize">{key}</div>
                      </div>
                    ),
                  )}
                </div>
              </div>
              {overview.data.creditScore.reasons.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {overview.data.creditScore.reasons.map((reason) => (
                    <span
                      key={reason}
                      className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              )}
              {(overview.data.creditScoreHistory?.length ?? 0) > 0 && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 text-xs font-bold uppercase text-slate-500">
                    Historique score
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    {overview.data
                      .creditScoreHistory!.slice(-6)
                      .reverse()
                      .map((snapshot) => (
                        <div
                          key={`${snapshot.capturedAt}-${snapshot.score}`}
                          className="rounded-lg bg-slate-50 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={creditTierClasses[snapshot.tier]}>
                              {snapshot.score}/100
                            </span>
                            <span className="text-xs text-slate-400">
                              {dateOnly(snapshot.capturedAt)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Solde {money(snapshot.balanceDue)} · retards{" "}
                            {snapshot.lateInstallments}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Donnees credit masquees pour ce role.
            </section>
          )}
          {canViewCredit && (
            <section className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Dossier client
                  </h3>
                  <p className="text-xs text-slate-500">
                    Pieces sensibles rattachees a la fiche credit et aux ventes
                    a echeance.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingDocuments(true)}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Mettre a jour
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {clientDocumentLabels.map((doc) => (
                  <ClientDocumentCard
                    key={doc.key}
                    label={doc.label}
                    hint={doc.hint}
                    path={
                      overview.data.client.documents?.[doc.key] as
                        | string
                        | null
                        | undefined
                    }
                  />
                ))}
              </div>
              {overview.data.client.documents?.updatedAt && (
                <div className="mt-2 text-xs text-slate-400">
                  Derniere mise a jour:{" "}
                  {dateTime(overview.data.client.documents.updatedAt)}
                </div>
              )}
            </section>
          )}
          {canViewCredit && (
            <section className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Overrides credit
                  </h3>
                  <p className="text-xs text-slate-500">
                    Approbations manager pour depasser les regles credit.
                  </p>
                </div>
                <span className="badge-muted">
                  {overview.data.recentCreditOverrides?.length ?? 0} demande(s)
                </span>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="number"
                      min={0}
                      className="input"
                      placeholder="Plafond credit"
                      value={overrideLimit}
                      onChange={(event) => setOverrideLimit(event.target.value)}
                    />
                    <input
                      type="number"
                      min={0}
                      className="input"
                      placeholder="Mensualite max"
                      value={overrideMonthly}
                      onChange={(event) =>
                        setOverrideMonthly(event.target.value)
                      }
                    />
                    <input
                      type="date"
                      className="input"
                      value={overrideExpiresAt}
                      onChange={(event) =>
                        setOverrideExpiresAt(event.target.value)
                      }
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={createOverride.isPending}
                      onClick={() => createOverride.mutate()}
                    >
                      Demander
                    </button>
                  </div>
                  <textarea
                    className="input mt-2 min-h-[76px]"
                    placeholder="Motif: ancien client, garantie, accord responsable..."
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                  />
                  {overrideError && (
                    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {overrideError}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  {(overview.data.recentCreditOverrides ?? []).map(
                    (request) => (
                      <div
                        key={request._id}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span
                              className={overrideStatusBadge(request.status)}
                            >
                              {request.status}
                            </span>
                            <span className="ml-2 text-xs text-slate-500">
                              {dateOnly(request.createdAt)} ·{" "}
                              {actorLabel(request.requestedBy)}
                            </span>
                          </div>
                          <div className="text-sm font-semibold text-slate-900">
                            {money(request.requestedCreditLimit)}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Mensualite {money(request.requestedMonthlyPayment)} ·
                          expire{" "}
                          {request.expiresAt
                            ? dateOnly(request.expiresAt)
                            : "auto"}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          {request.requestReason}
                        </div>
                        {request.status === "pending" && canApproveCredit && (
                          <div className="mt-2 flex justify-end gap-2">
                            <button
                              type="button"
                              className="btn-danger !px-3 !py-1.5"
                              disabled={reviewOverride.isPending}
                              onClick={() =>
                                reviewOverride.mutate({
                                  request,
                                  status: "rejected",
                                })
                              }
                            >
                              Refuser
                            </button>
                            <button
                              type="button"
                              className="btn-secondary !px-3 !py-1.5"
                              disabled={reviewOverride.isPending}
                              onClick={() =>
                                reviewOverride.mutate({
                                  request,
                                  status: "approved",
                                })
                              }
                            >
                              Approuver
                            </button>
                          </div>
                        )}
                      </div>
                    ),
                  )}
                  {(overview.data.recentCreditOverrides?.length ?? 0) === 0 && (
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-400">
                      Aucune demande override.
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
          <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
            <section className="rounded-2xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">
                Coordonnees
              </h3>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div>
                  <span className="text-slate-400">Telephone:</span>{" "}
                  {overview.data.client.phone || "—"}
                </div>
                <div>
                  <span className="text-slate-400">Telephone 2:</span>{" "}
                  {overview.data.client.phone2 || "—"}
                </div>
                <div>
                  <span className="text-slate-400">Email:</span>{" "}
                  {overview.data.client.email || "—"}
                </div>
                <div>
                  <span className="text-slate-400">Entreprise:</span>{" "}
                  {overview.data.client.company || "—"}
                </div>
                <div>
                  <span className="text-slate-400">Matricule fiscal:</span>{" "}
                  {overview.data.client.taxId || "—"}
                </div>
                <div>
                  <span className="text-slate-400">Adresse:</span>{" "}
                  {overview.data.client.address || "—"}
                </div>
                {canViewCredit && overview.data.client.creditProfile && (
                  <div className="grid gap-2 rounded-xl bg-slate-50 px-3 py-2 sm:grid-cols-2">
                    <div>
                      <span className="text-slate-400">Salaire:</span>{" "}
                      {overview.data.client.creditProfile.monthlySalary
                        ? money(
                            overview.data.client.creditProfile.monthlySalary,
                          )
                        : "-"}
                    </div>
                    <div>
                      <span className="text-slate-400">Logement:</span>{" "}
                      {overview.data.client.creditProfile.housingStatus || "-"}
                    </div>
                    <div>
                      <span className="text-slate-400">Enfants:</span>{" "}
                      {overview.data.client.creditProfile.childrenCount ?? "-"}
                    </div>
                    <div>
                      <span className="text-slate-400">Distance:</span>{" "}
                      {overview.data.client.creditProfile
                        .distanceKmToFranchise != null
                        ? `${overview.data.client.creditProfile.distanceKmToFranchise} km`
                        : "-"}
                    </div>
                  </div>
                )}
                <ContactActions
                  phone={overview.data.client.phone}
                  phone2={overview.data.client.phone2}
                  message={buildClientContactMessage(
                    overview.data.client.fullName,
                  )}
                  className="pt-2"
                />
                {overview.data.client.notes && (
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    {overview.data.client.notes}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">
                Echeances
              </h3>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">En attente</span>
                  <span className="font-semibold text-slate-900">
                    {overview.data.installmentSummary.pendingInstallments}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">En retard</span>
                  <span className="font-semibold text-rose-700">
                    {overview.data.installmentSummary.lateInstallments}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">Payees</span>
                  <span className="font-semibold text-emerald-700">
                    {overview.data.installmentSummary.paidInstallments}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">
                  <span>Solde restant</span>
                  <span className="font-semibold">
                    {money(overview.data.installmentSummary.balanceDue)}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Ventes recentes
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Piece</th>
                    <th className="th">Date</th>
                    <th className="th">Paiement</th>
                    <th className="th text-right">Total</th>
                    <th className="th-action">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.recentSales.map((sale) => (
                    <tr key={sale._id}>
                      <td className="td">
                        {sale.invoiceNumber || sale.saleType}
                      </td>
                      <td className="td text-slate-500">
                        {dateTime(sale.createdAt)}
                      </td>
                      <td className="td">{sale.paymentMethod}</td>
                      <td className="td text-right font-medium">
                        {money(sale.total)}
                      </td>
                      <td className="td-action">
                        <button
                          className="btn-secondary !px-3 !py-1.5"
                          onClick={() => setViewingSaleId(sale._id)}
                        >
                          Voir
                        </button>
                      </td>
                    </tr>
                  ))}
                  {overview.data.recentSales.length === 0 && (
                    <tr>
                      <td className="td text-slate-400" colSpan={5}>
                        Aucune vente recente.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Echeances recentes
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Piece</th>
                    <th className="th">Échéance</th>
                    <th className="th">Statut</th>
                    <th className="th text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.recentInstallments.map((installment) => (
                    <tr key={installment._id}>
                      <td className="td">
                        {typeof installment.saleId === "object" &&
                        installment.saleId
                          ? installment.saleId.invoiceNumber || "—"
                          : "—"}
                      </td>
                      <td className="td text-slate-500">
                        {dateOnly(installment.dueDate)}
                      </td>
                      <td className="td">
                        <span
                          className={
                            installment.status === "late"
                              ? "badge-danger"
                              : installment.status === "paid"
                                ? "badge-success"
                                : "badge-warning"
                          }
                        >
                          {installment.status}
                        </span>
                      </td>
                      <td className="td text-right font-medium">
                        {money(installment.amount)}
                      </td>
                    </tr>
                  ))}
                  {overview.data.recentInstallments.length === 0 && (
                    <tr>
                      <td className="td text-slate-400" colSpan={4}>
                        Aucune echeance.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          {viewingSaleId && (
            <SaleDocumentModal
              saleId={viewingSaleId}
              onClose={() => setViewingSaleId(null)}
            />
          )}
          {editingDocuments && overview.data && (
            <ClientDocumentsModal
              client={overview.data.client}
              onClose={() => setEditingDocuments(false)}
              onSaved={() => {
                setEditingDocuments(false);
                qc.invalidateQueries({
                  queryKey: ["client-overview", client._id],
                });
                qc.invalidateQueries({ queryKey: ["clients"] });
              }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function ClientDocumentCard({
  label,
  hint,
  path,
}: {
  label: string;
  hint: string;
  path?: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="flex items-start gap-2">
        <div className="rounded-lg bg-white p-2 text-slate-500">
          <FileText className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">{label}</div>
          <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
          {path ? (
            <a
              className="mt-2 inline-flex min-h-[32px] items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-slate-200 hover:bg-brand-50"
              href={uploadUrl(path)}
              target="_blank"
              rel="noreferrer"
            >
              Ouvrir
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : (
            <span className="badge-muted mt-2">Manquant</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ClientDocumentsModal({
  client,
  onClose,
  onSaved,
}: {
  client: Client;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedFiles, setSelectedFiles] = useState<
    Record<string, File | null>
  >({});
  const [error, setError] = useState<string | null>(null);
  const uploadDocuments = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      let attached = 0;
      for (const doc of clientDocumentLabels) {
        const file = selectedFiles[doc.field];
        if (file) {
          formData.append(doc.field, file);
          attached += 1;
        }
      }
      if (attached === 0) throw new Error("Selectionnez au moins un document");
      await api.post(`/clients/${client._id}/documents`, formData);
    },
    onSuccess: onSaved,
    onError: (err) =>
      setError(err instanceof Error ? err.message : apiError(err).message),
  });

  return (
    <Modal
      open
      size="lg"
      title={`Dossier client - ${client.fullName}`}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn-primary"
            form="client-documents-form"
            disabled={uploadDocuments.isPending}
          >
            {uploadDocuments.isPending ? "Envoi..." : "Enregistrer documents"}
          </button>
        </div>
      }
    >
      <form
        id="client-documents-form"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          uploadDocuments.mutate();
        }}
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Ces fichiers sont sensibles. Ils restent visibles uniquement aux roles
          autorises a consulter le scoring credit.
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {clientDocumentLabels.map((doc) => {
            const currentPath = client.documents?.[doc.key] as
              | string
              | null
              | undefined;
            const selected = selectedFiles[doc.field];
            return (
              <label
                key={doc.key}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {doc.label}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {doc.hint}
                    </div>
                  </div>
                  <span
                    className={currentPath ? "badge-success" : "badge-muted"}
                  >
                    {currentPath ? "Existe" : "Manquant"}
                  </span>
                </div>
                <input
                  className="input mt-3"
                  type="file"
                  accept={doc.accept}
                  onChange={(event) =>
                    setSelectedFiles((previous) => ({
                      ...previous,
                      [doc.field]: event.target.files?.[0] ?? null,
                    }))
                  }
                />
                {selected && (
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {selected.name}
                  </div>
                )}
              </label>
            );
          })}
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function ClientFormModal({
  initial,
  canViewCredit,
  allowFranchiseSelection,
  franchises,
  defaultFranchiseId,
  onClose,
  onSaved,
}: {
  initial: Client | null;
  canViewCredit: boolean;
  allowFranchiseSelection: boolean;
  franchises: Franchise[];
  defaultFranchiseId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    mode: "onBlur",
    defaultValues: initial
      ? {
          firstName: initial.firstName ?? "",
          lastName: initial.lastName ?? initial.fullName,
          phone: initial.phone ?? "",
          phone2: initial.phone2 ?? "",
          email: initial.email ?? "",
          address: initial.address ?? "",
          clientType: initial.clientType ?? "passager",
          company: initial.company ?? "",
          taxId: initial.taxId ?? "",
          cin: initial.cin ?? "",
          creditProfile: {
            monthlySalary: initial.creditProfile?.monthlySalary ?? null,
            additionalIncome: initial.creditProfile?.additionalIncome ?? null,
            employmentStatus:
              initial.creditProfile?.employmentStatus ?? "unknown",
            employer: initial.creditProfile?.employer ?? "",
            jobTitle: initial.creditProfile?.jobTitle ?? "",
            housingStatus: initial.creditProfile?.housingStatus ?? "unknown",
            monthlyRent: initial.creditProfile?.monthlyRent ?? null,
            maritalStatus: initial.creditProfile?.maritalStatus ?? "unknown",
            childrenCount: initial.creditProfile?.childrenCount ?? 0,
            spouseWorks:
              initial.creditProfile?.spouseWorks === true
                ? "yes"
                : initial.creditProfile?.spouseWorks === false
                  ? "no"
                  : "unknown",
            distanceKmToFranchise:
              initial.creditProfile?.distanceKmToFranchise ?? null,
            creditNotes: initial.creditProfile?.creditNotes ?? "",
          },
          notes: initial.notes ?? "",
          franchiseId:
            typeof initial.franchiseId === "object" && initial.franchiseId
              ? initial.franchiseId._id
              : (initial.franchiseId ?? ""),
          active: initial.active,
        }
      : {
          firstName: "",
          lastName: "",
          phone: "",
          phone2: "",
          email: "",
          address: "",
          clientType: "passager",
          company: "",
          taxId: "",
          cin: "",
          creditProfile: {
            monthlySalary: null,
            additionalIncome: null,
            employmentStatus: "unknown",
            employer: "",
            jobTitle: "",
            housingStatus: "unknown",
            monthlyRent: null,
            maritalStatus: "unknown",
            childrenCount: 0,
            spouseWorks: "unknown",
            distanceKmToFranchise: null,
            creditNotes: "",
          },
          notes: "",
          franchiseId: defaultFranchiseId ?? "",
          active: true,
        },
  });

  const save = useMutation({
    mutationFn: async (values: ClientFormValues) => {
      const fullName = [values.firstName?.trim(), values.lastName.trim()]
        .filter(Boolean)
        .join(" ")
        .trim();
      const creditProfile = {
        ...values.creditProfile,
        spouseWorks:
          values.creditProfile.spouseWorks === "unknown"
            ? null
            : values.creditProfile.spouseWorks === "yes",
      };
      const payload = {
        ...values,
        fullName,
        ...(canViewCredit ? { creditProfile } : {}),
        franchiseId: allowFranchiseSelection
          ? values.franchiseId || null
          : undefined,
        email: values.email || "",
      };

      if (initial) await api.patch(`/clients/${initial._id}`, payload);
      else await api.post("/clients", payload);
    },
    onSuccess: onSaved,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      size="xl"
      placement="top"
      bodyClassName="py-3 sm:py-4"
      title={initial ? "Modifier le client" : "Nouveau client"}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn-primary"
            form="client-form"
            disabled={isSubmitting || save.isPending}
          >
            {isSubmitting || save.isPending
              ? "Enregistrement..."
              : "Enregistrer"}
          </button>
        </div>
      }
    >
      <form
        id="client-form"
        onSubmit={handleSubmit((values) => save.mutate(values))}
        className="space-y-3"
      >
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {error}
          </div>
        )}
        <section className="form-section bg-white">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Coordonnees client
            </h3>
            <span className="badge-muted">Nom requis</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Nom</label>
              <input
                className="input"
                autoComplete="family-name"
                autoFocus
                {...register("lastName")}
              />
              {errors.lastName && (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.lastName.message}
                </p>
              )}
            </div>
            <div>
              <label className="label">Prenom</label>
              <input
                className="input"
                autoComplete="given-name"
                {...register("firstName")}
              />
            </div>
            <div>
              <label className="label">Telephone</label>
              <input
                type="tel"
                className="input"
                autoComplete="tel"
                {...register("phone")}
              />
            </div>
            <div>
              <label className="label">Telephone 2</label>
              <input
                type="tel"
                className="input"
                autoComplete="tel-national"
                {...register("phone2")}
              />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" {...register("clientType")}>
                <option value="passager">Passager</option>
                <option value="boutique">Boutique</option>
                <option value="wholesale">Grossiste</option>
                <option value="walkin">Passage</option>
                <option value="other">Autre</option>
              </select>
            </div>
            <div>
              <label className="label">CIN</label>
              <input
                className="input"
                autoComplete="off"
                {...register("cin")}
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                autoComplete="email"
                {...register("email")}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-rose-600">
                  {errors.email.message}
                </p>
              )}
            </div>
            <div>
              <label className="label">Entreprise</label>
              <input
                className="input"
                autoComplete="organization"
                {...register("company")}
              />
            </div>
            <div>
              <label className="label">Matricule fiscal</label>
              <input
                className="input"
                autoComplete="off"
                {...register("taxId")}
              />
            </div>
            {allowFranchiseSelection && (
              <div>
                <label className="label">Franchise</label>
                <select className="input" {...register("franchiseId")}>
                  <option value="">Aucune</option>
                  {franchises.map((franchise) => (
                    <option key={franchise._id} value={franchise._id}>
                      {franchise.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Adresse</label>
              <input
                className="input"
                autoComplete="street-address"
                {...register("address")}
              />
            </div>
          </div>
        </section>

        <section className="form-section bg-white">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
            <div>
              <label className="label">Notes</label>
              <textarea rows={2} className="input" {...register("notes")} />
            </div>
            <label className="checkbox-field lg:mt-6">
              <input type="checkbox" {...register("active")} />
              Client actif
            </label>
          </div>
        </section>

        {canViewCredit ? (
          <details className="group rounded-lg border border-surface-200 bg-surface-50">
            <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden sm:px-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">
                  Fiche scoring credit
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Optionnel pour les plafonds de credit et les echeances.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="badge-muted">Optionnel</span>
                <ChevronDown
                  className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </div>
            </summary>
            <div className="border-t border-surface-200 p-3 sm:p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="label">Salaire mensuel</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input"
                    {...register("creditProfile.monthlySalary")}
                  />
                </div>
                <div>
                  <label className="label">Revenu additionnel</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input"
                    {...register("creditProfile.additionalIncome")}
                  />
                </div>
                <div>
                  <label className="label">Situation emploi</label>
                  <select
                    className="input"
                    {...register("creditProfile.employmentStatus")}
                  >
                    <option value="unknown">Non renseigne</option>
                    <option value="salaried">Salarie</option>
                    <option value="self_employed">Independant</option>
                    <option value="business_owner">Patron / commerce</option>
                    <option value="unemployed">Sans emploi</option>
                    <option value="retired">Retraite</option>
                    <option value="student">Etudiant</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="label">Employeur</label>
                  <input
                    className="input"
                    {...register("creditProfile.employer")}
                  />
                </div>
                <div>
                  <label className="label">Poste</label>
                  <input
                    className="input"
                    {...register("creditProfile.jobTitle")}
                  />
                </div>
                <div>
                  <label className="label">Logement</label>
                  <select
                    className="input"
                    {...register("creditProfile.housingStatus")}
                  >
                    <option value="unknown">Non renseigne</option>
                    <option value="owner">Proprietaire</option>
                    <option value="family">Chez famille</option>
                    <option value="rent">Location</option>
                    <option value="mortgage">Credit logement</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="label">Loyer / mensualite</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input"
                    {...register("creditProfile.monthlyRent")}
                  />
                </div>
                <div>
                  <label className="label">Situation familiale</label>
                  <select
                    className="input"
                    {...register("creditProfile.maritalStatus")}
                  >
                    <option value="unknown">Non renseigne</option>
                    <option value="single">Celibataire</option>
                    <option value="married">Marie</option>
                    <option value="divorced">Divorce</option>
                    <option value="widowed">Veuf</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="label">Nombre enfants</label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    className="input"
                    {...register("creditProfile.childrenCount")}
                  />
                </div>
                <div>
                  <label className="label">Conjoint travaille</label>
                  <select
                    className="input"
                    {...register("creditProfile.spouseWorks")}
                  >
                    <option value="unknown">Non renseigne</option>
                    <option value="yes">Oui</option>
                    <option value="no">Non</option>
                  </select>
                </div>
                <div>
                  <label className="label">Distance franchise (km)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    className="input"
                    {...register("creditProfile.distanceKmToFranchise")}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="label">Notes credit internes</label>
                  <textarea
                    rows={2}
                    className="input"
                    {...register("creditProfile.creditNotes")}
                  />
                </div>
              </div>
            </div>
          </details>
        ) : (
          <section className="rounded-lg border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-slate-500">
            Fiche scoring credit masquee pour ce role.
          </section>
        )}
      </form>
    </Modal>
  );
}

function ArchiveClientModal({
  client,
  onClose,
  onArchived,
}: {
  client: Client;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const archive = useMutation({
    mutationFn: async () => {
      await api.delete(`/clients/${client._id}`);
    },
    onSuccess: onArchived,
    onError: (err) => setError(apiError(err).message),
  });

  return (
    <Modal
      open
      size="sm"
      title="Desactiver le client"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn-danger"
            onClick={() => archive.mutate()}
            disabled={archive.isPending}
          >
            {archive.isPending ? "Traitement..." : "Desactiver"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          Le client{" "}
          <span className="font-semibold text-slate-900">
            {client.fullName}
          </span>{" "}
          sera retire des listes actives sans supprimer son historique de ventes
          ou d'echeances.
        </p>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
