/**
 * Factory — top-level nav entry (spec 108).
 *
 * Shell for the Factory tabs. Overview, Upstreams, Adapters, Contracts, and
 * Processes live as nested routes.
 */

import { NavLink, Outlet } from "react-router";
import { requireUser } from "../lib/auth.server";

export async function loader({ request }: { request: Request }) {
  await requireUser(request);
  return {};
}

const TABS = [
  { to: "/app/factory", label: "Overview", end: true },
  { to: "/app/factory/upstreams", label: "Upstreams", end: false },
  { to: "/app/factory/runs", label: "Runs", end: false },
  { to: "/app/factory/adapters", label: "Adapters", end: false },
  { to: "/app/factory/contracts", label: "Contracts", end: false },
  { to: "/app/factory/processes", label: "Processes", end: false },
];

export default function Factory() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Factory
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Governed delivery engine. Adapters, contracts, and processes that
          projects are run through.
        </p>
      </header>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
