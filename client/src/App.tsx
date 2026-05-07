import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';

const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const ProductsPage = lazy(() => import('./pages/ProductsPage').then((module) => ({ default: module.ProductsPage })));
const StockPage = lazy(() => import('./pages/StockPage').then((module) => ({ default: module.StockPage })));
const SalesPage = lazy(() => import('./pages/SalesPage').then((module) => ({ default: module.SalesPage })));
const POSPage = lazy(() => import('./pages/POSPage').then((module) => ({ default: module.POSPage })));
const TransfersPage = lazy(() => import('./pages/TransfersPage').then((module) => ({ default: module.TransfersPage })));
const FranchisesPage = lazy(() => import('./pages/FranchisesPage').then((module) => ({ default: module.FranchisesPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((module) => ({ default: module.UsersPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((module) => ({ default: module.CategoriesPage })));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage').then((module) => ({ default: module.SuppliersPage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then((module) => ({ default: module.AuditPage })));
const ClientsPage = lazy(() => import('./pages/ClientsPage').then((module) => ({ default: module.ClientsPage })));
const ReceptionsPage = lazy(() => import('./pages/ReceptionsPage').then((module) => ({ default: module.ReceptionsPage })));
const ClosingsPage = lazy(() => import('./pages/ClosingsPage').then((module) => ({ default: module.ClosingsPage })));
const InstallmentsPage = lazy(() => import('./pages/InstallmentsPage').then((module) => ({ default: module.InstallmentsPage })));
const MonthlyInventoryPage = lazy(() => import('./pages/MonthlyInventoryPage').then((module) => ({ default: module.MonthlyInventoryPage })));
const MapPage = lazy(() => import('./pages/MapPage').then((module) => ({ default: module.MapPage })));
const ReturnsPage = lazy(() => import('./pages/ReturnsPage').then((module) => ({ default: module.ReturnsPage })));
const TimeLogsPage = lazy(() => import('./pages/TimeLogsPage').then((module) => ({ default: module.TimeLogsPage })));
const HrPage = lazy(() => import('./pages/HrPage').then((module) => ({ default: module.HrPage })));
const DemandsPage = lazy(() => import('./pages/DemandsPage').then((module) => ({ default: module.DemandsPage })));
const ServicesPage = lazy(() => import('./pages/ServicesPage').then((module) => ({ default: module.ServicesPage })));
const NetworkPointsPage = lazy(() => import('./pages/NetworkPointsPage').then((module) => ({ default: module.NetworkPointsPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })));
const CashFlowsPage = lazy(() => import('./pages/CashFlowsPage').then((module) => ({ default: module.CashFlowsPage })));

const ERP_ROLES = ['ceo', 'admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur', 'viewer'] as const;
const STOCK_VIEW_ROLES = ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer', 'franchise', 'seller', 'vendeur', 'viewer'] as const;
const STAFF_ROLES = ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'stock_central_maintainer', 'cash_central_maintainer', 'hr_admin', 'franchise', 'seller', 'vendeur', 'commercial', 'siege_employee'] as const;
const COMMERCIAL_ROLES = ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'franchise', 'commercial'] as const;
const FRANCHISE_OPS_ROLES = ['ceo', 'admin', 'superadmin', 'manager', 'franchise'] as const;
const STOCK_OPS_ROLES = ['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer', 'franchise'] as const;
const CASH_ROLES = ['ceo', 'admin', 'superadmin', 'manager', 'cash_central_maintainer', 'franchise'] as const;
const HR_ROLES = ['ceo', 'admin', 'superadmin', 'manager', 'commercial_director', 'hr_admin', 'franchise'] as const;
const NOTIFICATION_ROLES = [...STAFF_ROLES, 'viewer'] as const;

function HomeRoute() {
  return <DashboardPage />;
}

function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-sm font-medium text-slate-600">
      Chargement...
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
        <Route index element={<HomeRoute />} />
        <Route
          path="stock"
          element={
            <ProtectedRoute roles={[...STOCK_VIEW_ROLES]}>
              <StockPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="sales"
          element={
            <ProtectedRoute roles={[...ERP_ROLES]}>
              <SalesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="pos"
          element={
            <ProtectedRoute roles={['ceo', 'admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur']}>
              <POSPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="clients"
          element={
            <ProtectedRoute roles={[...ERP_ROLES]}>
              <ClientsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="services"
          element={
            <ProtectedRoute roles={[...ERP_ROLES]}>
              <ServicesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="transfers"
          element={
            <ProtectedRoute roles={[...FRANCHISE_OPS_ROLES]}>
              <TransfersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="demands"
          element={
            <ProtectedRoute roles={['ceo', 'admin', 'superadmin', 'manager', 'franchise', 'seller', 'vendeur']}>
              <DemandsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="notifications"
          element={
            <ProtectedRoute roles={[...NOTIFICATION_ROLES]}>
              <NotificationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="network-points"
          element={
            <ProtectedRoute roles={[...COMMERCIAL_ROLES]}>
              <NetworkPointsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="receptions"
          element={
            <ProtectedRoute roles={[...FRANCHISE_OPS_ROLES]}>
              <ReceptionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="returns"
          element={
            <ProtectedRoute roles={[...ERP_ROLES]}>
              <ReturnsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="timelogs"
          element={
            <ProtectedRoute roles={[...STAFF_ROLES]}>
              <TimeLogsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="hr"
          element={
            <ProtectedRoute roles={[...HR_ROLES]}>
              <HrPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="cashflows"
          element={
            <ProtectedRoute roles={[...CASH_ROLES]}>
              <CashFlowsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="closings"
          element={
            <ProtectedRoute roles={[...FRANCHISE_OPS_ROLES]}>
              <ClosingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="installments"
          element={
            <ProtectedRoute roles={[...FRANCHISE_OPS_ROLES]}>
              <InstallmentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="monthly-inventory"
          element={
            <ProtectedRoute roles={[...STOCK_OPS_ROLES]}>
              <MonthlyInventoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="products"
          element={
            <ProtectedRoute roles={[...STOCK_VIEW_ROLES]}>
              <ProductsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="categories"
          element={
            <ProtectedRoute roles={['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer']}>
              <CategoriesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="suppliers"
          element={
            <ProtectedRoute roles={['ceo', 'admin', 'superadmin', 'manager', 'stock_central_maintainer']}>
              <SuppliersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="franchises"
          element={
            <ProtectedRoute roles={['ceo', 'admin', 'superadmin', 'manager', 'franchise']}>
              <FranchisesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="users"
          element={
            <ProtectedRoute roles={['ceo', 'admin', 'superadmin', 'manager', 'hr_admin']}>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="audit"
          element={
            <ProtectedRoute roles={['ceo', 'admin', 'superadmin']}>
              <AuditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="map"
          element={
            <ProtectedRoute roles={[...COMMERCIAL_ROLES]}>
              <MapPage />
            </ProtectedRoute>
          }
        />
        </Route>
      </Routes>
    </Suspense>
  );
}
