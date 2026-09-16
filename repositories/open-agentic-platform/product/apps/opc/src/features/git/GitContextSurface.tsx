import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@opc/ui/button';
import { api } from '@/lib/api';
import { useGitContext } from './useGitContext';
import { useGitCtxEnrichment } from './useGitCtxEnrichment';
import type { GitContextViewState } from './types';

interface GitContextSurfaceProps {
  /** When provided, the panel pre-fills the path and auto-loads git context on mount. */
  projectPath?: string;
}

/**
 * Feature 032 — T004/T005: git context panel with explicit loading / success / error / degraded / unavailable.
 */
export const GitContextSurface: React.FC<GitContextSurfaceProps> = ({ projectPath }) => {
  const [path, setPath] = useState(projectPath ?? '');
  const { state, refresh, reset } = useGitContext();
  const enrichment = useGitCtxEnrichment(path, state);
  const autoLoaded = useRef(false);

  // Auto-load when projectPath is provided
  useEffect(() => {
    if (projectPath && !autoLoaded.current) {
      autoLoaded.current = true;
      setPath(projectPath);
      void refresh(projectPath);
    }
  }, [projectPath, refresh]);

  const busy = state.status === 'loading';

  const handleRefresh = () => {
    void refresh(path);
  };

  const pickFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select git repository root',
        defaultPath: await api.getHomeDirectory(),
      });
      if (selected && typeof selected === 'string') {
        setPath(selected);
        void refresh(selected);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-4 text-foreground min-h-0">
      <header className="flex flex-col gap-1 shrink-0">
        <h1 className="text-2xl font-bold">Git context</h1>
        <p className="text-sm text-muted-foreground">
          Local repository state via native git (branch, HEAD, working tree). Feature 032 T004–T005.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 items-center shrink-0">
        <input
          className="flex-1 min-w-[12rem] px-3 py-2 bg-background border border-input rounded-md text-foreground"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="Absolute path to repository root…"
          disabled={busy}
          aria-label="Repository path"
        />
        <Button type="button" onClick={handleRefresh} disabled={busy || !path.trim()}>
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading…
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="h-4 w-4" aria-hidden />
              Refresh
            </span>
          )}
        </Button>
        <Button type="button" variant="outline" onClick={pickFolder} disabled={busy}>
          Choose folder…
        </Button>
        {state.status !== 'idle' && state.status !== 'loading' && (
          <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
            Clear
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col border rounded-md bg-muted/30 overflow-hidden">
        {state.status === 'idle' && (
          <div className="flex-1 flex items-center justify-center p-6 text-center text-muted-foreground text-sm">
            Enter a repository path or choose a folder to load git context.
          </div>
        )}

        {state.status === 'loading' && (
          <div
            className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
            <span className="text-sm">Reading git state…</span>
          </div>
        )}

        {state.status === 'unavailable' && (
          <div className="m-4 p-4 border border-muted-foreground/30 rounded-md bg-background" role="status">
            <div className="flex items-center gap-2 text-muted-foreground font-medium mb-2">
              <GitBranch className="h-5 w-5 shrink-0" aria-hidden />
              No repository
            </div>
            <p className="text-sm text-muted-foreground">{state.message}</p>
          </div>
        )}

        {state.status === 'error' && (
          <div
            className="m-4 p-4 border border-destructive/50 rounded-md bg-background"
            role="alert"
          >
            <div className="flex items-center gap-2 text-destructive font-medium mb-2">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
              Git context failed
            </div>
            <pre className="text-sm whitespace-pre-wrap font-mono">{state.message}</pre>
          </div>
        )}

        {(state.status === 'success' || state.status === 'degraded') && (
          <GitContextSummary state={state} enrichment={enrichment} />
        )}
      </div>
    </div>
  );
};

function GitContextSummary(props: {
  state: Extract<GitContextViewState, { status: 'success' | 'degraded' }>;
  enrichment: ReturnType<typeof useGitCtxEnrichment>;
}) {
  const { data, warnings } =
    props.state.status === 'degraded'
      ? { data: props.state.data, warnings: props.state.warnings }
      : { data: props.state.data, warnings: [] as string[] };
  const enrichmentWarning =
    props.enrichment.status === 'degraded' ? props.enrichment.message : null;
  const allWarnings = enrichmentWarning ? [...warnings, enrichmentWarning] : warnings;

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {allWarnings.length > 0 && (
        <div
          className="border border-amber-500/50 rounded-md bg-amber-500/5 p-3 text-sm"
          role="status"
        >
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium mb-1">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Partial data
          </div>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            {allWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="border rounded-md p-3 bg-background">
          <dt className="text-muted-foreground text-xs uppercase tracking-wide">Branch / HEAD</dt>
          <dd className="font-mono font-medium mt-1">
            {data.detached ? (
              <span title="Detached HEAD">(detached)</span>
            ) : (
              data.branch ?? '—'
            )}
          </dd>
        </div>
        <div className="border rounded-md p-3 bg-background">
          <dt className="text-muted-foreground text-xs uppercase tracking-wide">Working tree</dt>
          <dd className="font-medium mt-1">
            {data.workingTreeDirty ? (
              <span className="text-amber-600 dark:text-amber-400">Dirty</span>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400">Clean</span>
            )}
          </dd>
        </div>
        <div className="border rounded-md p-3 bg-background sm:col-span-2">
          <dt className="text-muted-foreground text-xs uppercase tracking-wide">Upstream (ahead / behind)</dt>
          <dd className="font-mono mt-1">
            {data.detached ? (
              '—'
            ) : data.upstreamResolved ? (
              <>
                {data.ahead} ahead · {data.behind} behind
              </>
            ) : (
              <span className="text-muted-foreground">Could not resolve</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="border rounded-md p-3 bg-background text-sm">
        <h2 className="font-semibold mb-2">GitHub context (axiomregent GitHub tools)</h2>
        {props.enrichment.status === 'idle' && (
          <p className="text-muted-foreground">Enrichment idle.</p>
        )}
        {props.enrichment.status === 'loading' && (
          <p className="text-muted-foreground">Loading GitHub enrichment…</p>
        )}
        {props.enrichment.status === 'degraded' && (
          <p className="text-muted-foreground">{props.enrichment.message}</p>
        )}
        {props.enrichment.status === 'success' && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Repository</dt>
              <dd className="font-mono mt-1">
                {props.enrichment.data.repository?.full_name ?? 'none selected'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Authenticated</dt>
              <dd className="mt-1">{props.enrichment.data.authenticated ? 'yes' : 'no'}</dd>
            </div>
          </dl>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">Status entries</h2>
        <div className="border rounded-md bg-background max-h-[40vh] overflow-auto">
          {data.statusEntries.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No changes (clean index and worktree).</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b">
                <tr>
                  <th className="text-left p-2 font-medium">Path</th>
                  <th className="text-left p-2 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Staged</th>
                </tr>
              </thead>
              <tbody>
                {data.statusEntries.map((e) => (
                  <tr key={`${e.path}-${e.staged}-${e.status}`} className="border-b border-border/50">
                    <td className="p-2 font-mono text-xs break-all">{e.path}</td>
                    <td className="p-2">{e.status}</td>
                    <td className="p-2">{e.staged ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
