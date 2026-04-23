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
  email?: string;
  franchiseId?: Franchise | string | null;
  active: boolean;
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
  franchiseId: string;
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
  franchiseId: Franchise | string;
  userId: User | string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'other';
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
