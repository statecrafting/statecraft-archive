/**
 * GitHub repo initialization helpers (spec 080 FR-008).
 *
 * Provides functions to create repos, seed adapter templates, configure
 * branch protection, and create OAP workflow files via the GitHub API
 * using a GitHub App installation token.
 */

import log from "encore.dev/log";
import { signAppJwt } from "./appJwt";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

// ---------------------------------------------------------------------------
// Installation token broker
// ---------------------------------------------------------------------------

/**
 * Result of a successful installation-token exchange. Spec 112 §6.4
 * needs `expiresAt` to drive OPC-side refresh; existing callers that
 * only care about the token destructure `.token`.
 */
export interface BrokeredInstallationToken {
  token: string;
  expiresAt: Date;
}

/**
 * Broker a scoped installation token for a given GitHub App installation.
 */
export async function brokerInstallationToken(
  installationId: number,
  permissions: Record<string, string>
): Promise<BrokeredInstallationToken> {
  const jwt = await signAppJwt();

  const resp = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
      body: JSON.stringify({ permissions }),
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Installation token exchange failed: ${resp.status} ${body}`
    );
  }

  const data = (await resp.json()) as { token: string; expires_at: string };
  log.info("Installation token issued", { installationId });
  return { token: data.token, expiresAt: new Date(data.expires_at) };
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

// ---------------------------------------------------------------------------
// FR-008: Repo creation
// ---------------------------------------------------------------------------

export interface CreateRepoResult {
  fullName: string;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
}

/**
 * Create a GitHub repository in the org using the installation token.
 *
 * `autoInit` defaults to `true` (the legacy behavior — repo ships with an
 * auto-generated README so `seedRepoFromAdapter` has a SHA to update). The
 * factory scaffold path passes `false` so we can push our scaffold tree as
 * commit #1 without force-overwriting the README.
 */
export async function createGitHubRepo(
  token: string,
  org: string,
  repoName: string,
  opts: { isPrivate: boolean; description: string; autoInit?: boolean }
): Promise<CreateRepoResult> {
  const resp = await fetch(`${GITHUB_API}/orgs/${org}/repos`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      name: repoName,
      description: opts.description,
      private: opts.isPrivate,
      auto_init: opts.autoInit ?? true,
      delete_branch_on_merge: true,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    if (resp.status === 422 && body.includes("already exists")) {
      throw new Error(`Repository ${org}/${repoName} already exists on GitHub`);
    }
    throw new Error(`GitHub create repo failed: ${resp.status} ${body}`);
  }

  const data = (await resp.json()) as {
    full_name: string;
    default_branch: string;
    clone_url: string;
    html_url: string;
  };

  log.info("GitHub repo created", { fullName: data.full_name });

  return {
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    cloneUrl: data.clone_url,
    htmlUrl: data.html_url,
  };
}

// ---------------------------------------------------------------------------
// FR-008: Adapter template seeding
// ---------------------------------------------------------------------------

// The owned factory self-declares its adapter identity in its manifest
// (spec 199 FR-002); the retired example adapters (encore-react,
// next-prisma, rust-axum) and the legacy acme-vue-node name were removed
// upstream (spec 199 FR-007).
const VALID_ADAPTERS = new Set(["acme-vue-encore"]);

/**
 * Seed the repo with a minimal adapter README via the GitHub Contents API.
 */
export async function seedRepoFromAdapter(
  token: string,
  fullName: string,
  adapter: string
): Promise<void> {
  if (!VALID_ADAPTERS.has(adapter)) {
    throw new Error(`Unknown adapter: ${adapter}. Valid: ${[...VALID_ADAPTERS].join(", ")}`);
  }

  const readmeContent = Buffer.from(
    `# ${fullName.split("/")[1]}\n\n` +
      `Created by [Open Agentic Platform](https://github.com/open-agentic-platform/open-agentic-platform).\n\n` +
      `**Adapter:** \`${adapter}\`\n\n` +
      `## Getting Started\n\n` +
      `This project was scaffolded using the \`${adapter}\` adapter template.\n` +
      `See the adapter documentation for setup instructions.\n`
  ).toString("base64");

  // Update the auto-generated README with our adapter content
  // First get the existing README SHA (required for updates)
  const getResp = await fetch(
    `${GITHUB_API}/repos/${fullName}/contents/README.md`,
    { headers: githubHeaders(token) }
  );

  let sha: string | undefined;
  if (getResp.ok) {
    const existing = (await getResp.json()) as { sha: string };
    sha = existing.sha;
  }

  const putResp = await fetch(
    `${GITHUB_API}/repos/${fullName}/contents/README.md`,
    {
      method: "PUT",
      headers: githubHeaders(token),
      body: JSON.stringify({
        message: "chore: initialize project with OAP adapter template",
        content: readmeContent,
        ...(sha && { sha }),
      }),
    }
  );

  if (!putResp.ok) {
    const body = await putResp.text();
    log.warn("Failed to seed README", { fullName, status: putResp.status, body });
    // Non-fatal: repo still usable without custom README
    return;
  }

  log.info("Adapter README seeded", { fullName, adapter });
}

