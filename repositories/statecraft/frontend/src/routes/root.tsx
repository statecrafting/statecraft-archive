import { useState } from "react";
import { Link, NavLink, Outlet, redirect, useLoaderData, useNavigate } from "react-router";

import { ApiError, auth, isOperator, type Me } from "../lib/api";

/**
 * Guards every route under "/": load the signed-in principal, and bounce
 * unauthenticated visitors (a 401 that even a token refresh cannot rescue) to
 * /login. Any other error propagates to the route error boundary.
 */
export async function rootLoader() {
  try {
    const me = await auth.me();
    return { me };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw redirect("/login");
    }
    throw err;
  }
}

export function Root() {
  const { me } = useLoaderData() as { me: Me };
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await auth.logout();
    } finally {
      navigate("/login");
    }
  }

  return (
    <div className="app-shell">
      <header className="topnav">
        <Link to="/" className="brand">
          statecraft
        </Link>
        <nav className="topnav-links">
          <NavLink to="/" end>
            Tenants
          </NavLink>
          {isOperator(me) && <NavLink to="/operator/tenants">Operators</NavLink>}
        </nav>
        <div className="topnav-user">
          <span className="muted">{me.email}</span>
          <button className="btn" type="button" onClick={onSignOut} disabled={signingOut}>
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
