import { Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { system } from "./theme";
import { AuthProvider } from "./lib/AuthProvider";
import { Layout } from "./components/Layout";
import { ScrollToTop } from "./components/ScrollToTop";
import {
  ProtectedRoute,
  AdminRoute,
  SettingsRoute,
  TransactionsRoute,
  BillingRoute,
  AnalyticsRoute,
  ReportsRoute,
  CustomerWriteRoute,
  CustomerReadRoute,
  ActivityRoute,
  InstallationsRoute,
  RemindersRoute,
  LeadsRoute,
  CommunicationRoute,
  ApartmentsRoute,
  BuildingsRoute,
  PackagesRoute,
  AgenciesRoute,
  CampaignsRoute,
} from "./components/ProtectedRoute";
import { BootSplashGate } from "./components/BootSplashGate";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ConnectivityBanner } from "./components/ConnectivityBanner";
import { AppToaster } from "./components/ui/AppToaster";
import { AppUpdateBanner } from "./components/ui/AppUpdateBanner";
import { RouteContentSkeleton } from "./components/PageSkeletons";
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";

function lazyPage<T extends Record<string, unknown>>(
  loader: () => Promise<T>,
  exportName: keyof T & string
) {
  return lazy(async () => {
    const load = async () => {
      const mod = await loader();
      return { default: mod[exportName] as ComponentType };
    };
    try {
      return await load();
    } catch {
      // Vite HMR can invalidate a route chunk mid-import; retry once.
      await new Promise((resolve) => setTimeout(resolve, 200));
      return await load();
    }
  });
}

const RoleHomePage = lazyPage(() => import("./pages/RoleHomePage"), "RoleHomePage");
const ActivityPage = lazyPage(() => import("./pages/ActivityPage"), "ActivityPage");
const ActivityAuditPage = lazyPage(
  () => import("./pages/ActivityAuditPage"),
  "ActivityAuditPage"
);
const LeadsPage = lazyPage(() => import("./pages/LeadsPage"), "LeadsPage");
const CommunicationPage = lazyPage(
  () => import("./pages/CommunicationPage"),
  "CommunicationPage"
);
const TransactionsPage = lazyPage(() => import("./pages/TransactionsPage"), "TransactionsPage");
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
const ReportsPage = lazyPage(() => import("./pages/ReportsPage"), "ReportsPage");
const SettingsPage = lazyPage(() => import("./pages/SettingsPage"), "SettingsPage");
const CustomersListPage = lazyPage(
  () => import("./pages/CustomersListPage"),
  "CustomersListPage"
);
const NewCustomerPage = lazyPage(() => import("./pages/NewCustomerPage"), "NewCustomerPage");
const ApartmentHistoryPage = lazyPage(
  () => import("./pages/ApartmentHistoryPage"),
  "ApartmentHistoryPage"
);
const ApartmentsPage = lazyPage(() => import("./pages/ApartmentsPage"), "ApartmentsPage");
const ApartmentDetailLayout = lazyPage(
  () => import("./pages/ApartmentDetailLayout"),
  "ApartmentDetailLayout"
);
const ApartmentOverviewPage = lazyPage(
  () => import("./pages/ApartmentOverviewPage"),
  "ApartmentOverviewPage"
);
const ApartmentUnitHistoryPage = lazyPage(
  () => import("./pages/ApartmentUnitHistoryPage"),
  "ApartmentUnitHistoryPage"
);
const BuildingsPage = lazyPage(() => import("./pages/BuildingsPage"), "BuildingsPage");
const ProductsPage = lazyPage(() => import("./pages/ProductsPage"), "ProductsPage");
const AgenciesPage = lazyPage(() => import("./pages/AgenciesPage"), "AgenciesPage");
const CampaignsPage = lazyPage(() => import("./pages/CampaignsPage"), "CampaignsPage");
const InstallationsPage = lazyPage(() => import("./pages/InstallationsPage"), "InstallationsPage");
const RemindersPage = lazyPage(() => import("./pages/RemindersPage"), "RemindersPage");
const AgencyDetailPage = lazyPage(
  () => import("./pages/AgencyDetailPage"),
  "AgencyDetailPage"
);

