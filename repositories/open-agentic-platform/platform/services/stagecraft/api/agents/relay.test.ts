/**
 * Spec 123 — agent catalog relay tests (org-scoped).
 *
 * Covers the two outbound paths:
 *   - publishAgentCatalogUpdated: builds an agent.catalog.updated envelope
 *     from a row and dispatches via the broadcast path keyed on the row's
 *     org_id.
 *   - sendAgentCatalogSnapshot: builds the directory (hashes only, no
 *     bodies) for currently-published rows in an org and sends it targeted
 *     to one client.
 *
 * The inbound `agent.catalog.fetch_request` handler lives in sync/service.ts
 * and is exercised through the handleInbound flow rather than unit-tested
 * here.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  selectRows: [] as unknown[],
}));

vi.mock("../db/drizzle", () => ({
  db: {
    select(_shape?: unknown) {
      const chain: {
        from: () => typeof chain;
        innerJoin: () => typeof chain;
        where: () => typeof chain;
        limit: () => Promise<unknown[]>;
        then: (resolve: (rows: unknown[]) => void) => void;
      } = {
        from() {
          return chain;
        },
        innerJoin() {
          return chain;
        },
        where() {
          return chain;
        },
        limit() {
          return Promise.resolve(fixture.selectRows);
        },
        then(resolve) {
          resolve(fixture.selectRows);
        },
      };
      return chain;
    },
  },
}));

// Spec 139 Phase 4 (T091): relay.ts now reads from
// `factory_artifact_substrate` + `factory_bindings` (legacy
// `agent_catalog` + `project_agent_bindings` were dropped in migration
// 34). Stubbed exports mirror the new column shape.
vi.mock("../db/schema", () => ({
  factoryArtifactSubstrate: {
    id: "id",
    orgId: "org_id",
    origin: "origin",
    path: "path",
    kind: "kind",
    version: "version",
    status: "status",
    contentHash: "content_hash",
    frontmatter: "frontmatter",
    updatedAt: "updated_at",
  },
  factoryBindings: {
    id: "id",
    projectId: "project_id",
    artifactId: "artifact_id",
    pinnedVersion: "pinned_version",
    pinnedContentHash: "pinned_content_hash",
    boundBy: "bound_by",
    boundAt: "bound_at",
  },
  projects: {
    id: "id",
    orgId: "org_id",
  },
}));

vi.mock("../sync/service", () => ({
  dispatchServerEvent: vi.fn(async () => ({
    eventId: "evt-stub",
    cursor: "00001",
    delivered: 2,
  })),
  sendTargetedServerEvent: vi.fn(async () => true),
}));

import {
  publishAgentCatalogUpdated,
  sendAgentCatalogSnapshot,
} from "./relay";
import {
  dispatchServerEvent,
  sendTargetedServerEvent,
} from "../sync/service";

const dispatchMock = dispatchServerEvent as unknown as ReturnType<typeof vi.fn>;
const targetedMock = sendTargetedServerEvent as unknown as ReturnType<
  typeof vi.fn
>;

function makeRow(overrides: Record<string, unknown> = {}): {
  id: string;
  orgId: string;
  name: string;
  version: number;
  status: string;
  frontmatter: Record<string, unknown>;
  bodyMarkdown: string;
  contentHash: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: "a-1",
    orgId: "org-1",
    name: "triage",
    version: 2,
    status: "published",
    frontmatter: { name: "triage", model: "opus" },
    bodyMarkdown: "# triage body",
    contentHash: "h".repeat(64),
    createdBy: "u-1",
    createdAt: new Date("2026-04-22T00:00:00Z"),
    updatedAt: new Date("2026-04-22T00:05:00Z"),
    ...overrides,
  };
}

describe("publishAgentCatalogUpdated", () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    dispatchMock.mockResolvedValue({
      eventId: "evt-1",
      cursor: "00042",
      delivered: 3,
    });
  });

  test("dispatches an agent.catalog.updated envelope keyed on the row's orgId", async () => {
    const row = makeRow();
    const result = await publishAgentCatalogUpdated(row as never);

    expect(result).toEqual({
      eventId: "evt-1",
      cursor: "00042",
      delivered: 3,
    });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const [orgId, envelope] = dispatchMock.mock.calls[0];
    expect(orgId).toBe("org-1");
    expect(envelope.kind).toBe("agent.catalog.updated");
    expect(envelope.agentId).toBe("a-1");
    expect(envelope.orgId).toBe("org-1");
    expect(envelope.name).toBe("triage");
    expect(envelope.version).toBe(2);
    expect(envelope.status).toBe("published");
    expect(envelope.contentHash).toBe("h".repeat(64));
    expect(envelope.frontmatter).toEqual({ name: "triage", model: "opus" });
    expect(envelope.bodyMarkdown).toBe("# triage body");
    expect(envelope.updatedAt).toBe("2026-04-22T00:05:00.000Z");
  });

  test("dispatches retired rows too — absence-means-removed semantics still need the terminal event", async () => {
    const row = makeRow({ status: "retired" });
    await publishAgentCatalogUpdated(row as never);
    const [, envelope] = dispatchMock.mock.calls[0];
    expect(envelope.status).toBe("retired");
  });

  test("refuses to relay a draft — drafts never travel the wire", async () => {
    const row = makeRow({ status: "draft" });
    await expect(
      publishAgentCatalogUpdated(row as never),
    ).rejects.toThrow(/draft/);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe("sendAgentCatalogSnapshot", () => {
  beforeEach(() => {
    targetedMock.mockClear();
    targetedMock.mockResolvedValue(true);
    fixture.selectRows = [];
  });

  test("builds a directory-only snapshot (no bodies) and targets the requesting client", async () => {
    // Spec 139 Phase 4: relay reads factoryArtifactSubstrate; rows
    // expose `path` (for name extraction) and `frontmatter` (for the
    // publication_status filter) instead of legacy `name` / `status`.
    fixture.selectRows = [
      {
        id: "a-1",
        orgId: "org-1",
        path: "user-authored/triage.md",
        version: 2,
        contentHash: "a".repeat(64),
        frontmatter: { publication_status: "published" },
        updatedAt: new Date("2026-04-22T00:05:00Z"),
      },
      {
        id: "a-2",
        orgId: "org-1",
        path: "user-authored/review.md",
        version: 1,
        contentHash: "b".repeat(64),
        frontmatter: { publication_status: "published" },
        updatedAt: new Date("2026-04-22T00:06:00Z"),
      },
    ];

    const sent = await sendAgentCatalogSnapshot("org-1", "client-x");
    expect(sent).toBe(true);

    expect(targetedMock).toHaveBeenCalledTimes(1);
    const [orgId, clientId, envelope] = targetedMock.mock.calls[0];
    expect(orgId).toBe("org-1");
    expect(clientId).toBe("client-x");
    expect(envelope.kind).toBe("agent.catalog.snapshot");
    expect(envelope.entries).toHaveLength(2);

    // Critical invariant (spec 111 §2.3): snapshot entries must NOT include
    // frontmatter or bodyMarkdown — the desktop pulls bodies via
    // agent.catalog.fetch_request on cache miss.
    for (const entry of envelope.entries) {
      expect(entry).not.toHaveProperty("frontmatter");
      expect(entry).not.toHaveProperty("bodyMarkdown");
      expect(entry.status).toBe("published");
      expect(entry.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }

    expect(envelope.entries[0]).toEqual({
      agentId: "a-1",
      orgId: "org-1",
      name: "triage",
      version: 2,
      status: "published",
      contentHash: "a".repeat(64),
      updatedAt: "2026-04-22T00:05:00.000Z",
    });
  });
});

// ---------------------------------------------------------------------------
// Spec 123 §7.2 — Project agent binding broadcast tests
// ---------------------------------------------------------------------------

import {
  publishProjectAgentBindingUpdated,
  sendProjectAgentBindingSnapshot,
} from "./relay";
import {
  AGENT_CATALOG_ENVELOPE_VERSION,
  PROJECT_AGENT_BINDING_ENVELOPE_VERSION,
} from "../sync/types";

function makeBinding(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-1",
    projectId: "proj-1",
    orgAgentId: "a-1",
    pinnedVersion: 3,
    pinnedContentHash: "p".repeat(64),
    boundBy: "u-1",
    boundAt: new Date("2026-04-23T00:00:00Z"),
    ...overrides,
  };
}

describe("publishProjectAgentBindingUpdated", () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    dispatchMock.mockResolvedValue({
      eventId: "evt-2",
      cursor: "00100",
      delivered: 4,
    });
  });

  test("dispatches a project.agent_binding.updated envelope keyed on the org", async () => {
    const binding = makeBinding();
    const result = await publishProjectAgentBindingUpdated({
      orgId: "org-1",
      projectId: "proj-1",
      binding: binding as never,
      agentName: "triage",
      action: "bound",
    });
    expect(result.delivered).toBe(4);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const [orgId, envelope] = dispatchMock.mock.calls[0];
    expect(orgId).toBe("org-1");
    expect(envelope.kind).toBe("project.agent_binding.updated");
    expect(envelope.orgId).toBe("org-1");
    expect(envelope.projectId).toBe("proj-1");
    expect(envelope.bindingId).toBe("b-1");
    expect(envelope.orgAgentId).toBe("a-1");
    expect(envelope.agentName).toBe("triage");
    expect(envelope.pinnedVersion).toBe(3);
    expect(envelope.pinnedContentHash).toBe("p".repeat(64));
    expect(envelope.action).toBe("bound");
    expect(envelope.boundAt).toBe("2026-04-23T00:00:00.000Z");
  });

  test("emits action='unbound' so desktop knows to drop the binding from local state", async () => {
    const binding = makeBinding();
    await publishProjectAgentBindingUpdated({
      orgId: "org-1",
      projectId: "proj-1",
      binding: binding as never,
      agentName: "triage",
      action: "unbound",
    });
    const [, envelope] = dispatchMock.mock.calls[0];
    expect(envelope.action).toBe("unbound");
  });
});

describe("sendProjectAgentBindingSnapshot", () => {
  beforeEach(() => {
    targetedMock.mockClear();
    targetedMock.mockResolvedValue(true);
    fixture.selectRows = [];
  });

  test("builds a per-project binding directory keyed on the project", async () => {
    // Spec 139 Phase 4: bindings come from factory_bindings ⨝
    // factory_artifact_substrate. Field shape mirrors the new SELECT
    // (artifactId + substrate.path); the relay derives `agentName` by
    // stripping the `user-authored/` prefix + `.md` suffix from path.
    fixture.selectRows = [
      {
        bindingId: "b-1",
        artifactId: "a-1",
        pinnedVersion: 2,
        pinnedContentHash: "p".repeat(64),
        path: "user-authored/triage.md",
      },
      {
        bindingId: "b-2",
        artifactId: "a-2",
        pinnedVersion: 5,
        pinnedContentHash: "q".repeat(64),
        path: "user-authored/review.md",
      },
    ];

    const sent = await sendProjectAgentBindingSnapshot(
      "org-1",
      "proj-1",
      "client-x",
    );
    expect(sent).toBe(true);
    expect(targetedMock).toHaveBeenCalledTimes(1);
    const [orgId, clientId, envelope] = targetedMock.mock.calls[0];
    expect(orgId).toBe("org-1");
    expect(clientId).toBe("client-x");
    expect(envelope.kind).toBe("project.agent_binding.snapshot");
    expect(envelope.orgId).toBe("org-1");
    expect(envelope.projectId).toBe("proj-1");
    expect(envelope.bindings).toHaveLength(2);
    expect(envelope.bindings[0]).toEqual({
      bindingId: "b-1",
      orgAgentId: "a-1",
      agentName: "triage",
      pinnedVersion: 2,
      pinnedContentHash: "p".repeat(64),
    });
  });
});

// ---------------------------------------------------------------------------
// Spec 123 §7.3 / T044 — compile-time schema-version constants.
//
// The const exports in `api/sync/types.ts` and the Rust mirror in
// `apps/opc/src-tauri/src/commands/sync_client.rs` must stay in lock-
// step. Drift surfaces here as a test failure rather than runtime parse
// failure (the Rust side has matching constants; if a developer bumps one
// without the other, the Rust crate's constant test fails on `cargo test`
// and this TS test fails on `npm test`).
// ---------------------------------------------------------------------------

describe("schema-version constants", () => {
  test("AGENT_CATALOG_ENVELOPE_VERSION is 2 (spec 123 bump from spec 111's v: 1)", () => {
    expect(AGENT_CATALOG_ENVELOPE_VERSION).toBe(2);
  });

  test("PROJECT_AGENT_BINDING_ENVELOPE_VERSION is 1 (new in spec 123)", () => {
    expect(PROJECT_AGENT_BINDING_ENVELOPE_VERSION).toBe(1);
  });
});
