import { NavLink, Outlet } from "react-router";
import { BarChart3, Network, Table2 } from "lucide-react";
import { registry } from "../lib/spec-registry";

export function meta() {
  return [
    { title: "Spec Registry: Open Agentic Platform" },
    {
      name: "description",
      content:
        "The canonical spec-spine registry: browse, visualise, and analyse the compiled OAP spec corpus. Table, relationship graph, and governance dashboard.",
    },
  ];
}

const TABS = [
  { to: "/registry", end: true, label: "Table", icon: Table2 },
  { to: "/registry/graph", end: false, label: "Graph", icon: Network },
  { to: "/registry/dashboard", end: false, label: "Dashboard", icon: BarChart3 },
];

export default function RegistryLayout() {
  return (
    <div className="container mx-auto max-w-6xl px-4 py-12">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="pulse-dot" />
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Spec Registry
            </span>
          </div>
          <h1 className="font-mono text-3xl font-bold tracking-tight">
            {registry.total} specifications. One registry.
          </h1>
        </div>
        <nav className="flex gap-1 rounded-lg border border-border/60 bg-card p-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-xs transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