function RouteFallback() {
  return <RouteContentSkeleton />;
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export default function App() {
  return (
    <ChakraProvider value={system}>
      <AppErrorBoundary>
        <BrowserRouter basename="/admin">
          <AuthProvider>
            <BootSplashGate />
            <ScrollToTop />
            <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<ProtectedRoute />}>
              <Route
                path="change-password"
                element={<ChangePasswordPage />}
              />
              <Route element={<Layout />}>
                <Route
                  index
                  element={
                    <LazyRoute>
                      <RoleHomePage />
                    </LazyRoute>
                  }
                />
                <Route element={<ActivityRoute />}>
                  <Route
                    path="activity"
                    element={
                      <LazyRoute>
                        <ActivityPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<TransactionsRoute />}>
                  <Route
                    path="transactions"
                    element={
                      <LazyRoute>
                        <TransactionsPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route
                  path="synchronization"
                  element={<Navigate to="/settings?tab=synchronization" replace />}
                />
                <Route element={<AnalyticsRoute />}>
                  <Route
                    path="analytics"
                    element={
                      <LazyRoute>
                        <BusinessIntelligencePage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<BillingRoute />}>
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
                      element={<Navigate to="/billing" replace />}
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
                      element={<Navigate to="/billing" replace />}
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
                <Route element={<SettingsRoute />}>
                  <Route
                    path="settings"
                    element={
                      <LazyRoute>
                        <SettingsPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<AdminRoute />}>
                  <Route
                    path="activity-audit"
                    element={
                      <LazyRoute>
                        <ActivityAuditPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="logs"
                    element={<Navigate to="/settings?tab=logs" replace />}
                  />
                  <Route path="users" element={<Navigate to="/settings" replace />} />
                </Route>
                <Route element={<CustomerReadRoute />}>
                  <Route
                    path="customers"
                    element={
                      <LazyRoute>
                        <CustomersListPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<LeadsRoute />}>
                  <Route
                    path="leads"
                    element={
                      <LazyRoute>
                        <LeadsPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<CommunicationRoute />}>
                  <Route
                    path="communication"
                    element={
                      <LazyRoute>
                        <CommunicationPage />
                      </LazyRoute>
                    }
                  />
                </Route>
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
                <Route element={<InstallationsRoute />}>
                  <Route
                    path="installations"
                    element={
                      <LazyRoute>
                        <InstallationsPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<RemindersRoute />}>
                  <Route
                    path="reminders"
                    element={
                      <LazyRoute>
                        <RemindersPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<ApartmentsRoute />}>
                  <Route
                    path="apartments"
                    element={
                      <LazyRoute>
                        <ApartmentsPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="apartments/ledger"
                    element={
                      <LazyRoute>
                        <ApartmentHistoryPage />
                      </LazyRoute>
                    }
                  />
                  <Route
                    path="apartments/:buildingId/:apartmentNumber"
                    element={
                      <LazyRoute>
                        <ApartmentDetailLayout />
                      </LazyRoute>
                    }
                  >
                    <Route
                      index
                      element={
                        <LazyRoute>
                          <ApartmentOverviewPage />
                        </LazyRoute>
                      }
                    />
                    <Route
                      path="history"
                      element={
                        <LazyRoute>
                          <ApartmentUnitHistoryPage />
                        </LazyRoute>
                      }
                    />
                  </Route>
                </Route>
                <Route element={<BuildingsRoute />}>
                  <Route
                    path="buildings"
                    element={
                      <LazyRoute>
                        <BuildingsPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<PackagesRoute />}>
                  <Route
                    path="products"
                    element={
                      <LazyRoute>
                        <ProductsPage />
                      </LazyRoute>
                    }
                  />
                </Route>
                <Route element={<AgenciesRoute />}>
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
                <Route element={<CampaignsRoute />}>
                  <Route
                    path="campaigns"
                    element={
                      <LazyRoute>
                        <CampaignsPage />
                      </LazyRoute>
                    }
                  />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <ConnectivityBanner />
          <AppUpdateBanner />
          <AppToaster />
        </AuthProvider>
        </BrowserRouter>
      </AppErrorBoundary>
    </ChakraProvider>
  );
}
