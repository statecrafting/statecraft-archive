/**
 * Shared GitHub PAT validation helpers (spec 109).
 *
 * Extracted from api/auth/pat.ts so both the user-identity surface
 * (user_github_pats) and the operational surfaces (factory_upstream_pats,
 * project_github_pats) can probe a token before persisting it without
 * pulling the Encore API module into their import graphs.
 */

export type PatFormat = { isFineGrained: boolean };

export type PatProbeResult =
  | {
      ok: true;
      githubLogin: string;
      scopes: string[];
    }
  | {
      ok: false;
      reason: "pat_invalid" | "pat_rate_limited" | "pat_saml_not_authorized";
    };

/** Classify a raw PAT by its prefix. Returns null for unrecognised formats. */
export function classifyFormat(token: string): PatFormat | null {
  if (token.startsWith("github_pat_")) return { isFineGrained: true };
  if (/^gh[psou]_/.test(token)) return { isFineGrained: false };
  return null;
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}

/**
 * Call GitHub's /user endpoint with the token and capture the outcome.
 * Throws on network failure; returns a structured result on HTTP status.
 */
export async function probeGitHub(token: string): Promise<PatProbeResult> {
  const resp = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (resp.status === 401) {
    return { ok: false, reason: "pat_invalid" };
  }
  if (resp.status === 429) {
    return { ok: false, reason: "pat_rate_limited" };
  }
  if (resp.status === 403) {
    const body = await resp.text();
    if (/saml/i.test(body)) {
      return { ok: false, reason: "pat_saml_not_authorized" };
    }
    return { ok: false, reason: "pat_invalid" };
  }
  if (!resp.ok) {
    throw new Error(`GitHub /user returned ${resp.status}`);
  }

  const scopesHeader = resp.headers.get("x-oauth-scopes") ?? "";
  const scopes = scopesHeader
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const body = (await resp.json()) as { login?: string };
  return { ok: true, githubLogin: body.login ?? "", scopes };
}
