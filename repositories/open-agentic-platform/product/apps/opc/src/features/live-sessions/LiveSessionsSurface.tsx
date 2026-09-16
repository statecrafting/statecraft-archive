import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Power, RefreshCw } from 'lucide-react';
import { Button } from '@opc/ui/button';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  api,
  type ForceDisconnectResult,
  type LiveSessionRow,
  type LiveSessionsSnapshot,
  type SessionStatus,
} from '@/lib/api';

const POLL_INTERVAL_MS = 2_000;

interface LiveSessionsSurfaceProps {
  projectPath?: string;
}

/**
 * Spec 172 — Live agent-session introspection.
 *
 * Renders the snapshot from `api.listLiveSessions()` with a polling loop and
 * a Tauri-event listener for force-disconnect events; both feed into the
 * same refresh path so the panel stays current without manual reload.
 */
export const LiveSessionsSurface: React.FC<LiveSessionsSurfaceProps> = ({ projectPath }) => {
  const [snapshot, setSnapshot] = useState<LiveSessionsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ForceDisconnectResult | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const snap = await api.listLiveSessions();
      if (!mountedRef.current) return;
      setSnapshot(snap);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    let unlisten: UnlistenFn | undefined;
    void listen<unknown>('live-sessions:force-disconnected', () => {
      void refresh();
    }).then((u) => {
      if (mountedRef.current) {
        unlisten = u;
      } else {
        u();
      }
    });

    return () => {
      mountedRef.current = false;
      clearInterval(id);
      if (unlisten) unlisten();
    };
  }, [refresh]);

  const sessions = snapshot?.sessions ?? [];
  const workflows = snapshot?.workflows ?? [];

  const visibleSessions = useMemo(() => {
    if (!projectPath) return sessions;
    return sessions.filter((s) => s.projectPath === projectPath || s.projectPath.startsWith(projectPath));
  }, [sessions, projectPath]);

  const onForceDisconnect = useCallback(
    async (row: LiveSessionRow) => {
      const reason = window.prompt(
        `Force-disconnect session ${row.sessionId}?\n\nProvide an audit reason (logged to the governance chain):`,
        '',
      );
      if (reason === null) return; // cancelled
      setActionPending(row.sessionId);
      try {
        const result = await api.forceDisconnectSession({
          sessionId: row.sessionId,
          projectId: deriveProjectId(row.projectPath),
          projectPath: row.projectPath,
          reason: reason || undefined,
        });
        setActionResult(result);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setActionPending(null);
      }
    },
    [refresh],
  );

  return (
    <div className="p-6 h-full flex flex-col gap-4 text-foreground overflow-auto">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">Live Sessions</h1>
          <p className="text-sm text-muted-foreground">
            Spec 172 — live agent-session introspection. Surfaces connected sessions and active
            orchestrator workflows, with force-disconnect for runaway agents.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
      </header>

      {error && (
        <div className="border border-red-400 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-200 rounded-md p-3 text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-none" />
          <div>
            <div className="font-medium">Failed to load live sessions</div>
            <div className="text-xs mt-1">{error}</div>
          </div>
        </div>
      )}

      <ThresholdSummary snapshot={snapshot} />

      <section>
        <SectionHeader title="Sessions" count={visibleSessions.length} />
        {visibleSessions.length === 0 ? (
          <EmptyHint message="No connected agent sessions for this workspace." />
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Session</th>
                  <th className="text-left px-3 py-2">Project</th>
                  <th className="text-left px-3 py-2">Scope</th>
                  <th className="text-right px-3 py-2">Tool/min</th>
                  <th className="text-right px-3 py-2">Tokens/min</th>
                  <th className="text-left px-3 py-2">Recent Calls</th>
                  <th className="text-right px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleSessions.map((row) => (
                  <SessionRow
                    key={row.sessionId}
                    row={row}
                    pending={actionPending === row.sessionId}
                    onForceDisconnect={() => void onForceDisconnect(row)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionHeader title="Active Workflows" count={workflows.length} />
        {workflows.length === 0 ? (
          <EmptyHint message="No orchestrator workflows currently running." />
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Workflow</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Project</th>
                  <th className="text-left px-3 py-2">Originating Session</th>
                  <th className="text-left px-3 py-2">Stage</th>
                  <th className="text-left px-3 py-2">Started</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((w) => (
                  <tr key={w.workflowId} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{w.workflowName}</td>
                    <td className="px-3 py-2 text-xs">{w.status}</td>
                    <td className="px-3 py-2 text-xs" title={w.projectPath ?? w.projectId ?? ''}>
                      {w.projectPath ? shortPath(w.projectPath) : (w.projectId ?? '—')}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" title={w.originatingSession ?? ''}>
                      {w.originatingSession ? `${w.originatingSession.slice(0, 8)}…` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {w.currentStepName ? (
                        <>
                          {w.currentStepName}
                          {w.stepCount !== undefined &&
                          w.currentStepIndex !== undefined ? (
                            <span className="text-muted-foreground"> ({w.currentStepIndex + 1}/{w.stepCount})</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">pending</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{formatRelative(w.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {actionResult && (
        <ActionResultBanner result={actionResult} onDismiss={() => setActionResult(null)} />
      )}
    </div>
  );
};

interface SectionHeaderProps {
  title: string;
  count: number;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title, count }) => (
  <div className="flex items-center justify-between mb-2">
    <h2 className="text-lg font-medium">{title}</h2>
    <span className="text-xs text-muted-foreground">{count} row{count === 1 ? '' : 's'}</span>
  </div>
);

const EmptyHint: React.FC<{ message: string }> = ({ message }) => (
  <div className="text-sm text-muted-foreground border border-dashed rounded-md p-4">
    {message}
  </div>
);

interface SessionRowProps {
  row: LiveSessionRow;
  pending: boolean;
  onForceDisconnect: () => void;
}

const SessionRow: React.FC<SessionRowProps> = ({ row, pending, onForceDisconnect }) => {
  const recent = row.activity.recentToolCalls
    .slice(0, 3)
    .map((c) => c.tool_name)
    .join(', ');
  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-3 py-2 font-mono text-xs" title={row.sessionId}>
        {row.sessionId.slice(0, 8)}…
      </td>
      <td className="px-3 py-2 text-xs" title={row.projectPath}>
        {shortPath(row.projectPath)}
      </td>
      <td className="px-3 py-2 text-xs">{row.scope}</td>
      <td className="px-3 py-2 text-right text-xs">{row.activity.toolCallsPerMinute}</td>
      <td className="px-3 py-2 text-right text-xs">
        {row.activity.tokensPerMinute.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{recent || '—'}</td>
      <td className="px-3 py-2 text-right">
        <Button
          variant="destructive"
          size="sm"
          onClick={onForceDisconnect}
          disabled={pending}
          aria-label="Force-disconnect session"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Power className="h-3.5 w-3.5" />
          )}
          <span className="ml-1">Disconnect</span>
        </Button>
      </td>
    </tr>
  );
};

const StatusBadge: React.FC<{ status: SessionStatus }> = ({ status }) => {
  const styles: Record<SessionStatus, string> = {
    idle: 'bg-muted text-muted-foreground border-muted-foreground/30',
    active: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-200',
    critical: 'bg-red-50 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-200',
  };
  return (
    <span className={`text-[11px] uppercase border rounded px-2 py-0.5 ${styles[status]}`}>
      {status}
    </span>
  );
};

const ThresholdSummary: React.FC<{ snapshot: LiveSessionsSnapshot | null }> = ({ snapshot }) => {
  if (!snapshot) return null;
  const t = snapshot.thresholds;
  return (
    <div className="border rounded-md p-3 bg-muted/30 text-xs flex flex-wrap gap-x-6 gap-y-1">
      <span>
        <span className="text-muted-foreground">warning ≥</span>{' '}
        <span className="font-mono">{t.warningToolCallsPerMinute}</span> tool/min,{' '}
        <span className="font-mono">{t.warningTokensPerMinute.toLocaleString()}</span> tok/min
      </span>
      <span>
        <span className="text-muted-foreground">critical ≥</span>{' '}
        <span className="font-mono">{t.criticalToolCallsPerMinute}</span> tool/min,{' '}
        <span className="font-mono">{t.criticalTokensPerMinute.toLocaleString()}</span> tok/min
      </span>
      <span>
        <span className="text-muted-foreground">cumulative critical ≥</span>{' '}
        <span className="font-mono">{t.criticalCumulativeToolCalls.toLocaleString()}</span> calls
      </span>
    </div>
  );
};

const ActionResultBanner: React.FC<{
  result: ForceDisconnectResult;
  onDismiss: () => void;
}> = ({ result, onDismiss }) => {
  const ok = result.closedProcess && result.warnings.length === 0;
  return (
    <div
      className={`border rounded-md p-3 text-sm flex items-start gap-3 ${
        ok
          ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-100'
          : 'border-amber-300 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-100'
      }`}
    >
      <div className="flex-1">
        <div className="font-medium">
          Force-disconnect {ok ? 'complete' : 'partial'} — {result.sessionId.slice(0, 8)}…
        </div>
        <ul className="mt-1 text-xs grid gap-0.5">
          <li>cancel in-flight: {result.cancelledInFlight ? '✓' : '—'}</li>
          <li>close process: {result.closedProcess ? '✓' : '—'}</li>
          <li>checkpoint: {result.checkpointId ? result.checkpointId : '—'}</li>
          <li>
            audit event id: {result.auditEventId !== null ? result.auditEventId : '—'}
          </li>
          <li>notify: {result.notified ? '✓' : '—'}</li>
          {result.warnings.length > 0 && (
            <li>
              warnings:{' '}
              <span className="font-mono">{result.warnings.join(', ')}</span>
            </li>
          )}
        </ul>
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        dismiss
      </Button>
    </div>
  );
};

function deriveProjectId(projectPath: string): string {
  // Claude's project-id convention: leading slash dropped, every `/` -> `-`.
  return projectPath.replace(/^\//, '').replace(/\//g, '-');
}

function shortPath(path: string): string {
  if (path.length <= 48) return path;
  const tail = path.slice(-44);
  return `…${tail}`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString();
}
