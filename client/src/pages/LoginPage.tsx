import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";

export function LoginPage(): React.ReactElement {
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/admin" replace />;
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="card login-card">
        <div className="login-brand">
          <img
            className="login-logo"
            src="/byc-logo.png"
            alt="Believers Youth Camp"
            width={280}
            height={64}
            decoding="async"
          />
          <div>
            <h1>Camp Manager</h1>
            <p className="muted">Sign in to the admin console</p>
          </div>
        </div>
        <form className="stack" onSubmit={(event) => void onSubmit(event)}>
          <div className="stack">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="stack">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {formError ? <p className="error">{formError}</p> : null}
          <button className="btn" type="submit" disabled={submitting || loading}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
