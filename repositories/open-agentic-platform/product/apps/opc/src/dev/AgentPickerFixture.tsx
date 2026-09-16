import React, { useState } from "react";
import { AgentPickerView } from "@/components/AgentPicker";
import type { AgentReference, BindingRow, CatalogRow } from "@/lib/agentPicker";

export const FIXTURE_BINDINGS: BindingRow[] = [
  {
    binding_id: 1,
    project_id: "proj-001",
    org_agent_id: "01000000-0000-0000-0000-0000000000a1",
    pinned_version: 3,
    pinned_content_hash:
      "a3f2c8b410ed5f9c0a7b8e1d2c3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f",
    status: "active",
    agent_id: 11,
    name: "reviewer",
    icon: "🤖",
    model: "opus-4.6",
    frontmatter_json: '{"safety_tier":1}',
    created_at: "2026-04-12T10:00:00Z",
    updated_at: "2026-04-15T11:00:00Z",
  },
  {
    binding_id: 2,
    project_id: "proj-001",
    org_agent_id: "02000000-0000-0000-0000-0000000000b2",
    pinned_version: 2,
    pinned_content_hash:
      "9c11ab23ef45cd6789012345678901234567890abcdef0123456789abcdef01",
    status: "retired_upstream",
    agent_id: null,
    name: null,
    icon: null,
    model: null,
    frontmatter_json: null,
    created_at: "2026-03-20T09:00:00Z",
    updated_at: "2026-04-01T08:00:00Z",
  },
];

export const FIXTURE_CATALOG: CatalogRow[] = [
  {
    agent_id: 11,
    org_agent_id: "01000000-0000-0000-0000-0000000000a1",
    name: "reviewer",
    icon: "🤖",
    model: "opus-4.6",
    version: 3,
    content_hash:
      "a3f2c8b410ed5f9c0a7b8e1d2c3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f",
    status: "published",
    frontmatter_json: '{"safety_tier":1}',
    created_at: "2026-04-12T10:00:00Z",
    updated_at: "2026-04-15T11:00:00Z",
  },
  {
    agent_id: 12,
    org_agent_id: "03000000-0000-0000-0000-0000000000c3",
    name: "scaffolder",
    icon: "🏗️",
    model: "sonnet-4.6",
    version: 7,
    content_hash:
      "c8d2ef34567890123456789012345678901234567890abcdef0123456789abcd",
    status: "published",
    frontmatter_json: '{"safety_tier":2}',
    created_at: "2026-04-18T14:00:00Z",
    updated_at: "2026-04-22T15:00:00Z",
  },
  {
    agent_id: 13,
    org_agent_id: "04000000-0000-0000-0000-0000000000d4",
    name: "summarizer",
    icon: "📝",
    model: "haiku-4.5",
    version: 1,
    content_hash:
      "d4e5f60123456789012345678901234567890abcdef0123456789abcdef0123",
    status: "published",
    frontmatter_json: '{"safety_tier":1}',
    created_at: "2026-04-25T08:00:00Z",
    updated_at: "2026-04-25T08:00:00Z",
  },
];

export const AgentPickerFixturePage: React.FC = () => {
  const [open, setOpen] = useState(true);
  const [lastSelection, setLastSelection] = useState<AgentReference | null>(
    null,
  );
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold mb-4">AgentPicker fixture</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Visual review with mixed-status fixture rows. Selections appear below.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1 border rounded mb-4"
      >
        Open picker
      </button>
      <pre className="text-xs bg-muted/50 p-2 rounded mb-4">
        {lastSelection
          ? JSON.stringify(lastSelection, null, 2)
          : "(no selection)"}
      </pre>
      <AgentPickerView
        orgId="org-fixture"
        projectId="proj-001"
        open={open}
        onOpenChange={setOpen}
        onSelect={(ref) => {
          setLastSelection(ref);
          setOpen(false);
        }}
        active={FIXTURE_BINDINGS}
        browse={FIXTURE_CATALOG}
        loading={false}
        error={null}
        onRefresh={() => {}}
      />
    </div>
  );
};

export default AgentPickerFixturePage;
