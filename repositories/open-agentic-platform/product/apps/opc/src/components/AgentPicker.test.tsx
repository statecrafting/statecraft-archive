import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

const eventListeners = new Map<string, Set<(e: { payload: unknown }) => void>>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (eventName: string, handler: (e: { payload: unknown }) => void) => {
      let set = eventListeners.get(eventName);
      if (!set) {
        set = new Set();
        eventListeners.set(eventName, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    },
  ),
}));

import { AgentPicker, AgentPickerView } from "./AgentPicker";
import type {
  AgentReference,
  BindingRow,
  CatalogRow,
} from "@/lib/agentPicker";

const fixtureBinding = (over: Partial<BindingRow> = {}): BindingRow => ({
  binding_id: 1,
  project_id: "proj-001",
  org_agent_id: "01000000-0000-0000-0000-0000000000a1",
  pinned_version: 3,
  pinned_content_hash: "a3f2c8b410ed5f9c0a7b8e1d2c3f4a5b6c7d8e9f",
  status: "active",
  agent_id: 11,
  name: "reviewer",
  icon: "🤖",
  model: "opus-4.6",
  frontmatter_json: '{"safety_tier":1}',
  created_at: "2026-04-12T10:00:00Z",
  updated_at: "2026-04-15T11:00:00Z",
  ...over,
});

const fixtureCatalog = (over: Partial<CatalogRow> = {}): CatalogRow => ({
  agent_id: 11,
  org_agent_id: "01000000-0000-0000-0000-0000000000a1",
  name: "reviewer",
  icon: "🤖",
  model: "opus-4.6",
  version: 3,
  content_hash: "a3f2c8b410ed5f9c0a7b8e1d2c3f4a5b6c7d8e9f",
  status: "published",
  frontmatter_json: '{"safety_tier":1}',
  created_at: "2026-04-12T10:00:00Z",
  updated_at: "2026-04-15T11:00:00Z",
  ...over,
});

afterEach(() => {
  cleanup();
  eventListeners.clear();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.useRealTimers();
});

