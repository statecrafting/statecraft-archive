// Spec: specs/076-factory-desktop-panel/spec.md
// Artifact inspection panel for viewing stage outputs.

import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Braces, FileCode, File } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { cn } from '@/lib/utils';
import { useFactoryPipeline } from './FactoryPipelineContext';
import { claudeSyntaxTheme } from '@/lib/claudeSyntaxTheme';
import type { ArtifactEntry } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mimeType: ArtifactEntry['mimeType']): React.ReactNode {
  switch (mimeType) {
    case 'markdown':
      return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />;
    case 'json':
      return <Braces className="h-4 w-4 shrink-0 text-muted-foreground" />;
    case 'yaml':
      return <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" />;
    default:
      return <File className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
}

async function readArtifactContent(path: string): Promise<string> {
  try {
    // Dynamic import — @tauri-apps/plugin-fs is an optional native plugin.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fsPlugin = await import('@tauri-apps/plugin-fs' as any);
    return await fsPlugin.readTextFile(path);
  } catch {
    return `[Unable to read file: ${path}]`;
  }
}

// ── ArtifactSidebar ───────────────────────────────────────────────────────────

interface ArtifactSidebarProps {
  artifacts: ArtifactEntry[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

const ArtifactSidebar: React.FC<ArtifactSidebarProps> = ({
  artifacts,
  selectedIndex,
  onSelect,
}) => {
  return (
    <div className="w-[200px] shrink-0 border-r border-border overflow-y-auto">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Files
        </span>
      </div>
      <ul className="py-1">
        {artifacts.map((entry, idx) => (
          <li key={entry.path}>
            <button
              type="button"
              onClick={() => onSelect(idx)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                selectedIndex === idx
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground',
              )}
            >
              {mimeIcon(entry.mimeType)}
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium">{entry.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatFileSize(entry.size)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ── ArtifactContent ───────────────────────────────────────────────────────────

interface ArtifactContentProps {
  artifact: ArtifactEntry;
  content: string | null;
  loading: boolean;
}

const ArtifactContent: React.FC<ArtifactContentProps> = ({
  artifact,
  content,
  loading,
}) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
        Failed to load content.
      </div>
    );
  }

  if (artifact.mimeType === 'markdown') {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <div className="prose prose-sm prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    );
  }

  if (artifact.mimeType === 'json' || artifact.mimeType === 'yaml') {
    // Spec 120 FR-023 — typed `ExtractionOutput` view. Detect by content
    // shape rather than mime so the existing `extraction-output.json`
    // sidecar (no special mime) renders in the typed mode.
    const typed = tryParseExtractionOutput(content);
    if (typed) {
      return <ExtractionOutputView output={typed} />;
    }
    return (
      <JsonYamlContent
        content={content}
        language={artifact.mimeType === 'json' ? 'json' : 'yaml'}
      />
    );
  }

  // text / unknown — monospace pre-formatted
  return (
    <div className="flex-1 overflow-auto p-4">
      <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  );
};

// ── ExtractionOutputView (spec 120 FR-023) ───────────────────────────────────

type AgentRunView = {
  modelId?: string;
  promptFingerprint?: string;
  durationMs?: number;
  costUsd?: number;
  attempts?: number;
  tokenSpend?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
};

type ExtractionOutputShape = {
  text: string;
  pages?: Array<{ index: number; text: string }>;
  language?: string;
  outline?: Array<{ level: number; text: string; pageIndex?: number }>;
  metadata?: Record<string, unknown>;
  extractor: { kind: string; version: string; agentRun?: AgentRunView };
};

function tryParseExtractionOutput(content: string): ExtractionOutputShape | null {
  try {
    const v = JSON.parse(content);
    if (
      v &&
      typeof v === 'object' &&
      typeof v.text === 'string' &&
      v.extractor &&
      typeof v.extractor.kind === 'string' &&
      typeof v.extractor.version === 'string'
    ) {
      return v as ExtractionOutputShape;
    }
  } catch {
    // not JSON
  }
  return null;
}

const ExtractionOutputView: React.FC<{ output: ExtractionOutputShape }> = ({
  output,
}) => {
  const [showFullText, setShowFullText] = useState(false);
  const TEXT_PREVIEW = 4000;
  const truncated = output.text.length > TEXT_PREVIEW;
  const visibleText = showFullText
    ? output.text
    : output.text.slice(0, TEXT_PREVIEW);

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4 text-sm">
      <header className="rounded border border-border p-3 space-y-1 bg-card">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Typed extraction
        </div>
        <div className="font-mono">
          <span className="text-foreground">{output.extractor.kind}</span>
          <span className="text-muted-foreground"> · v{output.extractor.version}</span>
          {output.language && (
            <span className="text-muted-foreground"> · lang={output.language}</span>
          )}
          {output.pages && (
            <span className="text-muted-foreground"> · {output.pages.length} page(s)</span>
          )}
        </div>
        {output.extractor.agentRun && (
          <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
            <div>model: {output.extractor.agentRun.modelId}</div>
            <div>
              cost: ${(output.extractor.agentRun.costUsd ?? 0).toFixed(4)} ·
              tokens: in {output.extractor.agentRun.tokenSpend?.input ?? 0} /
              out {output.extractor.agentRun.tokenSpend?.output ?? 0} ·
              attempts: {output.extractor.agentRun.attempts ?? 1}
            </div>
          </div>
        )}
      </header>

      {output.outline && output.outline.length > 0 && (
        <section className="rounded border border-border p-3 bg-card">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Outline
          </div>
          <ul className="space-y-0.5">
            {output.outline.map((entry, idx) => (
              <li
                key={idx}
                className="font-mono text-xs"
                style={{ paddingLeft: `${(entry.level - 1) * 12}px` }}
              >
                <span className="text-muted-foreground">L{entry.level}</span>{' '}
                {entry.text}
                {entry.pageIndex !== undefined && (
                  <span className="text-muted-foreground"> (p{entry.pageIndex + 1})</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded border border-border bg-card">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Text {truncated && !showFullText && `(first ${TEXT_PREVIEW} chars)`}
          </span>
          {truncated && (
            <button
              type="button"
              onClick={() => setShowFullText(!showFullText)}
              className="text-xs text-foreground hover:underline"
            >
              {showFullText ? 'Collapse' : `Show full (${output.text.length} chars)`}
            </button>
          )}
        </div>
        <pre className="text-xs font-mono whitespace-pre-wrap break-words p-3 max-h-[60vh] overflow-auto">
          {visibleText}
        </pre>
      </section>

      {output.pages && output.pages.length > 0 && (
        <section className="rounded border border-border bg-card">
          <div className="px-3 py-2 border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            Pages ({output.pages.length})
          </div>
          <ul className="divide-y divide-border">
            {output.pages.map((p) => (
              <li key={p.index} className="px-3 py-2 text-xs">
                <span className="font-mono text-muted-foreground">p{p.index + 1}</span>
                <span className="text-muted-foreground"> · {p.text.length} chars</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

// ── JsonYamlContent ───────────────────────────────────────────────────────────

interface JsonYamlContentProps {
  content: string;
  language: 'json' | 'yaml';
}

const JsonYamlContent: React.FC<JsonYamlContentProps> = ({
  content,
  language,
}) => {
  const [collapsedKeys, setCollapsedKeys] = useState<Set<number>>(new Set());

  // For JSON we split on top-level keys and allow collapsing each section.
  // For YAML we render it as a single highlighted block.
  if (language === 'yaml') {
    return (
      <div className="flex-1 overflow-auto">
        <SyntaxHighlighter
          language="yaml"
          style={claudeSyntaxTheme}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            background: 'transparent',
            fontSize: '0.8rem',
          }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    );
  }

  // JSON: attempt to parse and render each top-level key as collapsible.
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // Fall back to plain highlighting if parse fails.
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return (
      <div className="flex-1 overflow-auto">
        <SyntaxHighlighter
          language="json"
          style={claudeSyntaxTheme}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            background: 'transparent',
            fontSize: '0.8rem',
          }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    );
  }

  const entries = Object.entries(parsed);

  const toggleKey = (idx: number) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-auto p-2 space-y-1">
      {entries.map(([key, value], idx) => {
        const isCollapsed = collapsedKeys.has(idx);
        const snippet = JSON.stringify(value, null, 2);
        return (
          <div key={key} className="rounded border border-border">
            <button
              type="button"
              onClick={() => toggleKey(idx)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/50 transition-colors"
            >
              <span className="text-xs font-mono font-semibold text-foreground">
                {isCollapsed ? '▶' : '▼'}
              </span>
              <span className="text-xs font-mono text-amber-400">&quot;{key}&quot;</span>
            </button>
            {!isCollapsed && (
              <div className="border-t border-border">
                <SyntaxHighlighter
                  language="json"
                  style={claudeSyntaxTheme}
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    background: 'transparent',
                    fontSize: '0.75rem',
                  }}
                >
                  {snippet}
                </SyntaxHighlighter>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── ArtifactInspector ─────────────────────────────────────────────────────────

export const ArtifactInspector: React.FC = () => {
  const { state, loadArtifacts } = useFactoryPipeline();
  const { selectedStepId, artifacts, runId } = state;

  const [selectedArtifactIndex, setSelectedArtifactIndex] = useState<
    number | null
  >(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  const stepArtifacts: ArtifactEntry[] = selectedStepId
    ? (artifacts.get(selectedStepId) ?? [])
    : [];

  // Load the artifact list whenever the selected step changes.
  useEffect(() => {
    if (!selectedStepId || !runId) return;

    setSelectedArtifactIndex(null);
    setArtifactContent(null);

    loadArtifacts(selectedStepId).catch((err) => {
      console.error('[ArtifactInspector] loadArtifacts failed:', err);
    });
  }, [selectedStepId, runId, loadArtifacts]);

  // Read file content whenever the selected artifact index changes.
  const handleSelectArtifact = useCallback(
    async (index: number) => {
      setSelectedArtifactIndex(index);
      const entry = stepArtifacts[index];
      if (!entry) return;

      setContentLoading(true);
      setArtifactContent(null);
      try {
        const text = await readArtifactContent(entry.path);
        setArtifactContent(text);
      } catch (err) {
        console.error('[ArtifactInspector] readArtifactContent failed:', err);
        setArtifactContent(null);
      } finally {
        setContentLoading(false);
      }
    },
    [stepArtifacts],
  );

  // ── No step selected ───────────────────────────────────────────────────────

  if (!selectedStepId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Select a stage to view artifacts
      </div>
    );
  }

  // ── Step selected but no artifacts ────────────────────────────────────────

  if (stepArtifacts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No artifacts for this stage
      </div>
    );
  }

  // ── Main layout: sidebar + content ────────────────────────────────────────

  const selectedEntry =
    selectedArtifactIndex !== null
      ? stepArtifacts[selectedArtifactIndex]
      : null;

  return (
    <div className="flex h-full overflow-hidden">
      <ArtifactSidebar
        artifacts={stepArtifacts}
        selectedIndex={selectedArtifactIndex}
        onSelect={handleSelectArtifact}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedEntry ? (
          <ArtifactContent
            artifact={selectedEntry}
            content={artifactContent}
            loading={contentLoading}
          />
        ) : (
          <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
};
