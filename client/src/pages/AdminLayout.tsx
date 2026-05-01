import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../auth";

type NavItem = {
  to: string;
  label: string;
  placeholder: boolean;
  end?: boolean;
};

const navItems: NavItem[] = [
  { to: "/admin", label: "Overview", end: true, placeholder: false },
  { to: "/admin/camp", label: "Camp configuration", placeholder: false },
  { to: "/admin/people", label: "People", placeholder: false },
  { to: "/admin/imports", label: "Imports", placeholder: false },
  { to: "/admin/dorms", label: "Dorms", placeholder: true },
  { to: "/admin/check-in", label: "Check-in", placeholder: true },
  { to: "/admin/reports", label: "Reports", placeholder: true },
  { to: "/admin/users", label: "Admin users", placeholder: false },
];

export function AdminLayout(): React.ReactElement {
  const { user, logout, loading } = useAuth();

  if (!loading && !user) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-title">BYC Admin</div>
        <div className="nav-section">Navigation</div>
        {navItems.map((item) => {
          if (item.placeholder) {
            return (
              <span key={item.to} className="nav-link disabled" title="Coming in a later step">
                {item.label}
              </span>
            );
          }
          if (
            (item.to === "/admin/users" || item.to === "/admin/imports") &&
            user?.role !== "super_admin"
          ) {
            return null;
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `nav-link${isActive ? " active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          );
        })}
        <div style={{ flex: 1 }} />
        {user ? (
          <div className="stack" style={{ width: "100%" }}>
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              {user.email}
            </span>
            <button type="button" className="btn secondary" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        ) : null}
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
