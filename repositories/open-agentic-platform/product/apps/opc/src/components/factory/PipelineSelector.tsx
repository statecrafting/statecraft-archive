// Spec: specs/076-factory-desktop-panel/spec.md
// Pipeline selector — start a new pipeline or display the running run ID.

import React, { useEffect, useMemo, useState } from 'react';
import { FolderOpen, FolderTree, LogIn, Play, PlayCircle, Square } from 'lucide-react';
import { Button } from '@opc/ui/button';
import { SelectComponent } from '@opc/ui/select';
import { open } from '@tauri-apps/plugin-dialog';
import { exists, readDir } from '@tauri-apps/plugin-fs';
import { api } from '@/lib/api';
import type { OpcBundle } from '@/types/factoryBundle';
import { useAuth } from '@/contexts/AuthContext';
import { useFactoryPipeline } from './FactoryPipelineContext';
import { stagesFromProcessDefinition } from './types';

const ADAPTER_FALLBACK = 'next-prisma';
const PROJECTS_SUBDIR = 'oap-projects';
const RAW_ARTIFACTS_SUBDIR = '.artifacts/raw';
const BUSINESS_DOC_EXTENSIONS = new Set(['md', 'txt', 'pdf', 'docx']);
// Hard cap on recursive folder walks. Business document corpora are small;
// anything over this is almost certainly the user pointing at the wrong dir
// (e.g. a `node_modules`), and unbounded recursion would freeze the panel.
const FOLDER_WALK_FILE_LIMIT = 500;
const FOLDER_WALK_DEPTH_LIMIT = 8;

interface PipelineSelectorProps {
  projectPath?: string;
  bundle?: OpcBundle;
}

function joinPath(parent: string, child: string): string {
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return parent.endsWith(sep) ? `${parent}${child}` : `${parent}${sep}${child}`;
}

function hasBusinessDocExt(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return BUSINESS_DOC_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

async function walkBusinessDocs(
  dir: string,
  collected: string[],
  depth = 0,
): Promise<void> {
  if (depth > FOLDER_WALK_DEPTH_LIMIT) return;
  if (collected.length >= FOLDER_WALK_FILE_LIMIT) return;
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (collected.length >= FOLDER_WALK_FILE_LIMIT) return;
    const full = joinPath(dir, entry.name);
    if (entry.isDirectory) {
      await walkBusinessDocs(full, collected, depth + 1);
    } else if (hasBusinessDocExt(entry.name)) {
      collected.push(full);
    }
  }
}

