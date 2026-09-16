import React, { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  RefreshCw,
  RotateCw,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@opc/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@opc/ui/tabs";
import { Button } from "@opc/ui/button";
import { Badge } from "@opc/ui/badge";
import { Input } from "@opc/ui/input";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useDebounce } from "@/hooks/useDebounce";
import { api } from "@/lib/api";
import {
  useAgentPickerData,
  type AgentReference,
  type BindingRow,
  type CatalogRow,
} from "@/lib/agentPicker";

export type AgentFilter = (row: CatalogRow) => boolean;

export interface AgentPickerProps {
  orgId: string;
  projectId?: string;
  onSelect: (reference: AgentReference) => void;
  defaultMode?: "active" | "browse";
  filter?: AgentFilter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface AgentPickerViewProps {
  orgId: string;
  projectId?: string;
  onSelect: (reference: AgentReference) => void;
  defaultMode?: "active" | "browse";
  filter?: AgentFilter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: BindingRow[];
  browse: CatalogRow[];
  loading: boolean;
  error: Error | null;
  onRefresh: () => void;
}

type Mode = "active" | "browse";

export const AgentPicker: React.FC<AgentPickerProps> = (props) => {
  const data = useAgentPickerData(props.orgId, props.projectId);
  return (
    <AgentPickerView
      {...props}
      active={data.active}
      browse={data.browse}
      loading={data.loading}
      error={data.error}
      onRefresh={data.refresh}
    />
  );
};

export const AgentPickerView: React.FC<AgentPickerViewProps> = ({
  orgId: _orgId,
  projectId,
  open,
  onOpenChange,
  onSelect,
  defaultMode,
  filter,
  active,
  browse,
  loading,
  error,
  onRefresh,
}) => {
  const initialMode: Mode = defaultMode ?? (projectId ? "active" : "browse");
  const [mode, setMode] = useState<Mode>(initialMode);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 200);

  const showTabs = Boolean(projectId);
  const effectiveMode: Mode = showTabs ? mode : "browse";