// ---------------------------------------------------------------------------
// FR-008: Branch protection
// ---------------------------------------------------------------------------

/**
 * Configure branch protection on the default branch.
 * Requires the installation to have `administration: write` permission.
 * Gracefully handles 403 (missing permission) — logs warning and continues.
 */
export async function configureBranchProtection(
  token: string,
  fullName: string,
  branch: string
): Promise<void> {
  const resp = await fetch(
    `${GITHUB_API}/repos/${fullName}/branches/${branch}/protection`,
    {
      method: "PUT",
      headers: githubHeaders(token),
      body: JSON.stringify({
        required_status_checks: {
          strict: true,
          contexts: ["oap/verify"],
        },
        enforce_admins: false,
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: true,
        },
        restrictions: null, // no push restrictions
        allow_force_pushes: false,
        allow_deletions: false,
      }),
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    if (resp.status === 403) {
      log.warn(
        "Branch protection skipped: GitHub App lacks administration:write permission",
        { fullName, branch }
      );
      return;
    }
    log.warn("Branch protection failed", {
      fullName,
      branch,
      status: resp.status,
      body,
    });
    // Non-fatal: project creation should succeed without branch protection
  } else {
    log.info("Branch protection configured", { fullName, branch });
  }
}

// ---------------------------------------------------------------------------
// FR-008: GitHub Actions workflow
// ---------------------------------------------------------------------------

const OAP_WORKFLOW_YAML = `name: OAP Verify
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read
  checks: write
  pull-requests: read

jobs:
  verify:
    name: oap/verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - name: OAP Governance Check
        run: |
          echo "OAP governance verification"
          echo "Adapter compliance and policy checks will run here"
          echo "See: https://github.com/open-agentic-platform/open-agentic-platform"
`;

/**
 * Create the standard OAP GitHub Actions workflow file.
 */
export async function createOapWorkflow(
  token: string,
  fullName: string
): Promise<void> {
  const content = Buffer.from(OAP_WORKFLOW_YAML).toString("base64");

  const resp = await fetch(
    `${GITHUB_API}/repos/${fullName}/contents/.github/workflows/oap-verify.yml`,
    {
      method: "PUT",
      headers: githubHeaders(token),
      body: JSON.stringify({
        message: "ci: add OAP governance verification workflow",
        content,
      }),
    }
  );

  if (!resp.ok) {
    const body = await resp.text();
    log.warn("Failed to create OAP workflow", {
      fullName,
      status: resp.status,
      body,
    });
    // Non-fatal: project creation should succeed without the workflow
    return;
  }

  log.info("OAP workflow created", { fullName });
}

// ---------------------------------------------------------------------------
// Spec 213: container-build workflow (oap-build.yml)
// ---------------------------------------------------------------------------

/**
 * The workflow's `name:` value, matched by the GitHub webhook on
 * `workflow_run.completed` (spec 213 FR-006). Single source of truth so the
 * seeded YAML and the webhook recorder stay in lockstep.
 */
export const OAP_BUILD_WORKFLOW_NAME = "oap-build";

