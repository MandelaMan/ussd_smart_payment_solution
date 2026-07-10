import { ChakraProvider } from "@chakra-ui/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { system } from "./theme";
import { AuthProvider } from "./lib/auth";
import { Layout } from "./components/Layout";
import { ScrollToTop } from "./components/ScrollToTop";
import {
  ProtectedRoute,
  AdminRoute,
  FinanceRoute,
  ReportsRoute,
  ConfigRoute,
  CustomerWriteRoute,
} from "./components/ProtectedRoute";
import { RoleHomePage } from "./pages/RoleHomePage";
import { AppToaster } from "./components/ui/AppToaster";
import { LoginPage } from "./pages/LoginPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { CustomersListPage } from "./pages/CustomersListPage";
import { NewCustomerPage } from "./pages/NewCustomerPage";
import { BuildingsPage } from "./pages/BuildingsPage";
import { ProductsPage } from "./pages/ProductsPage";
import { AgenciesPage } from "./pages/AgenciesPage";
import { AgencyDetailPage } from "./pages/AgencyDetailPage";
import { LogsPage } from "./pages/LogsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ApartmentHistoryPage } from "./pages/ApartmentHistoryPage";
import { BillingReconciliationLayout } from "./pages/billing/BillingReconciliationLayout";
import { BillingOverviewPage } from "./pages/billing/BillingOverviewPage";
import { BillingModulePage } from "./pages/billing/BillingModulePage";
import { BillingUnallocatedMpesaPage } from "./pages/billing/BillingUnallocatedMpesaPage";
import { BillingCommunicationsPage } from "./pages/billing/BillingCommunicationsPage";
import { BusinessIntelligencePage } from "./pages/BusinessIntelligencePage";
import { SynchronizationPage } from "./pages/SynchronizationPage";
import { ActivityPage } from "./pages/ActivityPage";

export default function App() {
  return (
    <ChakraProvider value={system}>
      <AuthProvider>
        <BrowserRouter basename="/admin">
          <ScrollToTop />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route index element={<RoleHomePage />} />
                <Route path="activity" element={<ActivityPage />} />
                <Route element={<FinanceRoute />}>
                  <Route path="transactions" element={<TransactionsPage />} />
                  <Route path="synchronization" element={<SynchronizationPage />} />
                  <Route path="analytics" element={<BusinessIntelligencePage />} />
                  <Route path="billing" element={<BillingReconciliationLayout />}>
                    <Route index element={<BillingOverviewPage />} />
                    <Route path="unallocated-mpesa" element={<BillingUnallocatedMpesaPage />} />
                    <Route path="billing-gaps" element={<BillingModulePage />} />
                    <Route path="zoho-billing-gaps" element={<Navigate to="/billing/billing-gaps" replace />} />
                    <Route path="no-zoho-link" element={<Navigate to="/billing/billing-gaps" replace />} />
                    <Route path="recurring-invoices" element={<Navigate to="/billing/billing-gaps" replace />} />
                    <Route path="missing-invoices" element={<Navigate to="/billing/billing-gaps" replace />} />
                    <Route
                      path="disconnected-not-invoiced"
                      element={<Navigate to="/billing/billing-gaps" replace />}
                    />
                    <Route path="manual-review" element={<BillingModulePage />} />
                    <Route path="communications" element={<BillingCommunicationsPage />} />
                  </Route>
                </Route>
                <Route element={<ReportsRoute />}>
                  <Route path="reports" element={<ReportsPage />} />
                </Route>
                <Route element={<AdminRoute />}>
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="logs" element={<LogsPage />} />
                  <Route path="users" element={<Navigate to="/settings" replace />} />
                </Route>
                <Route path="customers" element={<CustomersListPage />} />
                <Route element={<CustomerWriteRoute />}>
                  <Route path="customers/new" element={<NewCustomerPage />} />
                </Route>
                <Route element={<ConfigRoute />}>
                  <Route path="apartments" element={<ApartmentHistoryPage />} />
                  <Route path="buildings" element={<BuildingsPage />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="agencies" element={<AgenciesPage />} />
                  <Route path="agencies/:id" element={<AgencyDetailPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <AppToaster />
      </AuthProvider>
    </ChakraProvider>
  );
}
