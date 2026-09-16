import React, { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';
import { api } from '../lib/api';

// Types matching the Rust specta types
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  github_login: string;
  idp_provider: string;
  idp_login: string;
  avatar_url: string;
}

export interface AuthOrg {
  org_id: string;
  org_slug: string;
  github_org_login: string;
  org_display_name: string;
  platform_role: string;
}

type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'org-selection';

interface AuthContextType {
  status: AuthStatus;
  user: AuthUser | null;
  org: AuthOrg | null;
  availableOrgs: AuthOrg[];
  pendingOrgs: AuthOrg[] | null;
  pendingId: string | null;
  error: string | null;
  login: (idpHint?: string) => Promise<void>;
  selectOrg: (orgId: string) => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [org, setOrg] = useState<AuthOrg | null>(null);
  const [pendingOrgs, setPendingOrgs] = useState<AuthOrg[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [availableOrgs, setAvailableOrgs] = useState<AuthOrg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  // Check auth status on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await api.authGetStatus();
        if (result.authenticated && result.user && result.org) {
          setUser(result.user);
          setOrg(result.org);
          setStatus('authenticated');
          scheduleRefresh(result.expires_at);
        } else {
          setStatus('unauthenticated');
        }
      } catch {
        setStatus('unauthenticated');
      }
    })();
  }, []);

  // Listen for deep-link auth callbacks (and drain any that arrived before
  // this listener registered — e.g. cold-launch via opc:// URL).
  useEffect(() => {
    // Tauri 2 exposes internals under __TAURI_INTERNALS__; the legacy __TAURI__
    // is only present in the web-mode shim. Detect either so we register the
    // listener under the real runtime.
    if (!window.__TAURI_INTERNALS__ && !window.__TAURI__) return;
    let unlisten: (() => void) | undefined;
    const processCallback = async (url: string) => {
      try {
        setError(null);
        const result = await api.authHandleCallback(url);
        handleAuthResult(result);
      } catch (err) {
        setError(String(err));
        setStatus('unauthenticated');
      }
    };
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<string>('auth-callback', (event) => {
        void processCallback(event.payload);
      });
      // Drain any callback that was buffered before the listener registered.
      try {
        const pending = await api.authTakePendingCallback();
        if (pending) await processCallback(pending);
      } catch {
        // No-op: the command is optional and missing state is fine.
      }
    })();
    return () => { unlisten?.(); };
  }, []);

  // Re-check auth status when the duplex loop silently refreshes the JWT
  // (spec 183). The duplex consumer rotates an expired bearer in the
  // background; without this listener AuthContext would keep showing a stale
  // "Sign in" prompt for a session that was just recovered, defeating the
  // "stay signed in unless the credential is invalid" contract.
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__ && !window.__TAURI__) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('session-refreshed', () => {
        void (async () => {
          try {
            const result = await api.authGetStatus();
            if (result.authenticated && result.user && result.org) {
              setUser(result.user);
              setOrg(result.org);
              setStatus('authenticated');
              scheduleRefresh(result.expires_at);
            }
            // Deliberately do NOT flip to 'unauthenticated' on a negative
            // read here: the refresh event means the session was just
            // recovered, so a racing status read must not sign the user out.
          } catch {
            // ignore — keep current status
          }
        })();
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  // Cleanup refresh timer
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
    };
  }, []);

  function scheduleRefresh(expiresAt: number | null) {
    if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
    if (!expiresAt) return;
    // Check every 60s, refresh when within 5 min of expiry
    refreshTimerRef.current = window.setInterval(async () => {
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt - now < 300) {
        try {
          const newExpiresAt = await api.authRefreshToken();
          scheduleRefresh(newExpiresAt);
        } catch {
          // Refresh failed — force re-login
          setStatus('unauthenticated');
          setUser(null);
          setOrg(null);
        }
      }
    }, 60_000);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleAuthResult(result: any) {
    if (result.type === 'authenticated') {
      setUser(result.user);
      setOrg(result.org);
      if (result.available_orgs) setAvailableOrgs(result.available_orgs);
      else if (result.org) setAvailableOrgs([result.org]);
      setPendingOrgs(null);
      setPendingId(null);
      setStatus('authenticated');
      scheduleRefresh(result.expires_at);
      // Spec 183 — a fresh sign-in (or an org selection / switch routed
      // through here) establishes a new valid bearer. Re-spawn the duplex
      // consumer so its per-outage refresh budget + consecutive-failure
      // counter reset to zero. Without this, a session that expired and
      // burned its refresh budget before this re-login stays unrecoverable:
      // the loop only resets the budget on a clean connect, so the new
      // bearer's upgrade 401s would skip the refresh path and march straight
      // to the give-up threshold. Best-effort and desktop-only — a failed
      // reconnect must never block the sign-in transition.
      if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
        void api.reconnectStatecraftDuplex().catch(() => {});
      }
    } else if (result.type === 'org_selection') {
      setUser(result.user);
      setPendingOrgs(result.orgs);
      setAvailableOrgs(result.orgs ?? []);
      setPendingId(result.pending_id);
      setStatus('org-selection');
    } else if (result.type === 'error') {
      setError(result.message || result.code);
      setStatus('unauthenticated');
    }
  }

  const login = useCallback(async (idpHint?: string) => {
    setError(null);
    setStatus('loading');
    try {
      await api.authStartLogin(idpHint ?? null);
      // Browser will open — callback arrives via deep-link event listener above
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Login failed — see logs for details.');
      setStatus('unauthenticated');
    }
  }, []);

  const selectOrg = useCallback(async (orgId: string) => {
    if (!pendingId) return;
    setStatus('loading');
    try {
      const result = await api.authSelectOrg(pendingId, orgId);
      handleAuthResult(result);
    } catch (err) {
      setError(String(err));
      setStatus('org-selection');
    }
  }, [pendingId]);

  const switchOrg = useCallback(async (orgId: string) => {
    try {
      const result = await api.authSwitchOrg(orgId);
      if (result.type === 'authenticated') {
        handleAuthResult(result);
      } else if (result.org) {
        setOrg(result.org);
        if (result.expires_at) scheduleRefresh(result.expires_at);
      }
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.authLogout();
    } catch {
      // Best-effort
    }
    setUser(null);
    setOrg(null);
    setPendingOrgs(null);
    setPendingId(null);
    setError(null);
    setStatus('unauthenticated');
    if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, org, availableOrgs, pendingOrgs, pendingId, error, login, selectOrg, switchOrg, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
