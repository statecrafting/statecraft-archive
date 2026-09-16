import { Outlet, NavLink, useOutletContext } from "react-router";

type ProjectCtx = {
  project: { id: string; name: string; slug: string };
};

export default function SettingsLayout() {
  const { project } = useOutletContext<ProjectCtx>();
  const base = `/app/project/${project.id}/settings`;

  const nav = [
    { to: base, label: "General", end: true },
    { to: `${base}/repos`, label: "Repositories", end: false },
    { to: `${base}/connectors`, label: "Connectors", end: false },
    { to: `${base}/github-pat`, label: "GitHub PAT", end: false },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
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
