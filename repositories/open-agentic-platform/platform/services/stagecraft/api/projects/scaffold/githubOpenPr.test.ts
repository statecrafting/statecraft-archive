// Spec 112 §6.2 step 4 — unit tests for the L1-import PR helper.
//
// Pure-fetch covers the four-step GitHub flow (base ref → branch →
// content commit → open PR), the 422 idempotency cases (branch
// already exists, PR already exists), and the deterministic PR body
// builder. No DB or Encore runtime — fetch is mocked and the helper
// is exercised in isolation.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildImportPrBody,
  openImportPullRequest,
  OpenImportPrError,
} from "./githubOpenPr";

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

beforeEach(() => {
  // each test installs its own fetch mock
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installFetch(
  responder: (call: FetchCall) => Response | Promise<Response>
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : (input as { toString(): string }).toString();
    const call: FetchCall = {
      url,
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE_OPTS = {
  token: "ghs_FAKE",
  fullName: "acme/widgets",
  baseBranch: "main",
  headBranch: "factory-import-2026-04-26T19-30",
  filePath: ".factory/pipeline-state.json",
  fileContent: '{"hello":"world"}',
  commitMessage: "chore: add pipeline-state",
  prTitle: "Factory import",
  prBody: "body",
};

describe("openImportPullRequest", () => {
  it("walks all four GitHub calls on the happy path", async () => {
    const { calls } = installFetch((call) => {
      if (call.url.endsWith("/git/refs/heads/main")) {
        return jsonResponse(200, { object: { sha: "BASE_SHA" } });
      }
      if (call.method === "POST" && call.url.endsWith("/git/refs")) {
        return jsonResponse(201, {});
      }
      if (call.method === "PUT" && call.url.includes("/contents/")) {
        return jsonResponse(201, { content: { sha: "FILE_SHA" } });
      }
      if (call.method === "POST" && call.url.endsWith("/pulls")) {
        return jsonResponse(201, {
          html_url: "https://github.com/acme/widgets/pull/7",
          number: 7,
        });
      }
      throw new Error(`unexpected call ${call.method} ${call.url}`);
    });

    const result = await openImportPullRequest(BASE_OPTS);

    expect(result).toEqual({
      htmlUrl: "https://github.com/acme/widgets/pull/7",
      number: 7,
      headBranch: BASE_OPTS.headBranch,
    });
    expect(calls).toHaveLength(4);
    expect(calls[0].url).toContain("/git/refs/heads/main");
    expect(calls[1].url).toContain("/git/refs");
    expect(calls[2].url).toContain(
      "/contents/.factory/pipeline-state.json"
    );
    expect(calls[3].url).toContain("/pulls");
    // Bearer auth on every call.
    for (const c of calls) {
      expect(c.headers.Authorization).toBe("Bearer ghs_FAKE");
    }
  });

  it("encodes file content as base64 in the contents PUT", async () => {
    let putBody: Record<string, unknown> | null = null;
    installFetch((call) => {
      if (call.url.endsWith("/git/refs/heads/main")) {
        return jsonResponse(200, { object: { sha: "BASE_SHA" } });
      }
      if (call.method === "POST" && call.url.endsWith("/git/refs")) {
        return jsonResponse(201, {});
      }
      if (call.method === "PUT") {
        putBody = JSON.parse(call.body ?? "{}");
        return jsonResponse(201, {});
      }
      if (call.method === "POST" && call.url.endsWith("/pulls")) {
        return jsonResponse(201, {
          html_url: "https://github.com/x/y/pull/1",
          number: 1,
        });
      }
      return jsonResponse(500, {});
    });

    await openImportPullRequest({ ...BASE_OPTS, fileContent: "{ \"a\": 1 }" });
    const captured = putBody as Record<string, unknown> | null;
    if (!captured) throw new Error("PUT body never captured");
    const encoded = String(captured.content ?? "");
    expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe('{ "a": 1 }');
  });

  it("treats a 422 on branch creation as 'already exists' and continues", async () => {
    installFetch((call) => {
      if (call.url.endsWith("/git/refs/heads/main")) {
        return jsonResponse(200, { object: { sha: "BASE_SHA" } });
      }
      if (call.method === "POST" && call.url.endsWith("/git/refs")) {
        return jsonResponse(422, { message: "Reference already exists" });
      }
      if (call.method === "PUT") {
        return jsonResponse(201, {});
      }
      if (call.method === "POST" && call.url.endsWith("/pulls")) {
        return jsonResponse(201, {
          html_url: "https://github.com/x/y/pull/2",
          number: 2,
        });
      }
      return jsonResponse(500, {});
    });

    const result = await openImportPullRequest(BASE_OPTS);
    expect(result.number).toBe(2);
  });

  it("retries the contents PUT with the existing SHA on 422", async () => {
    let putAttempts = 0;
    installFetch((call) => {
      if (call.url.endsWith("/git/refs/heads/main")) {
        return jsonResponse(200, { object: { sha: "BASE_SHA" } });
      }
      if (call.method === "POST" && call.url.endsWith("/git/refs")) {
        return jsonResponse(201, {});
      }
      if (call.method === "PUT") {
        putAttempts += 1;
        if (putAttempts === 1) {
          // First PUT: 422 — file already on this branch.
          return jsonResponse(422, { message: "sha required" });
        }
        // Second PUT: succeeds with the existing SHA included.
        const body = JSON.parse(call.body ?? "{}");
        expect(body.sha).toBe("EXISTING_SHA");
        return jsonResponse(200, {});
      }
      if (call.method === "GET" && call.url.includes("/contents/")) {
        return jsonResponse(200, { sha: "EXISTING_SHA" });
      }
      if (call.method === "POST" && call.url.endsWith("/pulls")) {
        return jsonResponse(201, {
          html_url: "https://github.com/x/y/pull/3",
          number: 3,
        });
      }
      return jsonResponse(500, {});
    });

    const result = await openImportPullRequest(BASE_OPTS);
    expect(result.number).toBe(3);
    expect(putAttempts).toBe(2);
  });

  it("returns the existing PR when 422 on POST /pulls and the listing has one", async () => {
    installFetch((call) => {
      if (call.url.endsWith("/git/refs/heads/main")) {
        return jsonResponse(200, { object: { sha: "BASE_SHA" } });
      }
      if (call.method === "POST" && call.url.endsWith("/git/refs")) {
        return jsonResponse(201, {});
      }
      if (call.method === "PUT") {
        return jsonResponse(201, {});
      }
      if (call.method === "POST" && call.url.endsWith("/pulls")) {
        return jsonResponse(422, {
          message: "A pull request already exists for acme:branch",
        });
      }
      if (call.method === "GET" && call.url.includes("/pulls?state=open")) {
        return jsonResponse(200, [
          { html_url: "https://github.com/acme/widgets/pull/9", number: 9 },
        ]);
      }
      return jsonResponse(500, {});
    });

    const result = await openImportPullRequest(BASE_OPTS);
    expect(result.number).toBe(9);
  });

  it("throws OpenImportPrError tagged with stage='base-ref' on missing base branch", async () => {
    installFetch(() => jsonResponse(404, { message: "Not Found" }));

    await expect(openImportPullRequest(BASE_OPTS)).rejects.toMatchObject({
      name: "OpenImportPrError",
      stage: "base-ref",
      status: 404,
    });
  });

  it("throws OpenImportPrError tagged with stage='open-pr' when the PR cannot be created", async () => {
    installFetch((call) => {
      if (call.url.endsWith("/git/refs/heads/main")) {
        return jsonResponse(200, { object: { sha: "BASE_SHA" } });
      }
      if (call.method === "POST" && call.url.endsWith("/git/refs")) {
        return jsonResponse(201, {});
      }
      if (call.method === "PUT") {
        return jsonResponse(201, {});
      }
      if (call.method === "POST" && call.url.endsWith("/pulls")) {
        return jsonResponse(403, { message: "Resource not accessible" });
      }
      return jsonResponse(500, {});
    });

    await expect(openImportPullRequest(BASE_OPTS)).rejects.toMatchObject({
      name: "OpenImportPrError",
      stage: "open-pr",
      status: 403,
    });
  });
});

describe("buildImportPrBody", () => {
  it("includes the detection level, translator version, and stage count", () => {
    const body = buildImportPrBody({
      detectionLevel: "legacy_produced",
      translatorVersion: "spec-112-v1",
      legacyStageCount: 7,
    });
    expect(body).toContain("legacy_produced");
    expect(body).toContain("spec-112-v1");
    expect(body).toContain("7");
    expect(body).toContain(".factory/pipeline-state.json");
    // Spec invariant — never deletes the legacy manifest files.
    expect(body).toContain("never deleted");
  });

  it("renders deterministically (same inputs → same output)", () => {
    const args = {
      detectionLevel: "legacy_produced" as const,
      translatorVersion: "spec-112-v1",
      legacyStageCount: 5,
    };
    expect(buildImportPrBody(args)).toBe(buildImportPrBody(args));
  });

  it("handles the acp_produced case (no PR is opened in practice)", () => {
    const body = buildImportPrBody({
      detectionLevel: "acp_produced",
      translatorVersion: "spec-112-v1",
      legacyStageCount: 0,
    });
    expect(body).toContain("acp_produced");
    expect(body).toContain("0");
  });
});

describe("OpenImportPrError", () => {
  it("preserves the stage and status fields for callers", () => {
    const err = new OpenImportPrError("create-branch", 422, "boom");
    expect(err.stage).toBe("create-branch");
    expect(err.status).toBe(422);
    expect(err.message).toBe("boom");
    expect(err instanceof Error).toBe(true);
  });
});
