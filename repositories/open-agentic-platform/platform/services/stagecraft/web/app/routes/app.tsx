import { Outlet, useLoaderData, NavLink, useRevalidator } from "react-router";
import { useState, useRef, useEffect } from "react";
import { requireUser } from "../lib/auth.server";

interface UserOrg {
  orgId: string;
  orgSlug: string;
  platformRole: "owner" | "admin" | "member";
}

export async function loader({ request }: { request: Request }) {
  const user = await requireUser(request);

  // Fetch available orgs for the user (for org switcher)
  let userOrgs: UserOrg[] = [];
  try {
    const cookie = request.headers.get("Cookie") ?? "";
    const orgsResp = await fetch(
      `${process.env.ENCORE_API_BASE_URL ?? "http://localhost:4000"}/auth/user-orgs`,
      { headers: { Cookie: cookie } }
    );
    if (orgsResp.ok) {
      const data = (await orgsResp.json()) as { orgs: UserOrg[] };
      userOrgs = data.orgs;
    }
  } catch {
    // Non-fatal: org switcher will just not appear
  }

  return { user, userOrgs };
}

const NAV_ITEMS = [
  { to: "/app", label: "Projects", end: true },
  { to: "/app/agents", label: "Agents", end: false },
  { to: "/app/factory", label: "Factory", end: false },
];

function OrgSwitcher({
  currentOrgSlug,
  userOrgs,
}: {
  currentOrgSlug: string;
  userOrgs: UserOrg[];
}) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const revalidator = useRevalidator();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (userOrgs.length <= 1) {
    return (
      <span className="text-xs text-gray-400 dark:text-gray-500">
        {currentOrgSlug}
      </span>
    );
  }

  async function switchOrg(orgId: string) {
    setSwitching(true);
    try {
      const resp = await fetch("/auth/org-switch/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
        credentials: "same-origin",
      });
      if (resp.ok) {
        revalidator.revalidate();
        setOpen(false);
      }
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-2 py-1 rounded transition-colors"
        disabled={switching}
      >
        {currentOrgSlug}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50">
          {userOrgs.map((org) => (
            <button
              key={org.orgId}
              onClick={() => switchOrg(org.orgId)}
              disabled={switching || org.orgSlug === currentOrgSlug}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${
                org.orgSlug === currentOrgSlug
                  ? "font-medium text-indigo-600 dark:text-indigo-400"
                  : "text-gray-700 dark:text-gray-300"
              }`}
            >
              {org.orgSlug}
              <span className="ml-2 text-xs text-gray-400">{org.platformRole}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { user, userOrgs } = useLoaderData() as {
    user: { name: string; email: string; orgSlug?: string };
    userOrgs: UserOrg[];
  };

  return (
    <div className="min-h-full">
      <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <div className="container px-4 mx-auto">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight">
                statecraft
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {user.name}
              </span>
              <OrgSwitcher
                currentOrgSlug={user.orgSlug ?? ""}
                userOrgs={userOrgs}
              />
            </div>
          </div>

          <nav className="flex gap-1 -mb-px">
            {NAV_ITEMS.map((item) => (
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
          </nav>
        </div>
      </header>

      <main className="container px-4 mx-auto py-6">
        <Outlet />
      </main>
    </div>
  );
}
