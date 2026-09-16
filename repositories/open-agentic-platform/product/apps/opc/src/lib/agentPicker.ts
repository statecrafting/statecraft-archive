import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// AgentPicker data layer (spec 126 §3, §5).
//
// TS mirror of `crates/factory-contracts/src/agent_reference.rs`.
//
// The Rust enum serialises externally-tagged (`{ "by_id": { ... } }`); this
// module uses an internal `kind` discriminant instead because the desktop has
// no shared serde→TS bridge yet. Callers that hand the reference back to the
// `factory-engine` AgentResolver MUST translate. When a generator lands, this
// declaration can be replaced with the generated form.
export type AgentReference =
  | { kind: "by_id"; org_agent_id: string; version: number }
  | { kind: "by_name"; name: string; version: number }
  | { kind: "by_name_latest"; name: string };

export type BindingStatus = "active" | "retired_upstream";

export interface BindingRow {
  binding_id: number;
  project_id: string;
  org_agent_id: string;
  pinned_version: number;
  pinned_content_hash: string;
  status: BindingStatus;
  agent_id: number | null;
  name: string | null;
  icon: string | null;
  model: string | null;
  frontmatter_json: string | null;
  created_at: string;
  updated_at: string;
}

export type CatalogStatus = "published" | "retired" | "draft";

export interface CatalogRow {
  agent_id: number;
  org_agent_id: string;
  name: string;
  icon: string;
  model: string;
  version: number;
  content_hash: string;
  status: CatalogStatus;
  frontmatter_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentPickerData {
  active: BindingRow[];
  browse: CatalogRow[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

interface FetchedRows {
  active: BindingRow[];
  browse: CatalogRow[];
}

// Concurrent-fetch dedup keyed on (orgId, projectId). React strict mode and
// multiple picker instances on the same page share an in-flight request
// rather than each issuing their own pair of Tauri invokes.
const inflight = new Map<string, Promise<FetchedRows>>();

function pickerKey(orgId: string, projectId: string | undefined): string {
  return `${orgId}|${projectId ?? ""}`;
}

async function fetchPickerRows(
  orgId: string,
  projectId: string | undefined,
): Promise<FetchedRows> {
  const activeP: Promise<BindingRow[]> = projectId
    ? invoke<BindingRow[]>("list_active_agents", { project_id: projectId })
    : Promise.resolve<BindingRow[]>([]);
  const browseP: Promise<CatalogRow[]> = invoke<CatalogRow[]>(
    "list_org_agents",
    { org_id: orgId },
  );
  const [active, browse] = await Promise.all([activeP, browseP]);
  return { active, browse };
}

function dedupedFetch(
  orgId: string,
  projectId: string | undefined,
): Promise<FetchedRows> {
  const key = pickerKey(orgId, projectId);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = fetchPickerRows(orgId, projectId).finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

const CATALOG_EVENTS = [
  "agent-catalog-updated",
  "agent-catalog-snapshot",
] as const;
const BINDING_EVENTS = [
  "project-agent-binding-updated",
  "project-agent-binding-snapshot",
] as const;

export function useAgentPickerData(
  orgId: string,
  projectId?: string,
): AgentPickerData {
  const [active, setActive] = useState<BindingRow[]>([]);
  const [browse, setBrowse] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await dedupedFetch(orgId, projectId);
      if (cancelledRef.current) return;
      setActive(result.active);
      setBrowse(result.browse);
    } catch (e) {
      if (cancelledRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      setActive([]);
      setBrowse([]);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [orgId, projectId]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const events: string[] = [...CATALOG_EVENTS];
      if (projectId) events.push(...BINDING_EVENTS);
      for (const evt of events) {
        const unlisten = await listen(evt, () => {
          refresh();
        });
        if (!active) {
          unlisten();
        } else {
          unlisteners.push(unlisten);
        }
      }
    })().catch(() => {
      // listen() may not be available in non-Tauri contexts (tests, web build);
      // silently skip — the picker still works without auto-refresh.
    });
    return () => {
      active = false;
      unlisteners.forEach((u) => u());
    };
  }, [projectId, refresh]);

  return { active, browse, loading, error, refresh };
}
