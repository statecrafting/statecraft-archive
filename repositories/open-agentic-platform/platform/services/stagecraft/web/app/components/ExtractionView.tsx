// Spec 143 §12 FU-017 typed view leg — typed `ExtractionView<Kind>`
// discriminated-union over the five extractor kinds registered in
// `api/knowledge/extractors/dispatch.ts`. Replaces the FU-017 quick-win
// `<pre class="whitespace-pre-wrap">` + raw-JSON-toggle pair on the
// knowledge object detail page.
//
// Per-kind panels read structured fields from `extractionOutput`
// (validated by `api/knowledge/extractionOutput.ts`) instead of dumping
// the whole payload. Unknown kinds (e.g. future agent variants without
// a dedicated panel yet) fall back to the generic view, which is also
// the shape the deterministic-text panel uses.
//
// The Zod-validated contract (spec 115 FR-016) guarantees `text`,
// `metadata`, and `extractor.{kind, version}`. `outline`, `pages`,
// `language`, and `agentRun` are optional and the panels treat them as
// such.

import { useState } from "react";

type ExtractionOutput = {
  text: string;
  pages?: Array<{ index: number; text: string }>;
  language?: string;
  outline?: Array<{ level: number; text: string; pageIndex?: number }>;
  metadata: Record<string, unknown>;
  extractor: {
    kind: string;
    version: string;
    agentRun?: {
      modelId: string;
      durationMs: number;
      costUsd: number;
      attempts: number;
    };
  };
};

type ExtractionViewProps = {
  output: ExtractionOutput;
  latestRunDurationMs?: number;
};

const TEXT_COLLAPSE_THRESHOLD = 5000;

export function ExtractionView({ output, latestRunDurationMs }: ExtractionViewProps) {
  const kind = output.extractor.kind;

  return (
    <section className="space-y-4">
      <ExtractionHeader output={output} latestRunDurationMs={latestRunDurationMs} />
      <ExtractionMetadata output={output} />
      {output.outline && output.outline.length > 0 && (
        <ExtractionOutline outline={output.outline} />
      )}
      <ExtractionText text={output.text} kind={kind} />
      <ExtractionRawJson output={output} />
    </section>
  );
}

function ExtractionHeader({
  output,
  latestRunDurationMs,
}: {
  output: ExtractionOutput;
  latestRunDurationMs?: number;
}) {
  const { kind, version, agentRun } = output.extractor;
  return (
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-900 dark:text-gray-100">
        Extraction Output
      </h3>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        <code className="font-mono">{kind}</code>
        <span className="mx-1">v{version}</span>
        {latestRunDurationMs != null && <span>· {latestRunDurationMs} ms</span>}
        {agentRun?.modelId && (
          <>
            {" "}via <code className="font-mono">{agentRun.modelId}</code>
            {agentRun.costUsd != null && (
              <> (${agentRun.costUsd.toFixed(4)})</>
            )}
          </>
        )}
      </span>
    </header>
  );
}

function ExtractionMetadata({ output }: { output: ExtractionOutput }) {
  const kind = output.extractor.kind;
  const meta = output.metadata;
  const items: Array<[string, string]> = [];

  if (output.language) items.push(["language", output.language]);

  if (kind === "deterministic-text") {
    if (typeof meta.lineCount === "number") items.push(["lines", String(meta.lineCount)]);
    if (typeof meta.bytesDecoded === "number") items.push(["bytes", String(meta.bytesDecoded)]);
    if (typeof meta.declaredMime === "string") items.push(["mime", meta.declaredMime]);
  } else if (kind === "deterministic-pdf-embedded") {
    if (typeof meta.pageCount === "number") items.push(["pages", String(meta.pageCount)]);
    if (output.pages?.length) items.push(["pages w/ text", String(output.pages.length)]);
  } else if (kind === "deterministic-docx") {
    if (typeof meta.wordCount === "number") items.push(["words", String(meta.wordCount)]);
    if (Array.isArray(meta.mammothMessages)) {
      items.push(["mammoth messages", String(meta.mammothMessages.length)]);
    }
  } else if (kind === "agent-pdf-vision" || kind === "agent-image-vision") {
    if (output.pages?.length) items.push(["pages", String(output.pages.length)]);
  }

  if (items.length === 0) return null;

  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {label}
          </dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExtractionOutline({
  outline,
}: {
  outline: Array<{ level: number; text: string; pageIndex?: number }>;
}) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
        Outline ({outline.length})
      </summary>
      <ul className="mt-2 space-y-1">
        {outline.map((entry, i) => (
          <li
            key={i}
            className="text-sm text-gray-800 dark:text-gray-200"
            style={{ paddingLeft: `${Math.max(0, entry.level - 1) * 16}px` }}
          >
            <span className="text-gray-400 dark:text-gray-500 font-mono text-[10px] mr-2">
              h{entry.level}
            </span>
            {entry.text}
            {entry.pageIndex != null && (
              <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500">
                p.{entry.pageIndex}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ExtractionText({ text, kind }: { text: string; kind: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > TEXT_COLLAPSE_THRESHOLD;
  const visible = !isLong || expanded ? text : `${text.slice(0, TEXT_COLLAPSE_THRESHOLD)}…`;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Text
        </h4>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {text.length.toLocaleString()} chars · {kind}
        </span>
      </div>
      <pre className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-xs text-gray-700 dark:text-gray-300 overflow-auto max-h-[32rem] whitespace-pre-wrap break-words">
        {visible}
      </pre>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {expanded
            ? "Show less"
            : `Show all ${text.length.toLocaleString()} chars`}
        </button>
      )}
    </div>
  );
}

function ExtractionRawJson({ output }: { output: ExtractionOutput }) {
  return (
    <details className="text-xs text-gray-500 dark:text-gray-400">
      <summary className="cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300">
        Raw extraction payload
      </summary>
      <pre className="mt-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-xs text-gray-700 dark:text-gray-300 overflow-auto max-h-64">
        {JSON.stringify(output, null, 2)}
      </pre>
    </details>
  );
}
