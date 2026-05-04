import { useAuth } from "../auth";

export function DashboardPage(): React.ReactElement {
  const { user } = useAuth();
  return (
    <div>
      <header className="page-header">
        <p className="page-header-eyebrow">Dashboard</p>
        <h1>Overview</h1>
        <p className="page-header-lead">
          Signed in as <strong>{user?.email}</strong> ({user?.role.replace("_", " ")}). Use the
          sidebar for camp operations — placeholder links unlock as each development step ships.
        </p>
      </header>
      <div className="card">
        <p style={{ margin: 0 }}>
          When you are ready, jump to <strong>Camp configuration</strong> to set seasons and
          capacity, then <strong>People</strong> and <strong>Dorms</strong> for assignments.
        </p>
      </div>
    </div>
  );
}
