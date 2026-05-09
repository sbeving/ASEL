export type Role =
  | "ceo"
  | "admin"
  | "superadmin"
  | "manager"
  | "commercial_director"
  | "stock_central_maintainer"
  | "cash_central_maintainer"
  | "hr_admin"
  | "franchise"
  | "seller"
  | "vendeur"
  | "commercial"
  | "siege_employee"
  | "viewer";

export interface User {
  id: string;
  _id?: string;
  username: string;
  fullName: string;
  role: Role;
  franchiseId: string | null;
  managerId?: User | string | null;
  avatarPath?: string | null;
  customPermissions?: {
    grants: string[];
    revokes: string[];
  };
  ocrSettings?: {
    googleAiStudioConfigured: boolean;
    googleAiStudioLast4?: string | null;
    googleAiStudioUpdatedAt?: string | null;
  };
  active?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface Franchise {
  _id: string;
  name: string;
  address?: string;
  phone?: string;
  manager?: string;
  taxId?: string;
  gps?: {
    lat: number;
    lng: number;
  };
  workSchedule?: {
    enabled: boolean;
    days: number[];
    startTime: string;
    endTime: string;
    timezone: string;
  };
  creditPolicy?: {
    enabled: boolean;
    minimumScoreForInstallment: number;
    blockRiskyTier: boolean;
    blockLateInstallments: boolean;
    maxDebtToRecommendedLimitRatio: number;
    maxMonthlyPaymentRatio: number;
  };
  active: boolean;
}

export interface Category {
  _id: string;
  name: string;
  description?: string;
}

export interface Supplier {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  active: boolean;
}

export interface Client {
  _id: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
  phone?: string;
  phone2?: string;
  email?: string;
  address?: string;
  clientType?: "walkin" | "boutique" | "wholesale" | "passager" | "other";
  company?: string;
  taxId?: string;
  cin?: string;
  creditProfile?: {
    monthlySalary?: number | null;
    additionalIncome?: number | null;
    employmentStatus?:
      | "unknown"
      | "salaried"
      | "self_employed"
      | "business_owner"
      | "unemployed"
      | "retired"
      | "student"
      | "other";
    employer?: string;
    jobTitle?: string;
    housingStatus?:
      | "unknown"
      | "owner"
      | "family"
      | "rent"
      | "mortgage"
      | "other";
    monthlyRent?: number | null;
    maritalStatus?:
      | "unknown"
      | "single"
      | "married"
      | "divorced"
      | "widowed"
      | "other";
    childrenCount?: number | null;
    spouseWorks?: boolean | null;
    distanceKmToFranchise?: number | null;
    creditNotes?: string;
  };
  notes?: string;
  franchiseId?: Franchise | string | null;
  active: boolean;
  createdAt?: string;
  totalSpent?: number;
  saleCount?: number;
  lastSaleAt?: string | null;
  balanceDue?: number;
  pendingInstallments?: number;
  lateInstallments?: number;
  paidInstallments?: number;
  totalInstallments?: number;
  creditScore?: ClientCreditScore;
  creditScoreHistory?: ClientCreditScoreSnapshot[];
  documents?: {
    cinImagePath?: string | null;
    payslipPath?: string | null;
    proofOfAddressPath?: string | null;
    signedAgreementPath?: string | null;
    updatedAt?: string | null;
    updatedBy?: string | User | null;
  };
}

export interface ClientCreditScore {
  score: number;
  tier: "excellent" | "good" | "watch" | "risky";
  label: string;
  recommendedCreditLimit: number;
  maxMonthlyPayment: number;
  factors: {
    paymentHistory: number;
    debt: number;
    relationship: number;
    stability: number;
    completeness: number;
  };
  reasons: string[];
}

export interface ClientCreditScoreSnapshot {
  capturedAt: string;
  capturedBy?: User | string | null;
  source?: "create" | "manual_update" | "sale_guard" | "system";
  score: number;
  tier: ClientCreditScore["tier"];
  label: string;
  recommendedCreditLimit: number;
  maxMonthlyPayment: number;
  balanceDue: number;
  lateInstallments: number;
  totalSpent: number;
  reasons: string[];
}

export interface ClientCreditOverrideRequest {
  _id: string;
  clientId: string | Client;
  franchiseId: string | Franchise;
  requestedBy?: string | User;
  requestedCreditLimit: number;
  requestedMonthlyPayment: number;
  requestReason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  approvedCreditLimit?: number;
  approvedMonthlyPayment?: number;
  expiresAt?: string | null;
  reviewedBy?: string | User | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  createdAt?: string;
}

export interface Product {
  _id: string;
  name: string;
  categoryId: string;
  supplierId?: string | null;
  imagePath?: string | null;
  brand?: string;
  reference?: string;
  barcode?: string;
  description?: string;
  purchasePrice: number;
  purchasePriceHt?: number;
  purchaseTaxRate?: number;
  purchasePriceTtc?: number;
  sellPrice: number;
  sellPriceHt?: number;
  sellTaxRate?: number;
  sellPriceTtc?: number;
  productType?: "standard" | "asel_recharge" | "asel_forfait";
  priceMode?: "fixed" | "variable";
  stockManaged?: boolean;
  commissionRate?: number;
  companyShareRate?: number;
  franchiseManagerShareRate?: number;
  lowStockThreshold: number;
  active: boolean;
  stockTotal?: number;
  sales30d?: number;
  sales90d?: number;
  revenue30d?: number;
  revenue90d?: number;
  marginAmount?: number;
  marginPercent?: number;
}

export interface StockItem {
  _id: string;
  franchiseId: string;
  productId: string;
  quantity: number;
  sellPrice?: number | null;
  product: Product;
  category?: Category;
  franchise?: { _id: string; name: string };
}

export interface Movement {
  _id: string;
  franchiseId: Franchise | string;
  productId: Product | string;
  type: string;
  delta: number;
  unitPrice: number;
  note?: string;
  userId?: { _id: string; username: string; fullName: string } | string;
  createdAt: string;
}

export interface SaleItem {
  productId: Product | string;
  quantity: number;
  unitPrice: number;
  lineSubtotal?: number;
  discount?: number;
  total: number;
  productType?: "standard" | "asel_recharge" | "asel_forfait";
  stockManaged?: boolean;
  commissionRate?: number;
  commissionBase?: number;
  commissionAmount?: number;
  companyShareAmount?: number;
  franchiseManagerShareAmount?: number;
}

export interface Sale {
  _id: string;
  invoiceNumber?: string | null;
  saleType: "ticket" | "facture" | "devis";
  franchiseId: Franchise | string;
  clientId?: Client | string | null;
  userId: User | string;
  items: SaleItem[];
  subtotal: number;
  lineDiscountTotal?: number;
  discount: number;
  discountApprovalReason?: string;
  total: number;
  commissionTotal?: number;
  companyShareTotal?: number;
  franchiseManagerShareTotal?: number;
  paymentMethod: "cash" | "card" | "transfer" | "installment" | "other";
  paymentStatus: "paid" | "partial" | "pending";
  amountReceived?: number | null;
  changeDue?: number;
  installmentPlan?: {
    totalLots: number;
    intervalDays: number;
    upfrontAmount: number;
    remainingAmount: number;
    firstDueDate: string;
    generatedLots: number;
  };
  note?: string;
  cancelledAt?: string | null;
  cancelledBy?: User | string | null;
  cancelReason?: string;
  createdAt: string;
}

export interface Transfer {
  _id: string;
  sourceFranchiseId: Franchise | string;
  destFranchiseId: Franchise | string;
  productId: Product | string;
  quantity: number;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  requestedBy: User | string;
  resolvedBy?: User | string | null;
  note?: string;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface DashboardPayload {
  kpis: {
    productCount: number;
    franchiseCount: number;
    todaySalesTotal: number;
    todaySalesCount: number;
    monthSalesTotal: number;
    monthSalesCount: number;
    lowStockCount: number;
    pendingTransfers: number;
  };
  lowStock: StockItem[];
  recentSales: Sale[];
  roleProfile: {
    role: Role;
    scope: "global" | "franchise";
    primaryGoal: string;
    recommendedActions: string[];
  };
  reports: {
    topProducts: Array<{
      productId: string;
      name: string;
      quantity: number;
      revenue: number;
    }>;
    paymentBreakdown: Array<{
      paymentMethod: Sale["paymentMethod"];
      count: number;
      total: number;
    }>;
    cashToday: {
      in: number;
      out: number;
      net: number;
    };
    pendingInstallments: number;
  };
  roleStats?: {
    seller?: {
      monthSalesCount: number;
      monthSalesTotal: number;
      todaySalesCount: number;
      todaySalesTotal: number;
      averageTicket: number;
    };
    hr?: {
      employeeCount: number;
      atWorkCount: number;
      pendingLeaveRequests: number;
      weekHours: number;
      outOfZoneCommercialPings?: number;
      byRole?: Array<{ role: Role; count: number }>;
      latestPunches?: Array<{
        _id: string;
        type: "entree" | "sortie" | "pause_debut" | "pause_fin" | "verif";
        timestamp: string;
        employeeName: string;
        role: Role | string;
        site: string;
      }>;
    };
    franchise?: {
      ca: number;
      salesCount: number;
      averageTicket: number;
      stockQuantity: number;
      stockCost: number;
      stockSellValue: number;
      stockMarginPotential: number;
      lowStockCount: number;
      purchasesTotal: number;
      purchasesCount: number;
      treasury: { encaissements: number; decaissements: number; net: number };
      topMarginProducts: Array<{
        productId: string;
        name: string;
        quantity: number;
        revenue: number;
        estimatedCost: number;
        margin: number;
      }>;
    };
    commercial?: {
      networkPoints: number;
      zones: number;
      pointsWithGps: number;
    };
    commercialDirector?: {
      commercialCount: number;
      activeCommercialsThisWeek: number;
      zonesCount: number;
      unassignedZones: number;
      networkPoints: number;
      outOfZonePings: number;
      pingsCount: number;
      pointsByStatus: Array<{ status: NetworkPoint["status"]; count: number }>;
      bestCommercial: {
        commercialId: string;
        commercialName?: string;
        points: number;
        activePoints: number;
        won: number;
        lastActivityAt?: string | null;
      } | null;
      dormantCommercials: Array<{
        commercialId: string;
        commercialName?: string;
        points: number;
        activePoints: number;
        won: number;
        lastActivityAt?: string | null;
      }>;
      latestPings: Array<{
        _id: string;
        timestamp: string;
        inZone: boolean | null;
        accuracy: number | null;
        commercialName: string;
        zoneName: string;
      }>;
    };
    employee?: {
      workedMinutesThisWeek: number;
      activeShift: boolean;
      pendingLeaveRequests: number;
      siteName?: string;
      lastType?:
        | "entree"
        | "sortie"
        | "pause_debut"
        | "pause_fin"
        | "verif"
        | null;
      lastTimestamp?: string | null;
    };
    pilotage?: {
      caByFranchise: Array<{
        franchiseId: string;
        franchiseName?: string;
        ca: number;
        salesCount: number;
      }>;
      franchiseProfitability: Array<{
        franchiseId: string;
        franchiseName?: string;
        ca: number;
        estimatedCost: number;
        margin: number;
      }>;
      bestCommercial: {
        commercialId: string;
        commercialName?: string;
        points: number;
        activePoints: number;
        won: number;
        lastActivityAt?: string | null;
      } | null;
      dormantCommercials: Array<{
        commercialId: string;
        commercialName: string;
        points: number;
        lastActivityAt?: string | null;
      }>;
      deadZones: Array<{
        _id: string;
        name: string;
        color?: string;
        pointCount: number;
        ownerCount: number;
      }>;
      dormantProducts: Array<{
        _id: string;
        name: string;
        reference?: string;
        barcode?: string;
        sellPrice?: number;
        purchasePrice?: number;
      }>;
      purchasesBySupplier: Array<{
        supplierId: string | null;
        supplierName: string;
        total: number;
        count: number;
      }>;
      stock: {
        quantity: number;
        value: number;
        sellValue: number;
        marginPotential: number;
      };
      treasury: { encaissements: number; decaissements: number; net: number };
    };
  };
}

export interface AuditLog {
  _id: string;
  userId?: string | null;
  username?: string | null;
  action: string;
  entity?: string;
  entityId?: string | null;
  franchiseId?: string | null;
  details?: unknown;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface MonthlyInventoryLine {
  productId: Product | string;
  systemQuantity: number;
  countedQuantity: number;
  variance: number;
  note?: string;
}

export interface MonthlyInventory {
  _id: string;
  franchiseId: Franchise | string;
  month: string;
  status: "draft" | "finalized";
  totalSystemQuantity: number;
  totalCountedQuantity: number;
  totalVariance: number;
  appliedAdjustments: boolean;
  note?: string;
  lines: MonthlyInventoryLine[];
  createdBy?: User | string;
  finalizedBy?: User | string | null;
  finalizedAt?: string | null;
  createdAt: string;
}

export interface ReceptionLine {
  productId: Product | string;
  quantity: number;
  unitPriceHt: number;
  unitPriceTtc: number;
  vatRate: number;
  totalHt: number;
  totalTtc: number;
}

export interface Reception {
  _id: string;
  number: string;
  franchiseId: Franchise | string;
  supplierId?: Supplier | string | null;
  receptionDate?: string;
  status: "draft" | "validated" | "cancelled";
  totalHt: number;
  vat: number;
  totalTtc: number;
  sourceDocumentPath?: string | null;
  note?: string;
  userId?: User | string;
  validatedBy?: User | string | null;
  validatedAt?: string | null;
  lines: ReceptionLine[];
  createdAt: string;
}

export interface CashFlow {
  _id: string;
  franchiseId: Franchise | string;
  type: "encaissement" | "decaissement";
  subType?:
    | "cash_sale"
    | "central_cashbox"
    | "bank_transfer"
    | "expense"
    | "other";
  isCentralCashbox?: boolean;
  counterpartyFranchiseId?: Franchise | string | null;
  linkedFlowId?: CashFlow | string | null;
  amount: number;
  reason: string;
  reference?: string;
  status?: "pending" | "approved" | "rejected";
  reviewedBy?: User | string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  receiptNumber?: string | null;
  receiptPath?: string | null;
  receiptCreatedAt?: string | null;
  date: string;
  userId?: User | string;
  attachmentPath?: string | null;
  attachmentMimeType?: string | null;
  attachmentOriginalName?: string | null;
  createdAt: string;
}

export interface Closing {
  _id: string;
  franchiseId: Franchise | string;
  closingDate: string;
  declaredSalesTotal: number;
  declaredItemsTotal: number;
  systemSalesTotal: number;
  systemItemsTotal: number;
  systemCashTotal?: number;
  cashSalesTotal?: number;
  cashInstallmentsTotal?: number;
  cardSalesTotal?: number;
  transferSalesTotal?: number;
  otherSalesTotal?: number;
  installmentAdvancesTotal?: number;
  installmentDueTotal?: number;
  installmentDueCount?: number;
  installmentPaidTotal?: number;
  installmentPaidCount?: number;
  treasuryCashInTotal?: number;
  treasuryCashOutTotal?: number;
  returnRefundTotal?: number;
  expectedDrawerTotal?: number;
  cashDenominations?: Array<{
    label: string;
    value: number;
    quantity: number;
    total: number;
  }>;
  varianceReason?: string;
  autoGenerated?: boolean;
  comment?: string;
  validated: boolean;
  submittedBy?: User | string;
  validatedBy?: User | string | null;
  validatedAt?: string | null;
  createdAt: string;
}

export interface Installment {
  _id: string;
  saleId: Sale | string;
  franchiseId: Franchise | string;
  clientId?: Client | string | null;
  amount: number;
  originalAmount?: number | null;
  paidAmount?: number;
  dueDate: string;
  dueDateHistory?: Array<{
    from: string;
    to: string;
    reason?: string;
    userId?: User | string;
    createdAt: string;
  }>;
  dueDateUpdatedBy?: User | string | null;
  dueDateUpdatedAt?: string | null;
  status: "pending" | "paid" | "late" | "renegotiated";
  paidAt?: string | null;
  paidAtUpdatedBy?: User | string | null;
  paidAtUpdatedAt?: string | null;
  paymentMethod?: string | null;
  paymentHistory?: Array<{
    amount: number;
    paidAt: string;
    paymentMethod?: string | null;
    receiptNumber?: string | null;
    receiptPath?: string | null;
    note?: string;
    userId?: User | string;
    createdAt: string;
  }>;
  receiptNumber?: string | null;
  receiptPath?: string | null;
  receiptCreatedAt?: string | null;
  waivedAmount?: number;
  renegotiatedAt?: string | null;
  renegotiatedBy?: User | string | null;
  renegotiationHistory?: Array<{
    type: "postpone" | "split" | "merge" | "waive";
    reason?: string;
    userId?: User | string;
    createdAt: string;
    before?: unknown;
    after?: unknown;
    relatedInstallmentIds?: Array<string | Installment>;
    waivedAmount?: number;
  }>;
  note?: string;
  splitFromInstallmentId?: string | null;
  userId?: User | string;
  createdAt: string;
}

export interface ReturnRecord {
  _id: string;
  franchiseId: Franchise | string;
  productId:
    | { _id: string; name: string; reference?: string; barcode?: string }
    | string;
  quantity: number;
  returnType: "return" | "exchange";
  unitPrice: number;
  reason?: string;
  userId?: { _id: string; fullName?: string; username?: string } | string;
  createdAt: string;
}

export interface ReturnSummary {
  returnCount: number;
  exchangeCount: number;
  returnedValue: number;
  totalQuantity: number;
}

export interface Demand {
  _id: string;
  franchiseId: Franchise | string;
  sourceFranchiseId?: Franchise | string | null;
  productId?: Product | string | null;
  productName: string;
  quantity: number;
  urgency: "normal" | "urgent" | "critical";
  status: "pending" | "approved" | "rejected" | "delivered";
  note?: string;
  response?: string;
  requestedBy?: User | string;
  processedBy?: User | string | null;
  processedAt?: string | null;
  createdAt: string;
}

export interface DemandSummary {
  pending: number;
  urgent: number;
  critical: number;
}

export interface Service {
  _id: string;
  name: string;
  category: "technique" | "compte" | "autre";
  price: number;
  description?: string;
  durationMinutes: number;
  active: boolean;
  createdAt: string;
}

export interface ServiceRecord {
  _id: string;
  serviceId:
    | { _id: string; name: string; category: "technique" | "compte" | "autre" }
    | string;
  franchiseId: Franchise | string;
  clientId?: { _id: string; fullName: string; phone?: string } | string | null;
  userId?:
    | { _id: string; fullName?: string; username?: string; role?: string }
    | string;
  billedPrice: number;
  note?: string;
  performedAt: string;
}

export interface NetworkPoint {
  _id: string;
  name: string;
  type: "franchise" | "activation" | "recharge" | "activation_recharge";
  status:
    | "prospect"
    | "contact"
    | "contrat_non_signe"
    | "contrat_signe"
    | "actif"
    | "suspendu"
    | "resilie";
  leadStatus?:
    | "lead"
    | "contacted"
    | "qualified"
    | "contract_given"
    | "won"
    | "lost";
  address?: string;
  city?: string;
  governorate?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  responsible?: string;
  responsibleFirstName?: string;
  responsibleLastName?: string;
  cin?: string;
  documents?: {
    cinImagePath?: string | null;
    shopImagePath?: string | null;
    signaturePath?: string | null;
    signatureText?: string | null;
    infoSheetPdfPath?: string | null;
    signedAt?: string | null;
    generatedAt?: string | null;
  };
  schedule?: string;
  gps?: {
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
  };
  internalNotes?: string;
  franchiseId?: Franchise | string | null;
  commercialId?: User | string | null;
  zoneId?: CommercialZone | string | null;
  contractGiven?: boolean;
  contractGivenAt?: string | null;
  lastContactedAt?: string | null;
  contactDate?: string | null;
  contractDate?: string | null;
  activationDate?: string | null;
  commissionPct?: number;
  allocationStats?: {
    totalSims: number;
    totalRecharge: number;
    monthlySims: number;
    monthlyRecharge: number;
    allocationCount: number;
    lastAllocationAt?: string | null;
    daysSinceAllocation?: number | null;
    recommendation?:
      | "worthy"
      | "watch"
      | "review"
      | "dormant"
      | "revoke_candidate"
      | "revoked";
  };
  active: boolean;
  createdAt?: string;
}

export interface NetworkPointAllocation {
  _id: string;
  networkPointId: NetworkPoint | string;
  franchiseId: Franchise | string;
  productId?: Product | string | null;
  kind: "sim" | "recharge" | "other";
  quantity: number;
  amount?: number;
  barcodes: string[];
  note?: string;
  commercialId?: User | string | null;
  createdBy?: User | string;
  createdAt: string;
}

export interface CommercialZone {
  _id: string;
  name: string;
  color?: string;
  franchiseId?: Franchise | string | null;
  assignedCommercialIds?: User[] | string[];
  polygon: Array<{ lat: number; lng: number }>;
  note?: string;
  active: boolean;
  createdAt?: string;
}

export interface AppNotification {
  _id: string;
  userId?: string | null;
  franchiseId?: string | null;
  roleTarget?: Role | "all" | null;
  roleTargets?: Array<Role | "all">;
  title: string;
  message: string;
  type: "info" | "warning" | "danger" | "success";
  link?: string;
  readAt?: string | null;
  createdAt: string;
}

export interface ProductOverview {
  product: Omit<Product, "categoryId" | "supplierId"> & {
    categoryId?: { _id: string; name: string } | string;
    supplierId?: { _id: string; name: string } | string | null;
  };
  stockByFranchise: Array<{
    franchiseId: string;
    franchiseName: string;
    quantity: number;
  }>;
  recentMovements: Movement[];
  salesStats: {
    sales30d: number;
    sales90d: number;
    revenue30d: number;
    revenue90d: number;
  };
}

export interface ClientOverview {
  client: Client;
  salesSummary: {
    totalSpent: number;
    saleCount: number;
    lastSaleAt?: string | null;
  };
  installmentSummary: {
    balanceDue: number;
    pendingInstallments: number;
    lateInstallments: number;
    paidInstallments: number;
    totalInstallments: number;
  };
  creditScore?: ClientCreditScore | null;
  creditScoreHistory?: ClientCreditScoreSnapshot[];
  recentCreditOverrides?: ClientCreditOverrideRequest[];
  creditRestricted?: boolean;
  recentSales: Sale[];
  recentInstallments: Installment[];
}
