// Spec 164 — Development tab (lifecycle-state board).
//
// Read-shaped surface (FR-007 / SC-005): cards are not drag-droppable.
// Column placement is driven entirely by the spec's frontmatter
// (`status:` + `implementation:`) loaded through the same spec-registry
// API surface that backs spec 163's Requirements view.
//
// Execution evidence overlays (factory runs, governance certificates,
// coupling-gate fires) land in Phase 3. This phase wires the columns,
// the lanes, and the cluster-card projection (when spec 163's
// `?view=grouped&dim=...` URL parameters are active).

import { Link, useLoaderData, useSearchParams } from "react-router";
import { requireUser } from "../lib/auth.server";
import { listProjectSpecs } from "../lib/spec-registry-api.server";
import {
  getFactoryStatus,
  type PipelineStatusRow,
} from "../lib/project-api.server";
import type { SpecInventory } from "../../../api/specRegistry/types";
import {
  GROUPING_DIMENSIONS,
  type GroupingDimension,
} from "../lib/spec-registry-grouping";
import {
  LIFECYCLE_COLUMNS,
  LIFECYCLE_LANES,
  applyFilters,
  buildBoard,
  buildBoardWithGrouping,
  buildFilterFacets,
  claimedCodePaths,
  hasActiveFilters,
  parseFiltersFromSearchParams,
  type BoardFilters,
  type FilterFacet,
  type LifecycleBoard,
  type LifecycleCard,
  type LifecycleColumnId,
  type LifecycleLaneId,
} from "../lib/spec-registry-board";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  await requireUser(request);
  const inventory = await listProjectSpecs(request, params.projectId);
  // Spec 164 FR-006 — execution-evidence strip. The factory status fetch
  // is best-effort: a missing pipeline (e.g. a freshly-imported project
  // without a factory binding) is the empty-evidence case, NOT an error
  // worth crashing the board over.
  let pipeline: PipelineStatusRow | null = null;
  try {
    const res = await getFactoryStatus(request, params.projectId);
    pipeline = res.pipeline;
  } catch {
    // Swallow — the board renders unevidenced when no pipeline data is
    // available.
  }
  return { projectId: params.projectId, inventory, pipeline };
}

const VIEW_MODES = ["list", "grouped"] as const;
type ViewMode = (typeof VIEW_MODES)[number];

function isViewMode(s: string | null): s is ViewMode {
  return s === "list" || s === "grouped";
}

function isGroupingDimension(s: string | null): s is GroupingDimension {
  return (
    s === "by-category" ||
    s === "by-establishment-chain" ||
    s === "by-supersession-chain"
  );
}

export default function DevelopmentBoard() {
  const { projectId, inventory, pipeline } = useLoaderData() as {
    projectId: string;
    inventory: SpecInventory;
    pipeline: PipelineStatusRow | null;
  };
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const dimParam = searchParams.get("dim");
  const view: ViewMode = isViewMode(viewParam) ? viewParam : "list";
  const dimension: GroupingDimension = isGroupingDimension(dimParam)
    ? dimParam
    : "by-category";

  if (!inventory.registryAvailable || inventory.specs.length === 0) {
    return <EmptyState projectId={projectId} />;
  }

  const filters = parseFiltersFromSearchParams(searchParams);
  const facets = buildFilterFacets(inventory.specs);
  const filtered = applyFilters(inventory.specs, filters);
  const board: LifecycleBoard =
    view === "grouped"
      ? buildBoardWithGrouping(filtered, dimension)
      : buildBoard(filtered);

  return (
    <div className="space-y-6">
      <BoardToolbar
        projectId={projectId}
        view={view}
        dimension={dimension}
        count={inventory.specs.length}
        filteredCount={filtered.length}
        filters={filters}
      />
      <FilterChips
        projectId={projectId}
        view={view}
        dimension={dimension}
        filters={filters}
        facets={facets}
      />
      <ExecutionEvidenceStrip pipeline={pipeline} />
      <BoardColumns board={board} projectId={projectId} />
      <BoardLanes board={board} projectId={projectId} />
      <FootnoteFraming />
    </div>
  );
}

/**
 * Spec 164 FR-006 — execution evidence overlay (project-level).
 *
 * The strip surfaces the project's most recent factory pipeline state
 * and links into the factory runs index. Per-card factory-run /
 * governance-certificate / coupling-gate-fire overlays require a
 * `spec → recent-evidence` map that does not exist yet (no
 * `factory_runs.touchedPaths` column; no certificate-emission projected
 * table). The per-card "claimed paths" badge is the truthful per-spec
 * evidence linkage available today.
 */
