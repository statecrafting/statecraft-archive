// Spec 112 §6.2 step 4 — open the L1-import PR that adds
// `.factory/pipeline-state.json` to a freshly-imported legacy repo.
//
// Pure-function over the GitHub REST API: no database I/O, no auth
// resolution. The caller owns token brokering (import.ts already holds
// an installation token with `pull_requests: write`) and supplies the
// JSON content the translator produced. This module's only side effect
// is the GitHub state change (branch + commit + PR).
//
// Flow:
//   1. GET /repos/{full}/git/refs/heads/{base}        → base SHA
//   2. POST /repos/{full}/git/refs                    → create branch
//   3. PUT  /repos/{full}/contents/{path}             → commit on branch
//   4. POST /repos/{full}/pulls                       → open PR
//
// Errors are mapped to a single discriminated union so the caller can
// distinguish "branch already exists" (idempotency) from "GitHub said
// 403" (permission gap). Idempotency: if a branch with the requested
// name already exists, the helper falls through to step 4 and opens a
// PR against it. The translation file is only PUT once on the new
// branch — if the file already exists at the same SHA, GitHub returns
// 422 and we surface that to the caller.

import log from "encore.dev/log";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

export interface OpenImportPrOptions {
  /** App-installation or PAT token with `contents:write` + `pull_requests:write`. */
  token: string;
  /** Full repo path, e.g. `statecrafting/example-…`. */
  fullName: string;
  /** Default branch the PR targets (e.g. `main`). */
  baseBranch: string;
  /** Branch to create for the PR. Convention: `factory-import-<ts>`. */
  headBranch: string;
  /** Path inside the repo (always `.factory/pipeline-state.json` for L1). */
  filePath: string;
  /** UTF-8 content to commit. Helper handles base64 encoding. */
  fileContent: string;
  /** Commit message line. */
  commitMessage: string;
  /** PR title. */
  prTitle: string;
  /** PR body (markdown). */
  prBody: string;
}

export interface OpenImportPrResult {
  /** `https://github.com/{fullName}/pull/{number}`. */
  htmlUrl: string;
  /** PR number (e.g. 42). */
  number: number;
  /** The branch that was created (or already existed) for this PR. */
  headBranch: string;
}

export class OpenImportPrError extends Error {
  constructor(
    public readonly stage:
      | "base-ref"
      | "create-branch"
      | "put-content"
      | "open-pr",
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "OpenImportPrError";
  }
}

/**
 * Open a single-file PR adding spec 112's L1-translated pipeline-state
 * to an imported repo.
 *
 * Returns the PR URL on success. Throws `OpenImportPrError` with a
 * stage tag on any GitHub error so callers can render actionable
 * diagnostics. The function is best-effort idempotent: a pre-existing
 * branch is reused, a pre-existing PR with the same head/base pair is
 * detected and returned without re-opening.
 */