  const filteredActive = useMemo<BindingRow[]>(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return active;
    return active.filter(
      (r) =>
        (r.name?.toLowerCase().includes(q) ?? false) ||
        r.org_agent_id.toLowerCase().includes(q),
    );
  }, [active, debouncedQuery]);

  const filteredBrowse = useMemo<CatalogRow[]>(() => {
    const q = debouncedQuery.trim().toLowerCase();
    let rows = browse.filter((r) => r.status !== "draft");
    if (filter) rows = rows.filter(filter);
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    return rows;
  }, [browse, debouncedQuery, filter]);

  const [latestByAgent, setLatestByAgent] = useState<Set<number>>(
    () => new Set(),
  );
  const toggleLatest = useCallback((agentId: number) => {
    setLatestByAgent((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const handleSelectActive = useCallback(
    (row: BindingRow) => {
      onSelect({
        kind: "by_id",
        org_agent_id: row.org_agent_id,
        version: row.pinned_version,
      });
    },
    [onSelect],
  );

  const handleSelectBrowse = useCallback(
    (row: CatalogRow) => {
      if (latestByAgent.has(row.agent_id)) {
        onSelect({ kind: "by_name_latest", name: row.name });
      } else {
        onSelect({
          kind: "by_id",
          org_agent_id: row.org_agent_id,
          version: row.version,
        });
      }
    },
    [onSelect, latestByAgent],
  );

  const handleManageBindings = useCallback(async () => {
    if (!projectId) return;
    const baseUrl = await api.getStatecraftBaseUrl();
    const trimmed = baseUrl.replace(/\/+$/, "");
    await openShell(`${trimmed}/app/project/${projectId}/agents`);
  }, [projectId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Choose an agent
          </DialogTitle>
          <DialogDescription>
            Pick an org agent to use for this project. Bindings are managed in
            the statecraft web UI.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4 flex flex-col gap-3">
          {showTabs ? (
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
            >
              <TabsList>
                <TabsTrigger value="active">
                  Active
                  <Badge variant="secondary" className="ml-2">
                    {active.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="browse">
                  All org agents
                  <Badge variant="secondary" className="ml-2">
                    {browse.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                className="pl-8"
                placeholder="Search by name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search agents"
              />
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={onRefresh}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          {error ? (
            <div className="border rounded-md p-3 text-sm bg-destructive/10 text-destructive flex items-center justify-between">
              <span>Failed to load agents: {error.message}</span>
              <Button size="sm" variant="outline" onClick={onRefresh}>
                Retry
              </Button>
            </div>
          ) : null}

          <div className="border rounded-md overflow-hidden min-h-[280px] max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : effectiveMode === "active" ? (
              <ActiveList
                rows={filteredActive}
                projectId={projectId}
                onBindCTA={handleManageBindings}
                onSelect={handleSelectActive}
              />
            ) : (
              <BrowseList
                rows={filteredBrowse}
                onSelect={handleSelectBrowse}
                latestByAgent={latestByAgent}
                onToggleLatest={toggleLatest}
              />
            )}
          </div>
        </div>

        <div className="px-6 py-4 flex justify-between gap-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {projectId ? (
            <Button variant="default" onClick={handleManageBindings}>
              Manage bindings
              <ExternalLink className="ml-2 w-4 h-4" />
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ActiveList: React.FC<{
  rows: BindingRow[];
  projectId?: string;
  onBindCTA: () => void;
  onSelect: (row: BindingRow) => void;
}> = ({ rows, projectId, onBindCTA, onSelect }) => {
  if (rows.length === 0) {
    return (
      <div className="py-8 px-4 text-center flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground">
          No bindings yet — open the project's Agents tab in statecraft to bind
          one.
        </p>
        {projectId ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onBindCTA}
            data-testid="agent-picker-bind-cta"
          >
            Bind an org agent to this project
            <ExternalLink className="ml-2 w-4 h-4" />
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <ul className="divide-y" data-testid="agent-picker-active-list">
      {rows.map((row) => (
        <BindingRowItem
          key={row.binding_id}
          row={row}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
};

const BrowseList: React.FC<{
  rows: CatalogRow[];
  onSelect: (row: CatalogRow) => void;
  latestByAgent: Set<number>;
  onToggleLatest: (agentId: number) => void;
}> = ({ rows, onSelect, latestByAgent, onToggleLatest }) => {
  if (rows.length === 0) {
    return (
      <div className="py-8 px-4 text-center text-sm text-muted-foreground">
        No org agents available.
      </div>
    );
  }
  return (
    <ul className="divide-y" data-testid="agent-picker-browse-list">
      {rows.map((row) => (
        <CatalogRowItem
          key={row.agent_id}
          row={row}
          onSelect={onSelect}
          isLatest={latestByAgent.has(row.agent_id)}
          onToggleLatest={() => onToggleLatest(row.agent_id)}
        />
      ))}
    </ul>
  );
};

const BindingRowItem: React.FC<{
  row: BindingRow;
  onSelect: (row: BindingRow) => void;
}> = ({ row, onSelect }) => {
  const isRetired = row.status === "retired_upstream";
  const displayName = row.name ?? row.org_agent_id;
  const shortHash = row.pinned_content_hash.slice(0, 7);
  return (
    <li
      role="button"
      tabIndex={isRetired ? -1 : 0}
      aria-disabled={isRetired || undefined}
      data-testid={
        isRetired ? "agent-picker-row-retired" : "agent-picker-row-active"
      }
      className={
        isRetired
          ? "p-3 opacity-60 cursor-not-allowed"
          : "p-3 hover:bg-muted/50 cursor-pointer"
      }
      onClick={() => {
        if (!isRetired) onSelect(row);
      }}
      onKeyDown={(e) => {
        if (!isRetired && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect(row);
        }
      }}
      title={isRetired ? "Retired upstream — unbind via web UI." : undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {isRetired ? (
          <AlertTriangle className="w-4 h-4 text-destructive" aria-hidden />
        ) : (
          <Bot className="w-4 h-4" aria-hidden />
        )}
        <span className="font-medium">
          {displayName} @ v{row.pinned_version}
        </span>
        <span
          className="text-xs text-muted-foreground"
          title={row.pinned_content_hash}
        >
          sha:{shortHash}
        </span>
        {isRetired ? (
          <Badge variant="destructive">RETIRED</Badge>
        ) : (
          <Badge variant="secondary">active</Badge>
        )}
      </div>
      {isRetired ? (
        <p className="text-xs text-muted-foreground mt-1">
          Upstream retired — unbind via web UI.
        </p>
      ) : row.model ? (
        <p className="text-xs text-muted-foreground mt-1">
          model: {row.model}
        </p>
      ) : null}
    </li>
  );
};

const CatalogRowItem: React.FC<{
  row: CatalogRow;
  onSelect: (row: CatalogRow) => void;
  isLatest: boolean;
  onToggleLatest: () => void;
}> = ({ row, onSelect, isLatest, onToggleLatest }) => {
  const isRetired = row.status === "retired";
  const shortHash = row.content_hash.slice(0, 7);
  return (
    <li
      role="button"
      tabIndex={isRetired ? -1 : 0}
      aria-disabled={isRetired || undefined}
      data-testid={
        isRetired
          ? "agent-picker-row-catalog-retired"
          : "agent-picker-row-catalog"
      }
      className={
        isRetired
          ? "p-3 opacity-60 cursor-not-allowed"
          : "p-3 hover:bg-muted/50 cursor-pointer"
      }
      onClick={() => {
        if (!isRetired) onSelect(row);
      }}
      onKeyDown={(e) => {
        if (!isRetired && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect(row);
        }
      }}
      title={isRetired ? "Retired upstream — unbind via web UI." : undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {isRetired ? (
          <AlertTriangle className="w-4 h-4 text-destructive" aria-hidden />
        ) : (
          <Bot className="w-4 h-4" aria-hidden />
        )}
        <span className="font-medium">
          {row.name} {isLatest ? "@ latest" : `@ v${row.version}`}
        </span>
        <span
          className="text-xs text-muted-foreground"
          title={row.content_hash}
        >
          sha:{shortHash}
        </span>
        {isRetired ? (
          <Badge variant="destructive">RETIRED</Badge>
        ) : (
          <Badge variant="secondary">{row.status}</Badge>
        )}
        {!isRetired ? (
          <button
            type="button"
            data-testid="agent-picker-latest-toggle"
            aria-pressed={isLatest}
            title={
              isLatest
                ? "Resolves at run time to the latest published version"
                : "Always use latest published version"
            }
            className={
              isLatest
                ? "ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-primary text-primary"
                : "ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-muted-foreground hover:text-foreground"
            }
            onClick={(e) => {
              e.stopPropagation();
              onToggleLatest();
            }}
          >
            <RotateCw className="w-3 h-3" aria-hidden />
            latest
          </button>
        ) : null}
      </div>
      {isRetired ? (
        <p className="text-xs text-muted-foreground mt-1">
          Upstream retired — unbind via web UI.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground mt-1">model: {row.model}</p>
      )}
    </li>
  );
};

export default AgentPicker;