export const PipelineSelector: React.FC<PipelineSelectorProps> = ({
  projectPath,
  bundle,
}) => {
  const { state, startPipeline, cancelPipeline, resumePipeline } =
    useFactoryPipeline();
  const auth = useAuth();
  // Pipeline runs go through statecraft (org-scoped policy bundle, adapter
  // resolution, factory.run reservation). If the desktop doesn't have an
  // active org we'd hit `FactoryError::NoOrgId` after the user clicks
  // Start — pre-empt that with a clear sign-in CTA so they don't stare
  // at a cryptic error after the round trip.
  const needsSignIn =
    auth.status === 'unauthenticated' ||
    (auth.status === 'authenticated' && !auth.org);
  const handleSignIn = () => { void auth.login(); };

  const initialAdapter = bundle?.adapter?.name ?? ADAPTER_FALLBACK;
  const [adapterName, setAdapterName] = useState(initialAdapter);
  const [businessDocs, setBusinessDocs] = useState<string[]>([]);
  const [rawArtifactsDir, setRawArtifactsDir] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string | null>(null);

  // Resync adapter when the bundle resolves (e.g. after deep-link handoff).
  useEffect(() => {
    const next = bundle?.adapter?.name;
    if (next) setAdapterName(next);
  }, [bundle?.adapter?.name]);

  // Adapters resolved from the platform (spec 076) so the picker reflects
  // what the org actually has rather than a free-typed/hardcoded name.
  // Loaded once the user is signed in; on failure the picker still offers
  // the current/bundle adapter (see `adapterOptions`) so the form is usable.
  const [adapters, setAdapters] = useState<{ name: string; version: string }[]>([]);
  useEffect(() => {
    if (needsSignIn) return;
    let cancelled = false;
    void api
      .listFactoryAdapters()
      .then((list) => {
        if (!cancelled) setAdapters(list);
      })
      .catch(() => {
        if (!cancelled) setAdapters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsSignIn]);

  // Options for the adapter dropdown. Always include the currently-selected
  // adapter so a bundle-seeded value (or a not-yet-loaded list) stays
  // selectable rather than silently resetting to a placeholder.
  const adapterOptions = useMemo(() => {
    const opts = adapters.map((a) => ({
      value: a.name,
      label: `${a.name} · v${a.version}`,
    }));
    if (adapterName && !opts.some((o) => o.value === adapterName)) {
      opts.unshift({ value: adapterName, label: adapterName });
    }
    return opts;
  }, [adapters, adapterName]);

  // Lazy-load the home directory once. Used to derive a fallback project path
  // (`<homeDir>/oap-projects/<slug>`) when the panel is opened with a bundle
  // but the parent tab lost its `projectPath` (e.g. dev reload — the
  // tab-persistence layer historically dropped `factoryBundle`, so a re-issued
  // handoff could land on a stale tab whose projectPath was never refreshed).
  useEffect(() => {
    let cancelled = false;
    void api
      .getHomeDirectory()
      .then((p) => {
        if (!cancelled) setHomeDir(p || null);
      })
      .catch(() => {
        if (!cancelled) setHomeDir(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Effective project path: prop wins; otherwise derive from the bundle's
  // canonical clone target. ProjectOpenInbox uses the same `<homeDir>/
  // oap-projects/<slug>` shape, so the derivation matches what `Clone locally`
  // would have produced.
  const effectiveProjectPath = useMemo(() => {
    const fromProp = projectPath?.trim();
    if (fromProp) return fromProp;
    const slug = bundle?.project?.slug;
    if (homeDir && slug) {
      return joinPath(joinPath(homeDir, PROJECTS_SUBDIR), slug);
    }
    return '';
  }, [projectPath, bundle?.project?.slug, homeDir]);

  // Auto-discover Business Documents from the project's hydrated raw
  // artefacts. Spec 113 / spec 087: clone & import write business inputs
  // into `<project>/.artifacts/raw/`. Pre-populating that here means a
  // freshly cloned project can start its pipeline without manual picking.
  useEffect(() => {
    let cancelled = false;
    if (!effectiveProjectPath) {
      setBusinessDocs([]);
      setRawArtifactsDir(null);
      return;
    }
    const dir = joinPath(effectiveProjectPath, RAW_ARTIFACTS_SUBDIR);
    (async () => {
      try {
        if (!(await exists(dir))) {
          if (!cancelled) {
            setRawArtifactsDir(null);
            setBusinessDocs([]);
          }
          return;
        }
        const entries = await readDir(dir);
        const picks: string[] = [];
        for (const entry of entries) {
          if (entry.isDirectory) continue;
          if (!hasBusinessDocExt(entry.name)) continue;
          picks.push(joinPath(dir, entry.name));
        }
        if (!cancelled) {
          setRawArtifactsDir(dir);
          setBusinessDocs(picks);
        }
      } catch {
        if (!cancelled) {
          setRawArtifactsDir(null);
          setBusinessDocs([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveProjectPath]);

  const handlePickDocs = async () => {
    // Open the picker inside `.artifacts/raw/` when present so the native
    // macOS dialog displays the hydrated documents directly. The dot-prefix
    // on the parent is irrelevant once the dialog is already inside it.
    const defaultPath = rawArtifactsDir ?? effectiveProjectPath ?? undefined;
    const selected = await open({
      multiple: true,
      defaultPath,
      filters: [
        {
          name: 'Business Documents',
          extensions: ['md', 'txt', 'pdf', 'docx'],
        },
      ],
    });
    if (selected === null) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setBusinessDocs(paths);
  };

  // Tauri's `open` is single-mode (files OR directories, never both), so the
  // folder pick lives behind its own button. Selected directories are walked
  // recursively for business-doc files; results are merged into whatever the
  // file picker already produced so users can stack a folder on top of a few
  // ad-hoc files.
  const handlePickFolder = async () => {
    if (pickingFolder) return;
    setPickingFolder(true);
    try {
      const defaultPath = rawArtifactsDir ?? effectiveProjectPath ?? undefined;
      const selected = await open({
        multiple: true,
        directory: true,
        defaultPath,
      });
      if (selected === null) return;
      const folders = Array.isArray(selected) ? selected : [selected];
      const collected: string[] = [];
      for (const folder of folders) {
        await walkBusinessDocs(folder, collected);
        if (collected.length >= FOLDER_WALK_FILE_LIMIT) break;
      }
      setBusinessDocs((prev) => {
        const seen = new Set(prev);
        const merged = [...prev];
        for (const p of collected) {
          if (!seen.has(p)) {
            merged.push(p);
            seen.add(p);
          }
        }
        return merged;
      });
    } finally {
      setPickingFolder(false);
    }
  };

  const handleClearDocs = () => {
    setBusinessDocs([]);
  };

  const handleStart = async () => {
    if (starting) return;
    setStartError(null);
    if (!effectiveProjectPath) {
      setStartError(
        'Cannot start pipeline: no project path resolved. Open this project from the statecraft handoff (Open in OPC) or the Projects tab so OPC knows where the local clone lives.',
      );
      return;
    }
    setStarting(true);
    try {
      await startPipeline(
        effectiveProjectPath,
        adapterName.trim() || ADAPTER_FALLBACK,
        businessDocs,
        bundle?.project?.id,
        // Forward the platform's current process name (what this panel
        // renders under "Processes"). Omitted when the bundle has none —
        // the backend then resolves it from the platform. Never a name
        // baked into the client, so a platform rename needs no rebuild.
        bundle?.processes?.[0]?.name,
        // Seed the DAG from the platform process definition (spec 076) so
        // the displayed stage list is server-resolved, not hardcoded.
        stagesFromProcessDefinition(bundle?.processes?.[0]?.definition),
      );
    } catch (err) {
      // The Tauri command swallows errors silently — surface them inline so
      // the user can act on adapter mismatches, missing factory roots, etc.
      // instead of staring at a button that just bounces back to "Start".
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const isIdle = state.phase === 'idle';

  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await cancelPipeline('User cancelled from UI');
    } finally {
      setCancelling(false);
    }
  };

  const handleResume = async () => {
    if (resuming) return;
    setResuming(true);
    setResumeError(null);
    try {
      await resumePipeline({
        adapterName: bundle?.adapter?.name ?? adapterName,
        statecraftProjectId: bundle?.project?.id,
      });
    } catch (err) {
      // Tauri's `invoke` rejects with the raw string from the Rust `Err`
      // branch — not an `Error` — so we accept both shapes here.
      setResumeError(
        typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message
            : 'Resume failed',
      );
    } finally {
      setResuming(false);
    }
  };

  if (!isIdle) {
    // Active pipeline — show run metadata + cancel button.
    const isActive = state.phase === 'process' || state.phase === 'scaffolding';
    const isPaused = state.phase === 'paused';
    return (
      <div className="flex flex-col gap-1 px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium shrink-0">
              Run
            </span>
            <span className="font-mono text-xs truncate text-foreground">
              {state.runId ?? '—'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isActive && (
              <Button
                variant="destructive"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={handleCancel}
                disabled={cancelling}
              >
                <Square className="h-3 w-3" />
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </Button>
            )}
            {isPaused && (
              <Button
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={handleResume}
                disabled={resuming}
                title="Resume from the last completed stage"
              >
                <PlayCircle className="h-3 w-3" />
                {resuming ? 'Resuming…' : 'Resume'}
              </Button>
            )}
          </div>
        </div>
        {resumeError && (
          <p className="text-xs text-destructive break-words" role="alert">
            {resumeError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 border-b border-border space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">Start New Pipeline</span>
      </div>

      {needsSignIn && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-1.5">
          <p className="text-xs text-amber-200 font-medium">
            Not signed in to statecraft
          </p>
          <p className="text-[11px] text-amber-200/80 leading-snug">
            Factory pipelines run against your statecraft organization —
            policy bundle, adapter resolution, run reservation. Sign in to
            connect this OPC to your org.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs w-full gap-1.5"
            onClick={handleSignIn}
            disabled={auth.status === 'loading'}
          >
            <LogIn className="h-3 w-3" />
            {auth.status === 'loading' ? 'Signing in…' : 'Sign in to statecraft'}
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Adapter</label>
        <SelectComponent
          value={adapterName}
          onValueChange={setAdapterName}
          options={adapterOptions}
          placeholder="Select an adapter…"
          className="h-8 text-xs"
          disabled={starting || needsSignIn}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Business Documents</label>
          {businessDocs.length > 0 && (
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground underline disabled:opacity-50"
              onClick={handleClearDocs}
              disabled={starting}
            >
              clear
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs justify-start gap-2 min-w-0"
            onClick={handlePickDocs}
            disabled={starting || pickingFolder}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {businessDocs.length === 0
                ? 'Pick files…'
                : `${businessDocs.length} file${businessDocs.length === 1 ? '' : 's'} selected`}
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 shrink-0 px-2"
            onClick={handlePickFolder}
            disabled={starting || pickingFolder}
            title="Pick a folder — files matching .md/.txt/.pdf/.docx are added recursively"
          >
            <FolderTree className="h-3.5 w-3.5" />
            {pickingFolder ? 'Walking…' : 'Folder'}
          </Button>
        </div>
      </div>

      <Button
        className="w-full h-8 text-xs gap-2"
        onClick={handleStart}
        disabled={
          starting || !adapterName.trim() || !effectiveProjectPath || needsSignIn
        }
        title={needsSignIn ? 'Sign in to statecraft first' : undefined}
      >
        <Play className="h-3.5 w-3.5" />
        {starting ? 'Starting…' : 'Start Pipeline'}
      </Button>

      {startError && (
        <p
          className="text-xs text-destructive break-words"
          role="alert"
        >
          {startError}
        </p>
      )}
    </div>
  );
};
