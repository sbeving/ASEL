export type Role = 'admin' | 'manager' | 'franchise' | 'seller';

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