describe("AgentPickerView (T040, A-2..A-8)", () => {
  it("renders Active tab as default when projectId is provided (A-2)", () => {
    const onSelect = vi.fn();
    render(
      <AgentPickerView
        orgId="org-1"
        projectId="proj-001"
        open
        onOpenChange={() => {}}
        onSelect={onSelect}
        active={[fixtureBinding()]}
        browse={[fixtureCatalog()]}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("agent-picker-active-list")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-picker-browse-list")).toBeNull();
    expect(screen.getByText(/Active/)).toBeInTheDocument();
    expect(screen.getByText(/All org agents/)).toBeInTheDocument();
  });

  it("hides Active tab and defaults to Browse when projectId is undefined (A-3)", () => {
    render(
      <AgentPickerView
        orgId="org-1"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
        active={[]}
        browse={[fixtureCatalog()]}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("agent-picker-browse-list")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-picker-active-list")).toBeNull();
  });

  it("preserves the search filter input when switching tabs", async () => {
    render(
      <AgentPickerView
        orgId="org-1"
        projectId="proj-001"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
        active={[fixtureBinding()]}
        browse={[fixtureCatalog()]}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    const search = screen.getByLabelText("Search agents") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "reviewer" } });
    expect(search.value).toBe("reviewer");

    const browseTab = screen.getByRole("tab", { name: /All org agents/ });
    fireEvent.click(browseTab);

    const searchAfter = screen.getByLabelText(
      "Search agents",
    ) as HTMLInputElement;
    expect(searchAfter.value).toBe("reviewer");
  });

  it("makes retired-upstream rows non-selectable (A-2 invariant I-B3)", () => {
    const onSelect = vi.fn();
    const retired = fixtureBinding({
      binding_id: 2,
      org_agent_id: "02000000-0000-0000-0000-0000000000b2",
      status: "retired_upstream",
      agent_id: null,
      name: null,
      model: null,
      frontmatter_json: null,
    });
    render(
      <AgentPickerView
        orgId="org-1"
        projectId="proj-001"
        open
        onOpenChange={() => {}}
        onSelect={onSelect}
        active={[retired]}
        browse={[]}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    const retiredRow = screen.getByTestId("agent-picker-row-retired");
    fireEvent.click(retiredRow);
    expect(onSelect).not.toHaveBeenCalled();
    expect(retiredRow).toHaveAttribute("aria-disabled", "true");
  });

  it("filters draft catalog rows out of browse (A-3 invariant)", () => {
    const draft = fixtureCatalog({
      agent_id: 99,
      name: "draft-agent",
      status: "draft",
    });
    render(
      <AgentPickerView
        orgId="org-1"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
        active={[]}
        browse={[fixtureCatalog(), draft]}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    expect(screen.queryByText(/draft-agent/)).toBeNull();
    expect(screen.getByText(/reviewer/)).toBeInTheDocument();
  });

  it("emits AgentReference::ById by default (A-4 active)", () => {
    const onSelect = vi.fn();
    render(
      <AgentPickerView
        orgId="org-1"
        projectId="proj-001"
        open
        onOpenChange={() => {}}
        onSelect={onSelect}
        active={[fixtureBinding()]}
        browse={[]}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("agent-picker-row-active"));
    expect(onSelect).toHaveBeenCalledWith({
      kind: "by_id",
      org_agent_id: "01000000-0000-0000-0000-0000000000a1",
      version: 3,
    } satisfies AgentReference);
  });

  it("emits AgentReference::ByNameLatest when 'latest' toggle is on (A-4 browse)", () => {
    const onSelect = vi.fn();
    render(
      <AgentPickerView
        orgId="org-1"
        open
        onOpenChange={() => {}}
        onSelect={onSelect}
        active={[]}
        browse={[fixtureCatalog()]}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    const toggle = screen.getByTestId("agent-picker-latest-toggle");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId("agent-picker-row-catalog"));
    expect(onSelect).toHaveBeenCalledWith({
      kind: "by_name_latest",
      name: "reviewer",
    } satisfies AgentReference);
  });

  it("emits AgentReference::ById from browse when 'latest' is off (A-4 browse default)", () => {
    const onSelect = vi.fn();
    render(
      <AgentPickerView
        orgId="org-1"
        open
        onOpenChange={() => {}}
        onSelect={onSelect}
        active={[]}
        browse={[fixtureCatalog()]}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("agent-picker-row-catalog"));
    expect(onSelect).toHaveBeenCalledWith({
      kind: "by_id",
      org_agent_id: "01000000-0000-0000-0000-0000000000a1",
      version: 3,
    } satisfies AgentReference);
  });

  it("opens the statecraft web UI deep-link via tauri-plugin-shell (A-6)", async () => {
    const { open: openShell } = await import("@tauri-apps/plugin-shell");
    const { api } = await import("@/lib/api");
    vi.spyOn(api, "getStatecraftBaseUrl").mockResolvedValue(
      "https://statecraft.example.test/",
    );
    render(
      <AgentPickerView
        orgId="org-1"
        projectId="proj-001"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
        active={[fixtureBinding()]}
        browse={[]}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />,
    );
    const manageBtn = screen.getByRole("button", { name: /Manage bindings/ });
    fireEvent.click(manageBtn);
    await waitFor(() => {
      expect(openShell).toHaveBeenCalledWith(
        "https://statecraft.example.test/app/project/proj-001/agents",
      );
    });
  });
});

describe("AgentPicker container (A-5 duplex auto-refresh)", () => {
  it("re-fetches when an agent-catalog-updated event fires", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation(
      async (cmd: string): Promise<BindingRow[] | CatalogRow[]> => {
        if (cmd === "list_active_agents") return [];
        if (cmd === "list_org_agents") return [];
        return [];
      },
    );

    render(
      <AgentPicker
        orgId="org-evt"
        projectId="proj-evt"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("list_org_agents", {
        org_id: "org-evt",
      });
    });
    const initialCalls = invokeMock.mock.calls.length;

    await waitFor(() => {
      expect(eventListeners.has("agent-catalog-updated")).toBe(true);
    });
    const handlers = eventListeners.get("agent-catalog-updated");
    expect(handlers).toBeDefined();
    handlers!.forEach((h) => h({ payload: {} }));

    await waitFor(() => {
      expect(invokeMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });
});
