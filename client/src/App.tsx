import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AdminLayout } from "./pages/AdminLayout";
import { CampConfigurationPage } from "./pages/CampConfigurationPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { ImportsPage } from "./pages/ImportsPage";
import { PeoplePage } from "./pages/PeoplePage";
import { UsersAdminPage } from "./pages/UsersAdminPage";

function ProtectedRoute({ children }: { children: React.ReactNode }): React.ReactElement {
  const { user, loading } = useAuth();
  if (loading) {
    return <main className="muted">Loading…</main>;
  }
  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }
  return <>{children}</>;
}

export function App(): React.ReactElement {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/admin/login" element={<LoginPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="camp" element={<CampConfigurationPage />} />
          <Route path="people" element={<PeoplePage />} />
          <Route path="imports" element={<ImportsPage />} />
          <Route path="users" element={<UsersAdminPage />} />
        </Route>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AuthProvider>
  );
}
