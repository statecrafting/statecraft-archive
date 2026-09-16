import { useLoaderData, Link, useFetcher, useNavigate, useSearchParams } from "react-router";
import { useState, useMemo } from "react";
import { requireUser } from "../lib/auth.server";
import { listProjects, deleteProject } from "../lib/projects-api.server";
import {
  CloneProjectDialog,
  type CloneSourceProject,
} from "../components/CloneProjectDialog";

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  category?: string;
  createdAt: string;
  updatedAt?: string;
  // Spec 113 §FR-007 — `canClone` is `true` iff the source project has a
  // primary `project_repos` row. Hides the Clone affordance for legacy
  // projects without a repo binding.
  canClone: boolean;
  // Spec 113 §FR-009 — used to pre-fill the dialog's `repoName` field with
  // `<sourceRepoName>-clone`.
  primaryRepoName: string | null;
};

type LoaderData = {
  user: Awaited<ReturnType<typeof requireUser>>;
  projects: ProjectRow[];
  destinationGithubOrgLogin: string | null;
};

export async function loader({ request }: { request: Request }): Promise<LoaderData> {
  const user = await requireUser(request);

  let projects: ProjectRow[] = [];
  let destinationGithubOrgLogin: string | null = null;
  try {
    const res = await listProjects(request);
    destinationGithubOrgLogin = res.destinationGithubOrgLogin;
    projects = res.projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      createdAt:
        typeof p.createdAt === "string"
          ? p.createdAt
          : new Date(p.createdAt as unknown as string).toISOString(),
      updatedAt:
        typeof p.updatedAt === "string"
          ? p.updatedAt
          : new Date(p.updatedAt as unknown as string).toISOString(),
      canClone: Boolean(p.hasPrimaryRepo),
      primaryRepoName: p.primaryRepoName ?? null,
    }));
  } catch {
    // projects service may not be ready
  }

  return { user, projects, destinationGithubOrgLogin };
}

export async function action({ request }: { request: Request }) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    const id = form.get("projectId") as string;
    await deleteProject(request, id, user.userId);
    return { deleted: id };
  }

  return null;
}

type Tab = "mine" | "shared" | "gallery";

export default function ProjectsIndex() {
  const { projects, destinationGithubOrgLogin } = useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<"grid" | "list">(
    (searchParams.get("view") as "grid" | "list") ?? "list"
  );
  const [tab, setTab] = useState<Tab>("mine");
  const [query, setQuery] = useState("");
  const [cloneSource, setCloneSource] = useState<CloneSourceProject | null>(null);

  const filtered = useMemo(() => {
    if (tab !== "mine") return [] as ProjectRow[];
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
    );
  }, [projects, query, tab]);

  function openClone(p: ProjectRow) {
    if (!p.canClone || !p.primaryRepoName || !destinationGithubOrgLogin) return;
    setCloneSource({
      id: p.id,
      name: p.name,
      slug: p.slug,
      destinationGithubOrgLogin,
      sourceRepoName: p.primaryRepoName,
    });
  }

  const counts = { mine: projects.length, shared: 0, gallery: 0 };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">
            Projects
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage your projects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/app/projects/import"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          >
            <PlusIcon className="w-4 h-4" />
            Import Existing Project
          </Link>
          <Link
            to="/app/projects/new"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          >
            <PlusIcon className="w-4 h-4" />
            Create New Project
          </Link>
        </div>
      </header>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>

      <div className="flex items-center gap-2">
        <TabButton
          active={tab === "mine"}
          onClick={() => setTab("mine")}
          icon={<FolderIcon className="w-3.5 h-3.5" />}
          label="My Projects"
          count={counts.mine}
        />
        <TabButton
          active={tab === "shared"}
          onClick={() => setTab("shared")}
          icon={<UsersIcon className="w-3.5 h-3.5" />}
          label="Shared Projects"
          count={counts.shared}
        />
        <TabButton
          active={tab === "gallery"}
          onClick={() => setTab("gallery")}
          icon={<SparklesIcon className="w-3.5 h-3.5" />}
          label="Gallery"
          count={counts.gallery}
        />
      </div>

      {tab !== "mine" ? (
        <EmptyPanel
          title={tab === "shared" ? "No shared projects" : "Gallery coming soon"}
          hint={
            tab === "shared"
              ? "Projects shared with you by other members will appear here."
              : "A curated gallery of template projects will appear here."
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyPanel
          title={query ? "No matches" : "No projects yet"}
          hint={
            query
              ? "Try a different search term."
              : "Create your first project to get started."
          }
        />
      ) : view === "list" ? (
        <ProjectListRows projects={filtered} onClone={openClone} />
      ) : (
        <ProjectGrid projects={filtered} onClone={openClone} />
      )}

      {cloneSource && (
        <CloneProjectDialog
          source={cloneSource}
          onClose={() => setCloneSource(null)}
          onSubmitted={(outcome) => {
            setCloneSource(null);
            navigate(`/app/project/${outcome.projectId}`);
          }}
        />
      )}
    </div>
  );
}

