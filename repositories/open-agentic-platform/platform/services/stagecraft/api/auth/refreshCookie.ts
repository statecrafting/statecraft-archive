/**
 * POST /auth/refresh — web session refresh endpoint (spec 143 FU-023).
 *
 * Source-side implementation arm of FU-016. The browser's `__session` cookie
 * is bounded by the Rauthy access-token lifetime (`tokens.expires_in`,
 * default ~1800s); long-running flows that cross the boundary 401
 * deterministically with no recovery path. This endpoint accepts the
 * unauthenticated request (the access token is by definition expired or
 * missing), reads `__refresh` from the request cookie, calls
 * `refreshTokens()` against Rauthy, and emits the rotated `__session` +
 * `__refresh` cookies on 204. Modelled on `orgSwitchCookie` (github.ts:324),
 * the only existing web-path endpoint that reads `__refresh` from the
 * request cookie.
 */

import { api } from "encore.dev/api";
import log from "encore.dev/log";
import { refreshTokens } from "./rauthy";
import { applyRateLimit } from "./rate-limit";
import { errorForLog } from "./errorLog";
import { parseRefreshCookie, buildRefreshSetCookies } from "./refreshCookie-pure";

export const refreshCookie = api.raw(
  { expose: true, method: "POST", path: "/auth/refresh", auth: false },
  async (req, resp) => {
    if (applyRateLimit(req, resp)) return;

    const refreshToken = parseRefreshCookie(req.headers.cookie);
    if (!refreshToken) {
      resp.writeHead(401, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "Missing refresh cookie" }));
      return;
    }

    try {
      const tokens = await refreshTokens(refreshToken);
      const secure = process.env.NODE_ENV === "production";
      resp.writeHead(204, { "Set-Cookie": buildRefreshSetCookies(tokens, secure) });
      resp.end();
    } catch (err) {
      log.warn("Web session refresh failed", { error: errorForLog(err) });
      resp.writeHead(401, { "Content-Type": "application/json" });
      resp.end(JSON.stringify({ error: "Refresh rejected" }));
    }
  }
);
