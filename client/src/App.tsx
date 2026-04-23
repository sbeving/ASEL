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
        <Route index element={<DashboardPage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="pos" element={<POSPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="transfers" element={<TransfersPage />} />
        <Route path="receptions" element={<ReceptionsPage />} />
        <Route path="closings" element={<ClosingsPage />} />
        <Route path="installments" element={<InstallmentsPage />} />
        <Route path="monthly-inventory" element={<MonthlyInventoryPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route
          path="categories"
          element={
            <ProtectedRoute roles={['admin', 'superadmin', 'manager']}>
              <CategoriesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="suppliers"
          element={
            <ProtectedRoute roles={['admin', 'superadmin', 'manager']}>
              <SuppliersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="franchises"
          element={
            <ProtectedRoute roles={['admin', 'superadmin']}>
              <FranchisesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="users"
          element={
            <ProtectedRoute roles={['admin', 'superadmin']}>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="audit"
          element={
            <ProtectedRoute roles={['admin', 'superadmin']}>
              <AuditPage />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  );
}
