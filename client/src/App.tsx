
import { Routes, Route } from 'react-router-dom';

import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { StockPage } from './pages/StockPage';
import { SalesPage } from './pages/SalesPage';
import { POSPage } from './pages/POSPage';
import { TransfersPage } from './pages/TransfersPage';
import { FranchisesPage } from './pages/FranchisesPage';
import { UsersPage } from './pages/UsersPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { AuditPage } from './pages/AuditPage';
import { ClientsPage } from './pages/ClientsPage';
import { ReceptionsPage } from './pages/ReceptionsPage';
import { ClosingsPage } from './pages/ClosingsPage';
import { InstallmentsPage } from './pages/InstallmentsPage';
import { MonthlyInventoryPage } from './pages/MonthlyInventoryPage';
import { MapPage } from './pages/MapPage';
import { ReturnsPage } from './pages/ReturnsPage';
import { TimeLogsPage } from './pages/TimeLogsPage';
import { HrPage } from './pages/HrPage';
import { DemandsPage } from './pages/DemandsPage';
import { ServicesPage } from './pages/ServicesPage';
import { NetworkPointsPage } from './pages/NetworkPointsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { CashFlowsPage } from './pages/CashFlowsPage';

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

export default function App() {
  return (
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
  );
}