export async function openImportPullRequest(
  opts: OpenImportPrOptions
): Promise<OpenImportPrResult> {
  // ── 1. Resolve base SHA. ────────────────────────────────────────────────
  const baseRefResp = await fetch(
    `${GITHUB_API}/repos/${opts.fullName}/git/refs/heads/${encodeURIComponent(
      opts.baseBranch
    )}`,
    { headers: ghHeaders(opts.token) }
  );
  if (!baseRefResp.ok) {
    const body = await baseRefResp.text();
    throw new OpenImportPrError(
      "base-ref",
      baseRefResp.status,
      `Could not resolve base branch '${opts.baseBranch}' on ${opts.fullName}: ${body}`
    );
  }
  const baseRef = (await baseRefResp.json()) as { object: { sha: string } };
  const baseSha = baseRef.object.sha;

  // ── 2. Create the head branch. Tolerate 422 "Reference already exists". ─
  const createBranchResp = await fetch(
    `${GITHUB_API}/repos/${opts.fullName}/git/refs`,
    {
      method: "POST",
      headers: ghHeaders(opts.token),
      body: JSON.stringify({
        ref: `refs/heads/${opts.headBranch}`,
        sha: baseSha,
      }),
    }
  );
  if (!createBranchResp.ok && createBranchResp.status !== 422) {
    const body = await createBranchResp.text();
    throw new OpenImportPrError(
      "create-branch",
      createBranchResp.status,
      `Could not create branch '${opts.headBranch}' on ${opts.fullName}: ${body}`
    );
  }
  if (createBranchResp.status === 422) {
    log.info("openImportPullRequest: branch already exists, reusing", {
      fullName: opts.fullName,
      headBranch: opts.headBranch,
    });
  }

  // ── 3. Commit the file on the head branch. ──────────────────────────────
  // PUT /contents requires the SHA of the existing file when overwriting;
  // for a brand-new file we omit it. Try without first; on 422 (file
  // exists), GET its SHA and retry.
  const encoded = Buffer.from(opts.fileContent, "utf-8").toString("base64");
  const putBody = (sha?: string) =>
    JSON.stringify({
      message: opts.commitMessage,
      content: encoded,
      branch: opts.headBranch,
      ...(sha ? { sha } : {}),
    });

  let putResp = await fetch(
    `${GITHUB_API}/repos/${opts.fullName}/contents/${opts.filePath}`,
    {
      method: "PUT",
      headers: ghHeaders(opts.token),
      body: putBody(),
    }
  );
  if (putResp.status === 422) {
    // File may exist on the (pre-existing) head branch from a prior import
    // attempt. Fetch its SHA and retry as an update.
    const existingResp = await fetch(
      `${GITHUB_API}/repos/${opts.fullName}/contents/${opts.filePath}?ref=${encodeURIComponent(
        opts.headBranch
      )}`,
      { headers: ghHeaders(opts.token) }
    );
    if (existingResp.ok) {
      const existing = (await existingResp.json()) as { sha: string };
      putResp = await fetch(
        `${GITHUB_API}/repos/${opts.fullName}/contents/${opts.filePath}`,
        {
          method: "PUT",
          headers: ghHeaders(opts.token),
          body: putBody(existing.sha),
        }
      );
    }
  }
  if (!putResp.ok) {
    const body = await putResp.text();
    throw new OpenImportPrError(
      "put-content",
      putResp.status,
      `Could not commit ${opts.filePath} to ${opts.fullName}@${opts.headBranch}: ${body}`
    );
  }

  // ── 4. Open the PR. Tolerate 422 "A pull request already exists". ───────
  const prResp = await fetch(
    `${GITHUB_API}/repos/${opts.fullName}/pulls`,
    {
      method: "POST",
      headers: ghHeaders(opts.token),
      body: JSON.stringify({
        title: opts.prTitle,
        body: opts.prBody,
        head: opts.headBranch,
        base: opts.baseBranch,
      }),
    }
  );

  if (prResp.ok) {
    const created = (await prResp.json()) as { html_url: string; number: number };
    return {
      htmlUrl: created.html_url,
      number: created.number,
      headBranch: opts.headBranch,
    };
  }

  // 422 + "A pull request already exists" → fetch the existing one.
  if (prResp.status === 422) {
    const listResp = await fetch(
      `${GITHUB_API}/repos/${opts.fullName}/pulls?state=open&head=${encodeURIComponent(
        `${opts.fullName.split("/")[0]}:${opts.headBranch}`
      )}`,
      { headers: ghHeaders(opts.token) }
    );
    if (listResp.ok) {
      const list = (await listResp.json()) as Array<{
        html_url: string;
        number: number;
      }>;
      if (list.length > 0) {
        return {
          htmlUrl: list[0].html_url,
          number: list[0].number,
          headBranch: opts.headBranch,
        };
      }
    }
  }

  const body = await prResp.text();
  throw new OpenImportPrError(
    "open-pr",
    prResp.status,
    `Could not open PR on ${opts.fullName}: ${body}`
  );
}

/**
 * Convenience: build a deterministic PR body for L1 imports. Pure;
 * no I/O. Kept here so the import handler stays thin and the body
 * shape is unit-testable.
 */
export function buildImportPrBody(args: {
  detectionLevel: "legacy_produced" | "acp_produced";
  translatorVersion: string;
  legacyStageCount: number;
}): string {
  return [
    `This PR was opened by Open Agentic Platform during the factory import flow.`,
    ``,
    `**Detection level:** \`${args.detectionLevel}\``,
    `**Translator version:** \`${args.translatorVersion}\``,
    `**Legacy stages translated:** ${args.legacyStageCount}`,
    ``,
    `Adds \`.factory/pipeline-state.json\` so OPC can recognise this`,
    `repo as an ACP-native factory project. Spec 112 §6.2 step 4.`,
    ``,
    `The legacy \`requirements/audit/factory-manifest.json\` and`,
    `\`requirements/audit/working-state.json\` files are preserved`,
    `verbatim — they are never deleted by this flow.`,
  ].join("\n");
}
