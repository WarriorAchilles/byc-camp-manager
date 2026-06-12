import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AdminLayout } from "./pages/AdminLayout";
import { CampConfigurationPage } from "./pages/CampConfigurationPage";
import { LoginPage } from "./pages/LoginPage";
import { DormsPage } from "./pages/DormsPage";
import { ImportsPage } from "./pages/ImportsPage";
import { CamperSelfCheckInPage } from "./pages/CamperSelfCheckInPage";
import { CheckInPage } from "./pages/CheckInPage";
import { PeoplePage } from "./pages/PeoplePage";
import { ReportsPage } from "./pages/ReportsPage";
import { SelfCheckInQrPage } from "./pages/SelfCheckInQrPage";
import { UsersAdminPage } from "./pages/UsersAdminPage";

function FullPageAuthLoading(): React.ReactElement {
  return (
    <main className="app-loading-shell" aria-busy="true" aria-live="polite">
      <p className="app-loading-text">
        Loading<span className="app-loading-dots">…</span>
      </p>
    </main>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }): React.ReactElement {
  const { user, loading } = useAuth();
  if (loading) {
    return <FullPageAuthLoading />;
  }
  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }
  return <>{children}</>;
}

function SuperAdminRoute({ children }: { children: React.ReactElement }): React.ReactElement {
  const { user, loading } = useAuth();
  if (loading) {
    return <FullPageAuthLoading />;
  }
  if (user?.role !== "super_admin") {
    return <Navigate to="/admin/people" replace />;
  }
  return children;
}

export function App(): React.ReactElement {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/self-check-in/:token" element={<CamperSelfCheckInPage />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<CheckInPage />} />
          <Route path="check-in" element={<Navigate to="/admin" replace />} />
          <Route path="self-check-in-qr" element={<SelfCheckInQrPage />} />
          <Route
            path="camp"
            element={
              <SuperAdminRoute>
                <CampConfigurationPage />
              </SuperAdminRoute>
            }
          />
          <Route path="people" element={<PeoplePage />} />
          <Route
            path="people/add"
            element={
              <SuperAdminRoute>
                <PeoplePage mode="add" />
              </SuperAdminRoute>
            }
          />
          <Route path="imports" element={<ImportsPage />} />
          <Route path="dorms" element={<DormsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="users" element={<UsersAdminPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AuthProvider>
  );
}
