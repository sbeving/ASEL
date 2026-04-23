export type Role = 'admin' | 'superadmin' | 'manager' | 'franchise' | 'seller' | 'vendeur' | 'viewer';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  franchiseId: string | null;
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
  gps?: {
    lat: number;
    lng: number;
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
  clientType?: 'walkin' | 'boutique' | 'wholesale' | 'passager' | 'other';
  company?: string;
  taxId?: string;
  cin?: string;
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
}

export interface Product {
  _id: string;
  name: string;
  categoryId: string;
  supplierId?: string | null;
  brand?: string;
  reference?: string;
  barcode?: string;
  description?: string;
  purchasePrice: number;
  sellPrice: number;
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
  total: number;
}

export interface Sale {
  _id: string;
  invoiceNumber?: string | null;
  saleType: 'ticket' | 'facture' | 'devis';
  franchiseId: Franchise | string;
  clientId?: Client | string | null;
  userId: User | string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'installment' | 'other';
  paymentStatus: 'paid' | 'partial' | 'pending';
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
  createdAt: string;
}

export interface Transfer {
  _id: string;
  sourceFranchiseId: Franchise | string;
  destFranchiseId: Franchise | string;
  productId: Product | string;
  quantity: number;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
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
}

export interface AuditLog {
  _id: string;
  userId?: string | null;
  username?: string | null;
  action: string;
  entity?: string;
  entityId?: string | null;
  details?: unknown;
  ip?: string;
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
  status: 'draft' | 'finalized';
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
  status: 'draft' | 'validated' | 'cancelled';
  totalHt: number;
  vat: number;
  totalTtc: number;
  note?: string;
  userId?: User | string;
  validatedBy?: User | string | null;
  validatedAt?: string | null;
  lines: ReceptionLine[];
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
  dueDate: string;
  status: 'pending' | 'paid' | 'late';
  paidAt?: string | null;
  paymentMethod?: string | null;
  note?: string;
  userId?: User | string;
  createdAt: string;
}

export interface ReturnRecord {
  _id: string;
  franchiseId: Franchise | string;
  productId: { _id: string; name: string; reference?: string; barcode?: string } | string;
  quantity: number;
  returnType: 'return' | 'exchange';
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
  urgency: 'normal' | 'urgent' | 'critical';
  status: 'pending' | 'approved' | 'rejected' | 'delivered';
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
  category: 'technique' | 'compte' | 'autre';
  price: number;
  description?: string;
  durationMinutes: number;
  active: boolean;
  createdAt: string;
}

export interface ServiceRecord {
  _id: string;
  serviceId:
    | { _id: string; name: string; category: 'technique' | 'compte' | 'autre' }
    | string;
  franchiseId: Franchise | string;
  clientId?: { _id: string; fullName: string; phone?: string } | string | null;
  userId?: { _id: string; fullName?: string; username?: string; role?: string } | string;
  billedPrice: number;
  note?: string;
  performedAt: string;
}

export interface NetworkPoint {
  _id: string;
  name: string;
  type: 'franchise' | 'activation' | 'recharge' | 'activation_recharge';
  status: 'prospect' | 'contact' | 'contrat_non_signe' | 'contrat_signe' | 'actif' | 'suspendu' | 'resilie';
  address?: string;
  city?: string;
  governorate?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  responsible?: string;
  schedule?: string;
  gps?: {
    lat?: number | null;
    lng?: number | null;
  };
  internalNotes?: string;
  franchiseId?: Franchise | string | null;
  contactDate?: string | null;
  contractDate?: string | null;
  activationDate?: string | null;
  commissionPct?: number;
  active: boolean;
  createdAt?: string;
}

export interface ProductOverview {
  product: Omit<Product, 'categoryId' | 'supplierId'> & {
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
  };
  recentSales: Sale[];
  recentInstallments: Installment[];
}
