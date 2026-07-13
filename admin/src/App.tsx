import { Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { ChakraProvider, Flex, Spinner } from "@chakra-ui/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { system, BRAND } from "./theme";
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
import { AppToaster } from "./components/ui/AppToaster";
import { LoginPage } from "./pages/LoginPage";

function lazyPage<T extends Record<string, ComponentType>>(
  loader: () => Promise<T>,
  exportName: keyof T
) {
  return lazy(async () => {
    const mod = await loader();
    return { default: mod[exportName] as ComponentType };
  });
}

const RoleHomePage = lazyPage(() => import("./pages/RoleHomePage"), "RoleHomePage");
const ActivityPage = lazyPage(() => import("./pages/ActivityPage"), "ActivityPage");
const TransactionsPage = lazyPage(() => import("./pages/TransactionsPage"), "TransactionsPage");
const SynchronizationPage = lazyPage(
  () => import("./pages/SynchronizationPage"),
  "SynchronizationPage"
);
const BusinessIntelligencePage = lazyPage(
  () => import("./pages/BusinessIntelligencePage"),
  "BusinessIntelligencePage"
);
const BillingReconciliationLayout = lazyPage(
  () => import("./pages/billing/BillingReconciliationLayout"),
  "BillingReconciliationLayout"
);
const BillingOverviewPage = lazyPage(
  () => import("./pages/billing/BillingOverviewPage"),
  "BillingOverviewPage"
);
const BillingModulePage = lazyPage(
  () => import("./pages/billing/BillingModulePage"),
  "BillingModulePage"
);
const BillingUnallocatedMpesaPage = lazyPage(
  () => import("./pages/billing/BillingUnallocatedMpesaPage"),
  "BillingUnallocatedMpesaPage"
);
const BillingCommunicationsPage = lazyPage(
  () => import("./pages/billing/BillingCommunicationsPage"),
  "BillingCommunicationsPage"
);
const ReportsPage = lazyPage(() => import("./pages/ReportsPage"), "ReportsPage");
const SettingsPage = lazyPage(() => import("./pages/SettingsPage"), "SettingsPage");
const LogsPage = lazyPage(() => import("./pages/LogsPage"), "LogsPage");
const CustomersListPage = lazyPage(
  () => import("./pages/CustomersListPage"),
  "CustomersListPage"
);
const NewCustomerPage = lazyPage(() => import("./pages/NewCustomerPage"), "NewCustomerPage");
const ApartmentHistoryPage = lazyPage(
  () => import("./pages/ApartmentHistoryPage"),
  "ApartmentHistoryPage"
);
const BuildingsPage = lazyPage(() => import("./pages/BuildingsPage"), "BuildingsPage");
const ProductsPage = lazyPage(() => import("./pages/ProductsPage"), "ProductsPage");
const AgenciesPage = lazyPage(() => import("./pages/AgenciesPage"), "AgenciesPage");
const AgencyDetailPage = lazyPage(
  () => import("./pages/AgencyDetailPage"),
  "AgencyDetailPage"
);

function RouteFallback() {
  return (
    <Flex minH="40vh" align="center" justify="center" py={10}>
      <Spinner color={BRAND.cerulean} size="lg" borderWidth="3px" />
    </Flex>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

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
                <Route
                  index
                  element={
                    <LazyRoute>
                      <RoleHomePage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="activity"
                  element={
                    <LazyRoute>
                      <ActivityPage />
                    </LazyRoute>
                  }
                />
                <Route element={<FinanceRoute />}>
                  <Route
                    path="transactions"
                    element={
                      <LazyRoute>
                        <TransactionsPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="synchronization"
                    element={
                      <LazyRoute>
                        <SynchronizationPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="analytics"
                    element={
                      <LazyRoute>
                        <BusinessIntelligencePage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="billing"
                    element={
                      <LazyRoute>
                        <BillingReconciliationLayout />
                      </LazyRoute>
                    }
                  >
                    <Route
                      index
                      element={
                        <LazyRoute>
                          <BillingOverviewPage />
                        </LazyRoute>
                      }
                    />
                    <Route
                      path="unallocated-mpesa"
                      element={
                        <LazyRoute>
                          <BillingUnallocatedMpesaPage />
                        </LazyRoute>
                      }
                    />
                    <Route
                      path="billing-gaps"
                      element={
                        <LazyRoute>
                          <BillingModulePage />
                        </LazyRoute>
                      }
                    />
                    <Route
                      path="zoho-billing-gaps"
                      element={<Navigate to="/billing/billing-gaps" replace />}
                    />
                    <Route
                      path="no-zoho-link"
                      element={<Navigate to="/billing/billing-gaps" replace />}
                    />
                    <Route
                      path="recurring-invoices"
                      element={<Navigate to="/billing/billing-gaps" replace />}
                    />
                    <Route
                      path="missing-invoices"
                      element={<Navigate to="/billing/billing-gaps" replace />}
                    />
                    <Route
                      path="disconnected-not-invoiced"
                      element={<Navigate to="/billing/billing-gaps" replace />}
                    />
                    <Route
                      path="manual-review"
                      element={
                        <LazyRoute>
                          <BillingModulePage />
                        </LazyRoute>
                      }
                    />
                    <Route
                      path="communications"
                      element={
                        <LazyRoute>
                          <BillingCommunicationsPage />
                        </LazyRoute>
                      }
                    />
                  </Route>
                </Route>
                <Route element={<ReportsRoute />}>
                  <Route
                    path="reports"
                    element={
                      <LazyRoute>
                        <ReportsPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<AdminRoute />}>
                  <Route
                    path="settings"
                    element={
                      <LazyRoute>
                        <SettingsPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="logs"
                    element={
                      <LazyRoute>
                        <LogsPage />
                      </LazyRoute>
                    }
                  />
                  <Route path="users" element={<Navigate to="/settings" replace />} />
                </Route>
                <Route
                  path="customers"
                  element={
                    <LazyRoute>
                      <CustomersListPage />
                    </LazyRoute>
                  }
                />
                <Route element={<CustomerWriteRoute />}>
                  <Route
                    path="customers/new"
                    element={
                      <LazyRoute>
                        <NewCustomerPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<ConfigRoute />}>
                  <Route
                    path="apartments"
                    element={
                      <LazyRoute>
                        <ApartmentHistoryPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="buildings"
                    element={
                      <LazyRoute>
                        <BuildingsPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="products"
                    element={
                      <LazyRoute>
                        <ProductsPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="agencies"
                    element={
                      <LazyRoute>
                        <AgenciesPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="agencies/:id"
                    element={
                      <LazyRoute>
                        <AgencyDetailPage />
                      </LazyRoute>
                    }
                  />
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
