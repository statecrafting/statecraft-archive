import { redirect, useLoaderData } from "react-router";

import { auth } from "../lib/api";

/**
 * The login screen offers whatever auth drivers the control plane has
 * configured: rauthy (the same-origin OIDC flow) and, in dev, the mock driver.
 * Already-authenticated visitors are sent to the dashboard.
 *
 * These are full-page navigations to the backend (which sets the session cookies
 * and 302s back to "/"), not fetch calls: the browser must follow the redirect.
 */
export async function loginLoader() {
  const status = await auth.status();
  if (status.authenticated) throw redirect("/");
  return { drivers: status.drivers };
}

export function Login() {
  const { drivers } = useLoaderData() as { drivers: string[] };
  const hasMock = drivers.includes("mock");
  const hasRauthy = drivers.includes("rauthy");

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <h1 className="brand">statecraft</h1>
        <p className="muted">The governed agentic delivery control plane.</p>
        <h2>Sign in</h2>
        <div className="auth-drivers">
          {hasRauthy && (
            <a className="btn btn-primary" href="/api/v1/auth/rauthy/login">
              Sign in with rauthy
            </a>
          )}
          {hasMock && (
            <>
              <a className="btn" href="/api/v1/auth/mock/login?user=0">
                Mock: Casey User
              </a>
              <a className="btn" href="/api/v1/auth/mock/login?user=1">
                Mock: Avery Admin
              </a>
              <a className="btn" href="/api/v1/auth/mock/login?user=2">
                Mock: Devon Developer
              </a>
            </>
          )}
          {!hasMock && !hasRauthy && (
            <p className="notice">No auth drivers are configured on this control plane.</p>
          )}
        </div>
        <p className="hint">drivers configured: {drivers.join(", ") || "none"}</p>
      </div>
    </div>
  );
}
