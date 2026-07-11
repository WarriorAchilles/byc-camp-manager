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
import { RandomCamperSelectorPage } from "./pages/RandomCamperSelectorPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SelfCheckInQrPage } from "./pages/SelfCheckInQrPage";
import { UsersAdminPage } from "./pages/UsersAdminPage";
import { PublicRegistrationPage } from "./pages/PublicRegistrationPage";
import { resolveBrowserSurface } from "./publicSurface";

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
  const surface = resolveBrowserSurface({
    currentOrigin: window.location.origin,
    currentHostname: window.location.hostname,
    registrationOrigin: import.meta.env.VITE_REGISTRATION_PUBLIC_ORIGIN,
  });

  if (surface === "registration") {
    return (
      <Routes>
        <Route path="/register/family" element={<PublicRegistrationPage flow="family" />} />
        <Route path="/register/worker" element={<PublicRegistrationPage flow="worker" />} />
        <Route path="/" element={<Navigate to="/register/family" replace />} />
        <Route path="*" element={<Navigate to="/register/family" replace />} />
      </Routes>
    );
  }

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
          <Route path="random-campers" element={<RandomCamperSelectorPage />} />
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
