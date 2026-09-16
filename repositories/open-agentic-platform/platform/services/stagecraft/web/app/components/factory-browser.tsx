import { Link } from "react-router";
import type { FactoryResourceSummary } from "../lib/factory-api.server";
import { ArtifactBodyViewer } from "./artifact-body-viewer";

// ---------------------------------------------------------------------------
// Spec 108 Phase 4 — shared list+detail browser used by the adapter, contract
// and process tabs. Navigation is URL-driven (?name=<name>) so detail state
// survives refreshes and the browser back button works.
// ---------------------------------------------------------------------------

export type FactoryBrowserDetail = {
  name: string;
  version: string;
  sourceSha: string;
  syncedAt: string;
  body: unknown;
};

type Props = {
  items: FactoryResourceSummary[];
  selected: FactoryBrowserDetail | null;
  selectedName: string | null;
  resourceKind: "adapter" | "contract" | "process";
  bodyLabel: string;
  emptyCopy: {
    title: string;
    description: string;
  };
  loadError: string | null;
};

export function FactoryBrowser({
  items,
  selected,
  selectedName,
  resourceKind,
  bodyLabel,
  emptyCopy,
  loadError,
}: Props) {
  if (items.length === 0) {
    return <EmptyState title={emptyCopy.title} description={emptyCopy.description} />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4">
      <ResourceList
        items={items}
        selectedName={selectedName}
        resourceKind={resourceKind}
      />
      <div className="min-w-0">
        {loadError ? (
          <DetailError name={selectedName} message={loadError} />
        ) : selected ? (
          <DetailPanel detail={selected} bodyLabel={bodyLabel} />
        ) : (
          <SelectPrompt resourceKind={resourceKind} />
        )}
      </div>
    </div>
  );
}

function ResourceList({
  items,
  selectedName,
  resourceKind,
}: {
  items: FactoryResourceSummary[];
  selectedName: string | null;
  resourceKind: Props["resourceKind"];
}) {
  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      {items.map((item) => {
        const isSelected = item.name === selectedName;
        return (
          <li key={item.name}>
            <Link
              to={`?name=${encodeURIComponent(item.name)}`}
              replace
              className={`block px-4 py-3 text-sm transition-colors ${
                isSelected
                  ? "bg-indigo-50 dark:bg-indigo-900/20"
                  : "hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
              aria-current={isSelected ? "true" : undefined}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={`font-mono font-medium truncate ${
                    isSelected
                      ? "text-indigo-700 dark:text-indigo-300"
                      : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  {item.name}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  {item.version.slice(0, 12)}
                </span>
              </div>
              <div className="mt-1 flex gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  sha{" "}
                  <code className="font-mono">{item.sourceSha.slice(0, 7)}</code>
                </span>
                <span>{new Date(item.syncedAt).toLocaleString()}</span>
              </div>
            </Link>
          </li>
        );
      })}
      <li className="px-4 py-2 text-[11px] text-gray-400 dark:text-gray-500">
        {items.length} {resourceKind}
        {items.length === 1 ? "" : "s"}
      </li>
    </ul>
  );
}

function DetailPanel({
  detail,
  bodyLabel,
}: {
  detail: FactoryBrowserDetail;
  bodyLabel: string;
}) {
  return (
    <div className="max-h-[80vh]">
      <ArtifactBodyViewer
        artifact={{
          name: detail.name,
          version: detail.version,
          sourceSha: detail.sourceSha,
          syncedAt: detail.syncedAt,
          body: detail.body,
        }}
        label={bodyLabel}
      />
    </div>
  );
}

function SelectPrompt({ resourceKind }: { resourceKind: Props["resourceKind"] }) {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-6 py-12 text-sm text-gray-500 dark:text-gray-400">
      Select {resourceKind === "adapter" ? "an adapter" : `a ${resourceKind}`}{" "}
      to inspect its {resourceKind === "adapter"
        ? "manifest"
        : resourceKind === "contract"
          ? "schema"
          : "definition"}.
    </div>
  );
}

function DetailError({
  name,
  message,
}: {
  name: string | null;
  message: string;
}) {
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
      <div className="font-medium">
        Failed to load{name ? ` "${name}"` : " detail"}
      </div>
      <div className="mt-1 font-mono text-[11px] break-all">{message}</div>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-6 py-10 text-center">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {description}
      </p>
      <Link
        to="/app/factory"
        className="mt-4 inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800"
      >
        Go to Overview to run a sync
      </Link>
    </div>
  );
}
