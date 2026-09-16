import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  RotateCcw,
  Plus,
  ShieldCheck,
  GitCompareArrows,
  GitBranch,
  GitCommit,
} from 'lucide-react';
import { Button } from '@opc/ui/button';
import { useCheckpointFlow } from './useCheckpointFlow';
import type { Checkpoint, CheckpointDiff, VerificationReport } from './types';

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Inline diff summary. */
const DiffSummary: React.FC<{ diff: CheckpointDiff }> = ({ diff }) => {
  const changedFiles = [...diff.added, ...diff.modified, ...diff.deleted];
  return (
    <div className="border rounded-md p-3 bg-background text-sm space-y-2">
      <div className="font-medium flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4" />
        Diff: {diff.from_checkpoint_id.slice(0, 8)} &rarr; {diff.to_checkpoint_id.slice(0, 8)}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="border rounded px-2 py-1">
          <span className="text-green-600 dark:text-green-400 font-medium">+{diff.added.length}</span> added
        </div>
        <div className="border rounded px-2 py-1">
          <span className="text-amber-600 dark:text-amber-400 font-medium">~{diff.modified.length}</span> modified
        </div>
        <div className="border rounded px-2 py-1">
          <span className="text-red-600 dark:text-red-400 font-medium">-{diff.deleted.length}</span> deleted
        </div>
      </div>
      {changedFiles.length > 0 && (
        <details>
          <summary className="text-xs font-medium cursor-pointer text-muted-foreground">
            Changed files ({changedFiles.length})
          </summary>
          <ul className="text-xs font-mono mt-1 max-h-40 overflow-auto space-y-0.5">
            {changedFiles.map((f) => (
              <li key={f} className="px-1 py-0.5 rounded hover:bg-muted/50 truncate" title={f}>
                {f}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

/** Inline verification badge. */
const VerifyBadge: React.FC<{ report: VerificationReport }> = ({ report }) => {
  const errors = [...report.corrupted_files, ...report.missing_blobs];
  const valid = report.merkle_root_valid && errors.length === 0;
  return (
    <details className="text-xs">
      <summary
        className={`cursor-pointer font-medium inline-flex items-center gap-1 ${
          valid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
        }`}
      >
        {valid ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
        {valid ? 'Valid' : 'Invalid'}
      </summary>
      <div className="mt-1 pl-4 space-y-0.5 text-muted-foreground">
        <div>Merkle root: {report.merkle_root_valid ? 'ok' : 'fail'}</div>
        {errors.length > 0 && (
          <div className="text-red-600 dark:text-red-400">
            Errors: {errors.join('; ')}
          </div>
        )}
      </div>
    </details>
  );
};

/** Single checkpoint row. */
const CheckpointRow: React.FC<{
  cp: Checkpoint;
  busy: { restoring: string | null; verifying: string | null };
  verification: VerificationReport | undefined;
  diffSelected: Set<string>;
  onRestore: (id: string) => void;
  onVerify: (id: string) => void;
  onToggleDiffSelect: (id: string) => void;
}> = ({ cp, busy, verification, diffSelected, onRestore, onVerify, onToggleDiffSelect }) => {
  const [expanded, setExpanded] = useState(false);
  const isRestoring = busy.restoring === cp.checkpoint_id;
  const isVerifying = busy.verifying === cp.checkpoint_id;
  const selected = diffSelected.has(cp.checkpoint_id);

  return (
    <div className={`border rounded-md bg-background ${selected ? 'ring-2 ring-primary/50' : ''}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            {cp.label || <span className="text-muted-foreground italic">unnamed</span>}
            {cp.branch_name && (
              <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-normal">
                <GitBranch className="h-3 w-3" />
                {cp.branch_name}
              </span>
            )}
            {cp.parent_id === null && (
              <span className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-normal">
                root
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground flex gap-3">
            <span>{relativeTime(cp.created_at)}</span>
            <span>{cp.file_count} files</span>
            <span>{formatBytes(cp.total_bytes)}</span>
            {cp.head_sha && (
              <span className="inline-flex items-center gap-1 font-mono" title={cp.head_sha}>
                <GitCommit className="h-3 w-3" />
                {cp.head_sha.slice(0, 7)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onToggleDiffSelect(cp.checkpoint_id)}
            title="Select for diff"
          >
            <GitCompareArrows className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onVerify(cp.checkpoint_id)}
            disabled={isVerifying}
            title="Verify integrity"
          >
            {isVerifying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ShieldCheck className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-amber-600 dark:text-amber-400"
            onClick={() => {
              if (window.confirm(`Restore to "${cp.label || cp.checkpoint_id.slice(0, 8)}"? This will overwrite current files.`)) {
                onRestore(cp.checkpoint_id);
              }
            }}
            disabled={isRestoring}
            title="Restore to this checkpoint"
          >
            {isRestoring ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-2 pt-1 border-t text-xs space-y-1 text-muted-foreground">
          <div>ID: <span className="font-mono">{cp.checkpoint_id}</span></div>
          <div>Timestamp: {new Date(cp.created_at).toLocaleString()}</div>
          {cp.head_sha && <div>Git SHA: <span className="font-mono">{cp.head_sha}</span></div>}
          {cp.branch_name && <div>Branch: <span className="font-medium">{cp.branch_name}</span></div>}
          {cp.run_id && <div>Run ID: <span className="font-mono">{cp.run_id}</span></div>}
          {cp.parent_id && <div>Parent: <span className="font-mono">{cp.parent_id.slice(0, 8)}...</span></div>}
          <div>State hash: <span className="font-mono truncate">{cp.state_hash.slice(0, 16)}...</span></div>
          <div>Merkle root: <span className="font-mono truncate">{cp.merkle_root.slice(0, 16)}...</span></div>
          {cp.fingerprint && cp.fingerprint !== '{}' && (
            <details>
              <summary className="cursor-pointer font-medium">Fingerprint</summary>
              <pre className="mt-1 text-xs font-mono bg-muted/50 p-2 rounded overflow-auto max-h-24">
                {JSON.stringify(JSON.parse(cp.fingerprint), null, 2)}
              </pre>
            </details>
          )}
          {verification && <VerifyBadge report={verification} />}
        </div>
      )}
    </div>
  );
};

interface CheckpointSurfaceProps {
  /** When provided, the panel pre-fills the root path and auto-initializes on mount. */
  projectPath?: string;
}

export const CheckpointSurface: React.FC<CheckpointSurfaceProps> = ({ projectPath }) => {
  const { state, initialize, createCheckpoint, restore, diff, verify, reset } = useCheckpointFlow();
  const [rootInput, setRootInput] = useState(projectPath ?? '');
  const [messageInput, setMessageInput] = useState('');
  const autoLoaded = useRef(false);

  // Auto-initialize when projectPath is provided
  useEffect(() => {
    if (projectPath && !autoLoaded.current) {
      autoLoaded.current = true;
      setRootInput(projectPath);
      initialize(projectPath);
    }
  }, [projectPath, initialize]);
  const [diffSelected, setDiffSelected] = useState<Set<string>>(new Set());

  const isBusy = state.status === 'initializing';

  const handleInit = () => {
    if (rootInput.trim()) {
      initialize(rootInput.trim());
    }
  };

  const handleCreate = async () => {
    await createCheckpoint(messageInput.trim() || undefined);
    setMessageInput('');
  };

  const handleToggleDiffSelect = (id: string) => {
    setDiffSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 2) {
          // Replace the oldest selection
          const first = next.values().next().value;
          if (first != null) next.delete(first);
        }
        next.add(id);
      }
      return next;
    });
  };

  const handleDiff = () => {
    const ids = Array.from(diffSelected);
    if (ids.length === 2) {
      // Order chronologically: older first
      const cp0 = state.checkpoints.find((c) => c.checkpoint_id === ids[0]);
      const cp1 = state.checkpoints.find((c) => c.checkpoint_id === ids[1]);
      if (cp0 && cp1) {
        const [older, newer] =
          new Date(cp0.created_at).getTime() <= new Date(cp1.created_at).getTime()
            ? [cp0.checkpoint_id, cp1.checkpoint_id]
            : [cp1.checkpoint_id, cp0.checkpoint_id];
        diff(older, newer);
      }
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-4 text-foreground">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="h-6 w-6" />
          Repo Snapshots
        </h1>
        <p className="text-sm text-muted-foreground">
          Create, list, restore, diff, and verify full-repo snapshots.
        </p>
        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1.5 max-w-3xl">
          <p className="text-xs text-foreground">
            <span className="font-medium">What this is.</span>{' '}
            A repo snapshot captures the entire working tree as a Merkle-hashed archive (excluding <code>.git</code>, <code>node_modules</code>, <code>target</code>). Snapshots are stored by axiomregent, scoped to the repo root — independent of any Claude conversation. Use them for verifiable governance, full-tree diffs across long timeframes, and restoring repo state across sessions.
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Not to be confused with Conversation Snapshots</span> — those auto-track only the files Claude edits inside one chat and rewind the conversation alongside the files. Find that surface via the <em>Settings</em> (cog) icon in the composer.
          </p>
        </div>
      </header>

      {/* Init controls — always visible so user can switch projects */}
      <div className="flex gap-2 items-center">
        <input
          className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-foreground"
          value={state.status === 'ready' ? state.projectRoot : rootInput}
          onChange={(e) => setRootInput(e.target.value)}
          placeholder="Project root path"
          disabled={isBusy || state.status === 'ready'}
          onKeyDown={(e) => e.key === 'Enter' && handleInit()}
          aria-label="Project root path for checkpoint tracking"
        />
        {state.status !== 'ready' ? (
          <Button onClick={handleInit} disabled={isBusy || !rootInput.trim()}>
            {isBusy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Initializing...
              </span>
            ) : (
              'Initialize'
            )}
          </Button>
        ) : (
          <Button variant="outline" onClick={reset}>
            Change project
          </Button>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex flex-col border rounded-md bg-muted/40">
        {state.status === 'idle' && (
          <div className="flex-1 flex items-center justify-center p-6 text-center text-muted-foreground text-sm">
            Enter a project root path and click Initialize to start tracking checkpoints.
          </div>
        )}

        {state.status === 'initializing' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
            <span className="text-sm">Initializing checkpoint tracking...</span>
          </div>
        )}

        {state.status === 'error' && (
          <div className="flex-1 flex flex-col gap-2 p-4 border border-destructive/50 rounded-md m-4 bg-background">
            <div className="flex items-center gap-2 text-destructive font-medium">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
              Checkpoint operation failed
            </div>
            <pre className="text-sm whitespace-pre-wrap font-mono text-foreground">{state.error}</pre>
            <Button variant="outline" size="sm" className="self-start mt-2" onClick={reset}>
              Reset
            </Button>
          </div>
        )}

        {state.status === 'ready' && (
          <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-3">
            {/* Create checkpoint */}
            <div className="flex gap-2 items-center">
              <input
                className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-foreground text-sm"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Checkpoint message (optional)"
                disabled={state.busy.creating}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <Button
                onClick={handleCreate}
                disabled={state.busy.creating}
                size="sm"
              >
                {state.busy.creating ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Creating...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Create checkpoint
                  </span>
                )}
              </Button>
            </div>

            {/* Diff controls */}
            {diffSelected.size === 2 && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDiff}
                  disabled={state.busy.diffing}
                >
                  {state.busy.diffing ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Diffing...
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <GitCompareArrows className="h-3 w-3" />
                      Compare selected
                    </span>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDiffSelected(new Set())}
                >
                  Clear selection
                </Button>
              </div>
            )}
            {diffSelected.size === 1 && (
              <div className="text-xs text-muted-foreground">
                Select one more checkpoint to compare (click the diff icon).
              </div>
            )}

            {/* Diff result */}
            {state.diff && <DiffSummary diff={state.diff} />}

            {/* Branch summary (095 Slice 6) */}
            {state.checkpoints.length > 0 && (() => {
              const branches = new Map<string, number>();
              for (const cp of state.checkpoints) {
                const branch = cp.branch_name ?? 'unknown';
                branches.set(branch, (branches.get(branch) ?? 0) + 1);
              }
              const forkPoints = state.checkpoints.filter(
                (cp) => state.checkpoints.filter((c) => c.parent_id === cp.checkpoint_id).length > 1
              );
              return branches.size > 1 || forkPoints.length > 0 ? (
                <div className="border rounded-md p-3 bg-background text-xs space-y-1">
                  <div className="font-medium flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    Branches
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(branches.entries()).map(([name, count]) => (
                      <span key={name} className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        <GitBranch className="h-3 w-3" />
                        {name} <span className="text-muted-foreground">({count})</span>
                      </span>
                    ))}
                  </div>
                  {forkPoints.length > 0 && (
                    <div className="text-muted-foreground">
                      {forkPoints.length} divergence point{forkPoints.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              ) : null;
            })()}

            {/* Checkpoint list */}
            {state.checkpoints.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">
                No checkpoints yet. Create your first checkpoint above.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground font-medium">
                  {state.checkpoints.length} checkpoint{state.checkpoints.length !== 1 ? 's' : ''}
                </div>
                {state.checkpoints.map((cp) => (
                  <CheckpointRow
                    key={cp.checkpoint_id}
                    cp={cp}
                    busy={state.busy}
                    verification={state.verifications[cp.checkpoint_id]}
                    diffSelected={diffSelected}
                    onRestore={restore}
                    onVerify={verify}
                    onToggleDiffSelect={handleToggleDiffSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
