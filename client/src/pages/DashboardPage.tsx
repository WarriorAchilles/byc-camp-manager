import { useAuth } from "../auth";

export function DashboardPage(): React.ReactElement {
  const { user } = useAuth();
  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Overview</h1>
      <p className="muted">
        Signed in as <strong>{user?.email}</strong> ({user?.role.replace("_", " ")})
      </p>
      <div className="card">
        <p>
          Use the sidebar for camp operations. Placeholder links will be enabled as each
          development step lands.
        </p>
      </div>
    </div>
  );
}
