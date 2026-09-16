import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Download, Search } from "lucide-react";
import {
  DOMAIN_COLORS,
  registry,
  specs,
  uniqueValues,
  type SpecRow,
} from "../lib/spec-registry";

const STATUS_BADGE: Record<string, string> = {
  approved: "text-green-400 border-green-500/30 bg-green-500/10",
  superseded: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  draft: "text-blue-400 border-blue-500/30 bg-blue-500/10",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
        STATUS_BADGE[status] ?? "text-muted-foreground border-border/40 bg-muted/30"
      }`}
    >
      {status}
    </span>
  );
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RegistryTable() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [domain, setDomain] = useState("");
  const [kind, setKind] = useState("");
  const [impl, setImpl] = useState("");
  const [tag, setTag] = useState("");

  const statuses = uniqueValues("status");
  const domains = uniqueValues("domain");
  const kinds = uniqueValues("kind");
  const impls = uniqueValues("implementation");

  const tagCloud = useMemo(() => {
    const freq = new Map<string, number>();
    for (const s of specs) for (const t of s.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return specs.filter((s) => {
      if (status && s.status !== status) return false;
      if (domain && s.domain !== domain) return false;
      if (kind && s.kind !== kind) return false;
      if (impl && s.implementation !== impl) return false;
      if (tag && !s.tags.includes(tag)) return false;
      if (q && !(`${s.id} ${s.title} ${s.summary}`.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [query, status, domain, kind, impl, tag]);

  const maxTag = tagCloud[0]?.[1] ?? 1;

  return (
    <div>
      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total" value={registry.total} />
        <Kpi label="Approved" value={registry.counts.status.approved ?? 0} accent />
        <Kpi
          label="Implemented"
          value={registry.counts.implementation.complete ?? 0}
          accent
        />
        <Kpi label="Superseded" value={registry.counts.status.superseded ?? 0} />
      </div>

      {/* Search + facets */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by id, title, or summary..."
            className="w-full rounded-md border border-border/60 bg-card py-2 pl-9 pr-3 font-mono text-sm outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Facet label="Status" value={status} setValue={setStatus} options={statuses} />
          <Facet label="Domain" value={domain} setValue={setDomain} options={domains} />
          <Facet label="Kind" value={kind} setValue={setKind} options={kinds} />
          <Facet label="Implementation" value={impl} setValue={setImpl} options={impls} />
        </div>
      </div>

      {/* Tag cloud */}
      <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-border/40 bg-card/40 p-4">
        {tagCloud.map(([t, n]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTag(tag === t ? "" : t)}
            style={{ fontSize: `${0.7 + (n / maxTag) * 0.6}rem` }}
            className={`font-mono transition-colors ${
              tag === t
                ? "text-primary text-glow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
            <sup className="ml-0.5 text-[9px] text-muted-foreground/60">{n}</sup>
          </button>
        ))}
      </div>

      {/* Result bar */}
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">
          Showing {filtered.length} of {registry.total} specs
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              download("oap-specs.json", JSON.stringify(filtered, null, 2), "application/json")
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 font-mono text-xs text-muted-foreground hover:text-primary"
          >
            <Download className="h-3 w-3" /> JSON
          </button>
          <button
            type="button"
            onClick={() => download("oap-specs.csv", toCsv(filtered), "text/csv")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 font-mono text-xs text-muted-foreground hover:text-primary"
          >
            <Download className="h-3 w-3" /> CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-muted/30 text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Impl</th>
              <th className="px-3 py-2 font-medium">Domain</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr
                key={s.id}
                className="border-b border-border/20 transition-colors hover:bg-accent/30"
              >
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {s.num}
                </td>
                <td className="px-3 py-2">
                  <Link to={`/registry/${s.id}`} className="hover:text-primary">
                    {s.title}
                  </Link>
                  <div className="font-mono text-[10px] text-muted-foreground/60">
                    {s.id}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {s.implementation}
                </td>
                <td className="px-3 py-2">
                  <span
                    className="inline-flex items-center gap-1 font-mono text-[11px]"
                    style={{ color: DOMAIN_COLORS[s.domain] ?? DOMAIN_COLORS.unknown }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: DOMAIN_COLORS[s.domain] ?? DOMAIN_COLORS.unknown }}
                    />
                    {s.domain}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {s.kind}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {s.created}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className={`font-mono text-2xl font-bold ${accent ? "text-primary" : ""}`}>
        {value}
      </div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function Facet({
  label,
  value,
  setValue,
  options,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className={`rounded-md border bg-card px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary/50 ${
        value ? "border-primary/40 text-primary" : "border-border/60 text-muted-foreground"
      }`}
    >
      <option value="">{label}: all</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function toCsv(rows: SpecRow[]): string {
  const header = ["id", "title", "status", "implementation", "domain", "kind", "created"];
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.id, r.title, r.status, r.implementation, r.domain, r.kind, r.created]
        .map(escape)
        .join(",")
    );
  }
  return lines.join("\n");
}