// The active container-build workflow seeded into created repos (spec 213
// FR-001/FR-002/FR-003/FR-004). It mirrors template's real build
// (npm ci -> npm run build -> encore CLI -> encore build docker --base),
// detects single vs dual-profile trees at runtime and builds from the
// variant root, tags `sha-{short12}[-variant]` on every push and adds the
// `pr-{n}[-variant]` alias on pull_request, and publishes no `latest` tag.
// `${...}` GitHub/bash expressions are backslash-escaped so this template
// literal is not interpreted by JS. Third-party actions are SHA-pinned to
// the same refs this repo trusts (cd-tenant-app.yml precedent). Exported
// so the factory-create scaffold flow can write it into commit #1 of the
// scaffolded tree (spec 213 FR-001 / SC-001); the Contents-API seed below
// is the retrofit path for repos created before this spec (FR-008).
export const OAP_BUILD_WORKFLOW_YAML = `name: ${OAP_BUILD_WORKFLOW_NAME}
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read
  packages: write

concurrency:
  group: oap-build-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  detect:
    name: detect tree layout
    runs-on: ubuntu-latest
    outputs:
      matrix: \${{ steps.detect.outputs.matrix }}
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - id: detect
        shell: bash
        run: |
          # Spec 213 FR-004: a dual-profile tree carries top-level public/ and
          # internal/ each with apps/api; otherwise build the repo root.
          if [ -d public/apps/api ] && [ -d internal/apps/api ]; then
            echo 'matrix={"include":[{"variant":"public","dir":"public"},{"variant":"internal","dir":"internal"}]}' >> "\$GITHUB_OUTPUT"
          else
            echo 'matrix={"include":[{"variant":"root","dir":"."}]}' >> "\$GITHUB_OUTPUT"
          fi

  build:
    name: build \${{ matrix.variant }}
    needs: detect
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix: \${{ fromJSON(needs.detect.outputs.matrix) }}
    defaults:
      run:
        working-directory: \${{ matrix.dir }}
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0

      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6
        with:
          node-version: "24"
          cache: npm
          cache-dependency-path: \${{ matrix.dir }}/package-lock.json

      - name: Compute image ref (spec 213 FR-002)
        id: meta
        shell: bash
        run: |
          SHORT_SHA="\$(git rev-parse --short=12 HEAD)"
          SUFFIX=""
          if [ "\${{ matrix.variant }}" != "root" ]; then SUFFIX="-\${{ matrix.variant }}"; fi
          IMAGE="ghcr.io/\${GITHUB_REPOSITORY,,}"
          {
            echo "image=\${IMAGE}"
            echo "sha_tag=sha-\${SHORT_SHA}\${SUFFIX}"
            echo "pr_tag=pr-\${{ github.event.pull_request.number }}\${SUFFIX}"
          } >> "\$GITHUB_OUTPUT"

      - name: Install workspace dependencies
        run: npm ci

      - name: Build shared packages + SPA
        run: npm run build

      - name: Install Encore CLI
        shell: bash
        run: |
          curl -fsSL https://encore.dev/install.sh | bash
          echo "\$HOME/.encore/bin" >> "\$GITHUB_PATH"

      - name: Install API dependencies
        working-directory: \${{ matrix.dir }}/apps/api
        run: npm ci

      - name: Log in to GHCR
        uses: docker/login-action@af1e73f918a031802d376d3c8bbc3fe56130a9b0 # v4.4.0
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          # GITHUB_TOKEN with packages:write covers the common case; the
          # org-level PAT secret GHCR_PUBLISH_TOKEN is the documented fallback
          # for orgs that restrict first-publish package creation (spec 213
          # Clarification 2). The PAT widens blast radius and is review-flagged.
          password: \${{ secrets.GHCR_PUBLISH_TOKEN || secrets.GITHUB_TOKEN }}

      - name: Build base image
        run: docker build -f apps/api/Dockerfile.base -t oap-api-base:\${{ github.sha }}-\${{ matrix.variant }} apps/api

      - name: Build Encore image (spec 213 FR-001)
        working-directory: \${{ matrix.dir }}/apps/api
        run: |
          encore build docker \\
            --config ./infra.config.json \\
            --base oap-api-base:\${{ github.sha }}-\${{ matrix.variant }} \\
            "\${{ steps.meta.outputs.image }}:\${{ steps.meta.outputs.sha_tag }}"

      - name: Push sha tag
        run: docker push "\${{ steps.meta.outputs.image }}:\${{ steps.meta.outputs.sha_tag }}"

      - name: Tag and push PR alias (spec 213 FR-003)
        if: github.event_name == 'pull_request'
        run: |
          docker tag "\${{ steps.meta.outputs.image }}:\${{ steps.meta.outputs.sha_tag }}" "\${{ steps.meta.outputs.image }}:\${{ steps.meta.outputs.pr_tag }}"
          docker push "\${{ steps.meta.outputs.image }}:\${{ steps.meta.outputs.pr_tag }}"
`;

/**
 * Seed (or update) the `oap-build.yml` container-build workflow in a repo
 * via the GitHub Contents API. Idempotent (FR-008): fetches the existing
 * file SHA so a retrofit updates in place rather than 422-ing on an
 * existing path. Used at project-create time (FR-001) and by the retrofit
 * admin endpoint for repos created before this spec. Throws on a hard
 * failure so the admin caller can surface it; the create-time caller wraps
 * it best-effort.
 */
export async function seedOapBuildWorkflow(
  token: string,
  fullName: string
): Promise<{ action: "created" | "updated" }> {
  const path = ".github/workflows/oap-build.yml";
  const content = Buffer.from(OAP_BUILD_WORKFLOW_YAML).toString("base64");

  const getResp = await fetch(
    `${GITHUB_API}/repos/${fullName}/contents/${path}`,
    { headers: githubHeaders(token) }
  );
  let sha: string | undefined;
  if (getResp.ok) {
    const existing = (await getResp.json()) as { sha: string };
    sha = existing.sha;
  }

  const putResp = await fetch(
    `${GITHUB_API}/repos/${fullName}/contents/${path}`,
    {
      method: "PUT",
      headers: githubHeaders(token),
      body: JSON.stringify({
        message: sha
          ? "ci: update OAP container build workflow (spec 213)"
          : "ci: add OAP container build workflow (spec 213)",
        content,
        ...(sha && { sha }),
      }),
    }
  );

  if (!putResp.ok) {
    const body = await putResp.text();
    throw new Error(
      `Failed to seed oap-build.yml into ${fullName}: ${putResp.status} ${body}`
    );
  }

  const action = sha ? "updated" : "created";
  log.info("OAP build workflow seeded", { fullName, action });
  return { action };
}