function ExecutionEvidenceStrip({
  pipeline,
}: {
  pipeline: PipelineStatusRow | null;
}) {
  return (
    <section
      aria-label="Execution evidence"
      className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 p-3 flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Execution evidence
        </span>
        {pipeline ? (
          <PipelinePill pipeline={pipeline} />
        ) : (
          <span className="text-xs text-gray-500 dark:text-gray-400 italic">
            no factory pipeline recorded for this project yet
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Link
          to="/app/factory/runs"
          className="text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          All factory runs →
        </Link>
        <span
          className="text-[11px] text-gray-400 dark:text-gray-500"
          title="Per-card factory-run / certificate / gate-fire overlays land once spec→run path mapping exists. Today, the per-card 'paths' badge is the truthful linkage available."
        >
          per-card overlays: paths claimed only
        </span>
      </div>
    </section>
  );
}

function PipelinePill({ pipeline }: { pipeline: PipelineStatusRow }) {
  const statusClass = PIPELINE_STATUS_STYLES[pipeline.status] ??
    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium ${statusClass}`}>
        {pipeline.status}
      </span>
      <span className="font-mono text-gray-500 dark:text-gray-400">
        adapter: {pipeline.adapterName}
      </span>
      {pipeline.startedAt && (
        <span className="text-gray-400 dark:text-gray-500">
          started {new Date(pipeline.startedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}

const PIPELINE_STATUS_STYLES: Record<string, string> = {
  active: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  completed:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancelled:
    "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function BoardToolbar({
  projectId,
  view,
  dimension,
  count,
  filteredCount,
  filters,
}: {
  projectId: string;
  view: ViewMode;
  dimension: GroupingDimension;
  count: number;
  filteredCount: number;
  filters: BoardFilters;
}) {
  const base = `/app/project/${projectId}/development`;
  const filterActive = hasActiveFilters(filters);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 pb-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Development
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Lifecycle-state board over{" "}
          {filterActive ? (
            <>
              <span className="font-semibold text-gray-700 dark:text-gray-300">
                {filteredCount}
              </span>{" "}
              of {count} spec{count === 1 ? "" : "s"}
            </>
          ) : (
            <>
              {count} spec{count === 1 ? "" : "s"}
            </>
          )}
          . Cards move as frontmatter changes — there is no drag-drop.
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        <Link
          to={base}
          className={pillClass(view === "list")}
          aria-current={view === "list" ? "page" : undefined}
        >
          Per spec
        </Link>
        {GROUPING_DIMENSIONS.map((d) => (
          <Link
            key={d.value}
            to={`${base}?view=grouped&dim=${d.value}`}
            className={pillClass(view === "grouped" && dimension === d.value)}
            aria-current={
              view === "grouped" && dimension === d.value ? "page" : undefined
            }
          >
            {d.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * FR-008 — filter chips per dimension. URL-driven so filters are
 * shareable, survive reload, and stack with the view/dimension
 * parameters from spec 163.
 *
 * Each chip toggles its dimension by rewriting the active URL — clicking
 * an already-active value clears it.
 */
function FilterChips({
  projectId,
  view,
  dimension,
  filters,
  facets,
}: {
  projectId: string;
  view: ViewMode;
  dimension: GroupingDimension;
  filters: BoardFilters;
  facets: ReturnType<typeof buildFilterFacets>;
}) {
  const anyFacet =
    facets.kinds.length +
      facets.categories.length +
      facets.risks.length +
      facets.owners.length >
    0;
  if (!anyFacet) return null;

  function urlFor(updates: Partial<BoardFilters>): string {
    const next: BoardFilters = { ...filters, ...updates };
    const params = new URLSearchParams();
    if (view === "grouped") {
      params.set("view", "grouped");
      params.set("dim", dimension);
    }
    if (next.kind) params.set("kind", next.kind);
    if (next.category) params.set("category", next.category);
    if (next.risk) params.set("risk", next.risk);
    if (next.owner) params.set("owner", next.owner);
    if (next.withEvidence) params.set("withEvidence", "true");
    const qs = params.toString();
    const base = `/app/project/${projectId}/development`;
    return qs ? `${base}?${qs}` : base;
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Filter
        </span>
        <FacetRow
          label="kind"
          facets={facets.kinds}
          activeValue={filters.kind}
          toUrl={(value) => urlFor({ kind: value })}
        />
        <FacetRow
          label="category"
          facets={facets.categories}
          activeValue={filters.category}
          toUrl={(value) => urlFor({ category: value })}
        />
        <FacetRow
          label="risk"
          facets={facets.risks}
          activeValue={filters.risk}
          toUrl={(value) => urlFor({ risk: value })}
        />
        <FacetRow
          label="owner"
          facets={facets.owners}
          activeValue={filters.owner}
          toUrl={(value) => urlFor({ owner: value })}
        />
        <Link
          to={urlFor({ withEvidence: filters.withEvidence ? undefined : true })}
          className={chipClass(filters.withEvidence === true)}
          title="Keep only specs that claim at least one code path via relationship-graph edges."
        >
          with paths
        </Link>
        {hasActiveFilters(filters) && (
          <Link
            to={urlFor({
              kind: undefined,
              category: undefined,
              risk: undefined,
              owner: undefined,
              withEvidence: undefined,
            })}
            className="text-gray-500 dark:text-gray-400 hover:underline"
          >
            Clear all
          </Link>
        )}
      </div>
    </div>
  );
}

function FacetRow({
  label,
  facets,
  activeValue,
  toUrl,
}: {
  label: string;
  facets: FilterFacet[];
  activeValue?: string;
  toUrl: (value: string | undefined) => string;
}) {
  if (facets.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-gray-400 dark:text-gray-500">{label}:</span>
      {facets.map((f) => {
        const active = activeValue === f.value;
        return (
          <Link
            key={f.value}
            to={toUrl(active ? undefined : f.value)}
            className={chipClass(active)}
            aria-current={active ? "true" : undefined}
          >
            {f.value}
            <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">
              {f.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function chipClass(active: boolean): string {
  return [
    "inline-flex items-center px-2 py-0.5 rounded-md border text-xs transition-colors",
    active
      ? "bg-indigo-600 text-white border-indigo-600"
      : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800",
  ].join(" ");
}

function pillClass(active: boolean): string {
  return [
    "inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium transition-colors border",
    active
      ? "bg-indigo-600 text-white border-indigo-600"
      : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800",
  ].join(" ");
}

function BoardColumns({
  board,
  projectId,
}: {
  board: LifecycleBoard;
  projectId: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
      {LIFECYCLE_COLUMNS.map((col) => (
        <Column
          key={col.id}
          columnId={col.id}
          label={col.label}
          cards={board.columns[col.id]}
          projectId={projectId}
        />
      ))}
    </div>
  );
}

function Column({
  columnId,
  label,
  cards,
  projectId,
}: {
  columnId: LifecycleColumnId;
  label: string;
  cards: LifecycleCard[];
  projectId: string;
}) {
  return (
    <section
      aria-labelledby={`col-${columnId}-heading`}
      className="border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/40 flex flex-col min-h-[240px]"
    >
      <header className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <h3
          id={`col-${columnId}-heading`}
          className={`text-xs font-semibold uppercase tracking-wider ${COLUMN_HEAD_TEXT[columnId]}`}
        >
          {label}
          <span className="ml-2 text-gray-400 dark:text-gray-500 normal-case font-normal">
            {cards.length}
          </span>
        </h3>
      </header>
      <div className="p-2 space-y-2 flex-1">
        {cards.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic px-1 py-2">
            no specs in this state
          </p>
        ) : (
          cards.map((card) => (
            <Card key={card.id} card={card} projectId={projectId} />
          ))
        )}
      </div>
    </section>
  );
}

const COLUMN_HEAD_TEXT: Record<LifecycleColumnId, string> = {
  draft: "text-yellow-700 dark:text-yellow-400",
  approved: "text-green-700 dark:text-green-400",
  "implementation-pending": "text-amber-700 dark:text-amber-400",
  "implementation-in-progress": "text-blue-700 dark:text-blue-400",
  "implementation-complete": "text-emerald-700 dark:text-emerald-400",
};

function BoardLanes({
  board,
  projectId,
}: {
  board: LifecycleBoard;
  projectId: string;
}) {
  const visible = LIFECYCLE_LANES.filter(
    (lane) => board.lanes[lane.id].length > 0,
  );
  if (visible.length === 0) return null;
  return (
    <section
      aria-labelledby="lanes-heading"
      className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3"
    >
      <h3
        id="lanes-heading"
        className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
      >
        Off-flow lanes
      </h3>
      {visible.map((lane) => (
        <Lane
          key={lane.id}
          laneId={lane.id}
          label={lane.label}
          description={lane.description}
          cards={board.lanes[lane.id]}
          projectId={projectId}
        />
      ))}
    </section>
  );
}

function Lane({
  laneId,
  label,
  description,
  cards,
  projectId,
}: {
  laneId: LifecycleLaneId;
  label: string;
  description: string;
  cards: LifecycleCard[];
  projectId: string;
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/40">
      <header className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-baseline gap-2">
          <h4
            className={`text-xs font-semibold uppercase tracking-wider ${LANE_HEAD_TEXT[laneId]}`}
          >
            {label}
          </h4>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {cards.length}
          </span>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
          {description}
        </p>
      </header>
      <div className="p-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {cards.map((card) => (
          <Card key={card.id} card={card} projectId={projectId} />
        ))}
      </div>
    </div>
  );
}

const LANE_HEAD_TEXT: Record<LifecycleLaneId, string> = {
  superseded: "text-gray-600 dark:text-gray-300",
  amended: "text-purple-700 dark:text-purple-300",
};

function Card({
  card,
  projectId,
}: {
  card: LifecycleCard;
  projectId: string;
}) {
  const primary = card.members[0];
  const isCluster = card.kind === "cluster";
  // FR-006 — per-card execution evidence linkage. For a single-spec
  // card this is the count of code paths the spec claims; for a cluster
  // it is the union across members. Clusters that aggregate over many
  // specs show a higher number — that's the intent (more linkage =
  // more potential evidence to correlate when the per-run map ships).
  const pathCount = isCluster
    ? new Set(card.members.flatMap((m) => claimedCodePaths(m))).size
    : claimedCodePaths(primary).length;
  // The cluster card links to the Requirements view filtered into the
  // same projection so the operator can drill into members.
  const target = isCluster
    ? `/app/project/${projectId}/requirements?view=grouped&dim=${clusterDimensionFromId(card.id)}`
    : `/app/project/${projectId}/requirements/${encodeURIComponent(primary.id)}`;

  return (
    <Link
      to={target}
      className="block rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-sm transition-all p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">
          {isCluster
            ? `cluster · ${card.members.length}`
            : primary.id.split("-")[0]}
        </span>
        {primary.hasDecompositionOrigin && !isCluster && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
            title="Derived from Knowledge or xray fingerprint (spec 161)"
          >
            decomp
          </span>
        )}
      </div>
      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
        {card.label}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {isCluster ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
            dominant: {primary.status}
            {primary.implementation && primary.implementation !== "n/a"
              ? ` · ${primary.implementation}`
              : ""}
          </span>
        ) : (
          <>
            {primary.kind && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {primary.kind}
              </span>
            )}
            {primary.categories.map((c) => (
              <span
                key={c}
                className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
              >
                {c}
              </span>
            ))}
          </>
        )}
        {card.placement.lanes.map((lane) => (
          <span
            key={lane}
            className={`text-[10px] px-1.5 py-0.5 rounded ${LANE_BADGE[lane]}`}
            title={`This card also appears in the ${lane} lane.`}
          >
            {lane}
          </span>
        ))}
        {pathCount > 0 && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            title="Code paths claimed via establishes:/extends:/refines:/co_authority: relationship-graph edges (spec 130). Each claimed path is a surface where factory runs, certificates, and coupling-gate fires can be correlated to this spec."
          >
            {pathCount} {pathCount === 1 ? "path" : "paths"}
          </span>
        )}
      </div>
    </Link>
  );
}

const LANE_BADGE: Record<LifecycleLaneId, string> = {
  superseded: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  amended:
    "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
};

/**
 * Cluster ids carry the dimension as a prefix
 * (`by-category:auth`, `by-supersession-chain:042`, etc.). Recover the
 * dimension so the drilldown link routes back into the same projection.
 */
function clusterDimensionFromId(id: string): GroupingDimension {
  if (id.startsWith("by-establishment-chain")) return "by-establishment-chain";
  if (id.startsWith("by-supersession-chain")) return "by-supersession-chain";
  return "by-category";
}

function EmptyState({ projectId: _projectId }: { projectId: string }) {
  return (
    <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-6 py-12 text-center">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        No spec spine yet
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-prose mx-auto">
        This project's requirements have not been decomposed into the spec
        spine. The Development board is a lifecycle-state view over that
        spine, so it stays empty until decomposition emits drafts.
      </p>
      <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
        See{" "}
        <span className="font-mono">specs/165-opc-decomposition-pipeline</span>{" "}
        for the decomposition workflow.
      </p>
    </div>
  );
}

function FootnoteFraming() {
  return (
    <p className="text-[11px] text-gray-400 dark:text-gray-500 italic pt-1 border-t border-gray-100 dark:border-gray-800">
      The board reflects authored intent. Lifecycle changes flow from spec
      frontmatter edits in the project repo, not by interaction here
      (spec 164 FR-007).
    </p>
  );
}
