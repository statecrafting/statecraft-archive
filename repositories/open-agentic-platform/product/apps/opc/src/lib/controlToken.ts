/**
 * Web-mode control token helpers.
 *
 * `opc-web` gates `/api/*` and `/ws/claude` behind the same control token
 * used by `/control/*` (oap-ctl). The token is embedded into the served HTML
 * shell (see `inject_control_token` in `src-tauri/src/web_server.rs`) as
 * `window.__OPC_CONTROL_TOKEN__`, so same-origin browser JS loaded from the
 * server can read it back and authenticate its own calls. In the packaged
 * Tauri desktop app this global is never set (no web server), so every
 * helper here degrades to a no-op.
 */

declare global {
  interface Window {
    __OPC_CONTROL_TOKEN__?: string;
  }
}

/** Reads the control token embedded in the current page, if any. */
export function getControlToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = window.__OPC_CONTROL_TOKEN__;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/** Merges the `X-Control-Token` header into a plain headers object. */
export function withControlTokenHeader(headers: Record<string, string> = {}): Record<string, string> {
  const token = getControlToken();
  if (!token) return headers;
  return { ...headers, 'X-Control-Token': token };
}

/**
 * Appends `?token=` (or `&token=`) to a URL when a control token is present.
 * Used for the `/ws/claude` WebSocket handshake, since the browser
 * `WebSocket` API cannot set custom headers.
 */
export function withControlTokenQuery(url: string): string {
  const token = getControlToken();
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}