function ProjectListRows({
  projects,
  onClone,
}: {
  projects: ProjectRow[];
  onClone: (p: ProjectRow) => void;
}) {
  return (
    <ul className="space-y-2">
      {projects.map((p) => (
        <ProjectRow key={p.id} project={p} onClone={() => onClone(p)} />
      ))}
    </ul>
  );
}

function ProjectRow({
  project,
  onClone,
}: {
  project: ProjectRow;
  onClone: () => void;
}) {
  const fetcher = useFetcher();
  const deleting = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "delete";

  return (
    <li
      className={`group flex items-center gap-4 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 hover:border-gray-300 dark:hover:border-gray-700 transition-colors ${
        deleting ? "opacity-50" : ""
      }`}
    >
      <div className="flex-shrink-0 w-14 h-14 rounded-md border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center text-gray-300 dark:text-gray-600">
        <ImageIcon className="w-6 h-6" />
      </div>

      <div className="min-w-0 flex-1">
        <Link
          to={`/app/project/${project.id}`}
          className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {project.name}
        </Link>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <ClockIcon className="w-3 h-3" />
          <span>Updated {formatRelativeTime(project.updatedAt ?? project.createdAt)}</span>
        </div>
        {project.description && (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 line-clamp-1">
            {project.description}
          </p>
        )}
      </div>

      {project.category && (
        <span className="flex-shrink-0 inline-flex items-center rounded-full bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
          {project.category}
        </span>
      )}

      <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {project.canClone && (
          <IconButton label="Clone" onClick={onClone}>
            <CopyIcon className="w-4 h-4" />
          </IconButton>
        )}
        <Link
          to={`/app/project/${project.id}/settings`}
          aria-label="Edit"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
        >
          <PencilIcon className="w-4 h-4" />
        </Link>
        <fetcher.Form
          method="post"
          onSubmit={(e) => {
            if (!confirm(`Delete project "${project.name}"?`)) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="projectId" value={project.id} />
          <button
            type="submit"
            aria-label="Delete"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-red-500 text-white hover:bg-red-600"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </fetcher.Form>
      </div>
    </li>
  );
}

function ProjectGrid({
  projects,
  onClone,
}: {
  projects: ProjectRow[];
  onClone: (p: ProjectRow) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {projects.map((p) => (
        // Spec 113 §FR-006 — grid card grows row affordances. The card
        // itself remains a Link to the detail page; the Clone button is
        // a sibling overlay that stops propagation so the click does not
        // navigate.
        <div
          key={p.id}
          className="group relative block border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900/60 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
        >
          <Link
            to={`/app/project/${p.id}`}
            className="block p-4"
          >
            <div className="aspect-video rounded-md border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center text-gray-300 dark:text-gray-600 mb-3">
              <ImageIcon className="w-8 h-8" />
            </div>
            <h3 className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
              {p.name}
            </h3>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <ClockIcon className="w-3 h-3" />
              <span>Updated {formatRelativeTime(p.updatedAt ?? p.createdAt)}</span>
            </div>
            {p.description && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                {p.description}
              </p>
            )}
          </Link>
          {p.canClone && (
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <IconButton
                label="Clone"
                onClick={() => onClone(p)}
              >
                <CopyIcon className="w-4 h-4" />
              </IconButton>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
          : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      }`}
    >
      {icon}
      <span>{label}</span>
      <span
        className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-semibold ${
          active
            ? "bg-gray-700 text-gray-100 dark:bg-gray-700 dark:text-gray-100"
            : "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: "grid" | "list";
  onChange: (v: "grid" | "list") => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        type="button"
        onClick={() => onChange("grid")}
        aria-label="Grid view"
        className={`px-2.5 py-2 text-sm ${
          view === "grid"
            ? "bg-teal-500 text-white"
            : "bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
        }`}
      >
        <GridIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-label="List view"
        className={`px-2.5 py-2 text-sm ${
          view === "list"
            ? "bg-teal-500 text-white"
            : "bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
        }`}
      >
        <ListIcon className="w-4 h-4" />
      </button>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
    >
      {children}
    </button>
  );
}

function EmptyPanel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg px-6 py-14 text-center">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{hint}</p>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);
  const diffMo = Math.round(diffDay / 30);
  const diffYr = Math.round(diffDay / 365);

  if (diffSec < 45) return "just now";
  if (diffMin < 60) return `about ${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  if (diffHr < 24) return `about ${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  if (diffDay < 30) return `about ${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  if (diffMo < 12) return `about ${diffMo} month${diffMo === 1 ? "" : "s"} ago`;
  return `about ${diffYr} year${diffYr === 1 ? "" : "s"} ago`;
}

// —————— Icons ——————

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
    </svg>
  );
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zm0 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-4a4 4 0 11-8 0 4 4 0 018 0zm6 0a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.5 5.5L21 9l-5.5 2.5L13 17l-2.5-5.5L5 9l5.5-2.5L13 1z" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
    </svg>
  );
}
