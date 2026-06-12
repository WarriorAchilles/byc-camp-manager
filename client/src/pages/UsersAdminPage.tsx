import { FormEvent, useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiJson, type AdminRole, type AdminUserRow } from "../api";
import { useAuth } from "../auth";

export function UsersAdminPage(): React.ReactElement {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<AdminRole>("camp_admin");
  const [actionError, setActionError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await apiJson<{ users: AdminUserRow[] }>("/api/admin/users");
      setUsers(response.users);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load users");
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  if (user?.role !== "super_admin") {
    return <Navigate to="/admin/people" replace />;
  }

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setActionError(null);
    try {
      await apiJson("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
        }),
      });
      setNewUsername("");
      setNewPassword("");
      await loadUsers();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Create failed");
    }
  }

  async function deactivate(targetId: string): Promise<void> {
    setActionError(null);
    try {
      await apiJson(`/api/admin/users/${targetId}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      });
      await loadUsers();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Update failed");
    }
  }

  async function resetPassword(targetId: string): Promise<void> {
    const generated = window.prompt(
      "New password (min 12 characters) for this admin:",
      "",
    );
    if (!generated || generated.length < 12) {
      return;
    }
    setActionError(null);
    try {
      await apiJson(`/api/admin/users/${targetId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: generated }),
      });
      await loadUsers();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Reset failed");
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Admin users</h1>
      <p className="muted">Super admins can create, deactivate, and reset passwords.</p>

      {loadError ? <p className="error">{loadError}</p> : null}
      {actionError ? <p className="error">{actionError}</p> : null}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Create admin</h2>
        <form className="stack" onSubmit={(event) => void onCreate(event)}>
          <div className="row">
            <div className="stack" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="new-username">Username</label>
              <input
                id="new-username"
                type="text"
                autoComplete="username"
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
                required
              />
            </div>
            <div className="stack" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="new-password">Temporary password</label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={12}
                required
              />
            </div>
            <div className="stack">
              <label htmlFor="new-role">Role</label>
              <select
                id="new-role"
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as AdminRole)}
              >
                <option value="camp_admin">Camp admin</option>
                <option value="super_admin">Super admin</option>
              </select>
            </div>
          </div>
          <button className="btn" type="submit">
            Create user
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>All admins</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id}>
                  <td>{row.username}</td>
                  <td>{row.role.replace("_", " ")}</td>
                  <td>{row.isActive ? "Yes" : "No"}</td>
                  <td className="row">
                    {row.isActive ? (
                      <button
                        type="button"
                        className="btn danger"
                        disabled={row.id === user?.id}
                        onClick={() => void deactivate(row.id)}
                      >
                        Deactivate
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => void resetPassword(row.id)}
                    >
                      Reset password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
