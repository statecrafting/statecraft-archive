import { Outlet, NavLink, useLoaderData, Link } from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { requireUser } from "../lib/auth.server";
import { getProject, getProjectOpcDeepLink } from "../lib/projects-api.server";
import { OpenInOpcButton } from "../components/OpenInOpcButton";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  await requireUser(request);
  const { project } = await getProject(request, params.projectId);

  // Spec 112 §6.3 — best-effort deep-link fetch so the layout can surface
  // the "Open in OPC" button. Uses the lightweight deep-link endpoint, not
  // the full OPC bundle: the header needs only these two fields, and the
  // full bundle mints a GitHub installation token + loads the org substrate
  // — wasteful here given this loader revalidates across child navigations.
  // A failure (e.g. legacy projects pre-spec-112 with no factory binding)
  // must not break the project page; we render without the button instead.
  let opcDeepLink: string | null = null;
  let opcAdapterName: string | null = null;
  try {
    const dl = await getProjectOpcDeepLink(request, params.projectId);
    opcDeepLink = dl.deepLink;
    opcAdapterName = dl.adapterName;
  } catch {
    // swallow; the rest of the page still loads.
  }
  return { project, opcDeepLink, opcAdapterName };
}

// Spec 112 §6.3 — the data this layout loader fetches (project header +
// Open-in-OPC deep link) is invariant while the user stays within one
// project. Under React Router v7 single-fetch the layout loader would
// otherwise revalidate on every child navigation (Overview ↔ Knowledge ↔
// Requirements ↔ a spec ↔ back), re-hitting the deep-link endpoint each
// hop. Suppress those re-runs; still revalidate when the project changes,
// after a mutation (e.g. a settings rename), or on a same-URL revalidation.
export function shouldRevalidate({
  currentParams,
  nextParams,
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (formMethod && formMethod !== "GET") return true;
  if (currentParams.projectId !== nextParams.projectId) return true;
  if (currentUrl.pathname !== nextUrl.pathname) return false;
  return defaultShouldRevalidate;
}

export default function ProjectLayout() {
  const { project, opcDeepLink, opcAdapterName } = useLoaderData() as {
    project: { id: string; name: string; slug: string; description?: string };
    opcDeepLink: string | null;
    opcAdapterName: string | null;
  };

  const base = `/app/project/${project.id}`;
  const subnav = [
    { to: base, label: "Overview", end: true },
    { to: `${base}/knowledge`, label: "Knowledge", end: false },
    // Spec 163 — Requirements view (read-shaped spec-spine surface).
    { to: `${base}/requirements`, label: "Requirements", end: false },
    { to: `${base}/agents`, label: "Agents", end: false },
    // Spec 164 — "Pipelines" → "Development". The route surfaces the
    // spec-spine lifecycle-state board; the old `/pipelines` URL is
    // preserved by a 308 redirect for one release cycle.
    { to: `${base}/development`, label: "Development", end: false },
    { to: `${base}/deploys`, label: "Deploys", end: false },
    { to: `${base}/settings`, label: "Settings", end: false },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <nav className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            <Link to="/app" className="hover:text-gray-700 dark:hover:text-gray-300">
              Projects
            </Link>
            <span className="mx-1">/</span>
            <span className="text-gray-700 dark:text-gray-300">{project.name}</span>
          </nav>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {project.name}
          </h1>
          {project.description && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {project.description}
            </p>
          )}
          <p className="mt-0.5 text-xs font-mono text-gray-400 dark:text-gray-500">
            {project.slug}
          </p>
        </div>
        {opcDeepLink && (
          <OpenInOpcButton deepLink={opcDeepLink} adapterName={opcAdapterName} />
        )}
      </header>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {subnav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>

      <Outlet context={{ project }} />
    </div>
  );
}
