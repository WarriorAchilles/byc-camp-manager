import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../auth";

type NavItem = {
  to: string;
  label: string;
  placeholder: boolean;
  end?: boolean;
};

const navItems: NavItem[] = [
  { to: "/admin", label: "Check-in", end: true, placeholder: false },
  { to: "/admin/self-check-in-qr", label: "Self check-in QR", placeholder: false },
  { to: "/admin/random-campers", label: "Random campers", placeholder: false },
  { to: "/admin/camp", label: "Camp configuration", placeholder: false },
  { to: "/admin/people", label: "People", placeholder: false },
  { to: "/admin/imports", label: "Imports", placeholder: false },
  { to: "/admin/dorms", label: "Dorms", placeholder: false },
  { to: "/admin/reports", label: "Reports", placeholder: false },
  { to: "/admin/users", label: "Admin users", placeholder: false },
];

/** Sidebar entries camp admins may access (operational areas only). */
const campAdminNavPaths = new Set<string>([
  "/admin",
  "/admin/self-check-in-qr",
  "/admin/random-campers",
  "/admin/people",
  "/admin/dorms",
  "/admin/reports",
]);

export function AdminLayout(): React.ReactElement {
  const { user, logout, loading } = useAuth();

  if (!loading && !user) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <div className="layout">
      <a className="skip-link" href="#admin-main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Admin navigation">
        <div className="sidebar-brand">
          <img
            className="sidebar-logo"
            src="/byc-logo.png"
            alt="Believers Youth Camp"
            width={200}
            height={48}
            decoding="async"
          />
          <div className="sidebar-brand-meta">
            <span className="sidebar-kicker">Camp operations</span>
            <span className="sidebar-title-line">Admin console</span>
          </div>
        </div>
        <div className="nav-section">Menu</div>
        <nav className="sidebar-nav" aria-label="Primary">
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
            if (user?.role === "camp_admin" && !campAdminNavPaths.has(item.to)) {
              return null;
            }
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-spacer" aria-hidden="true" />
        {user ? (
          <div className="sidebar-footer">
            <div className="sidebar-user-username">{user.username}</div>
            <button type="button" className="btn secondary" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        ) : null}
      </aside>
      <main id="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
