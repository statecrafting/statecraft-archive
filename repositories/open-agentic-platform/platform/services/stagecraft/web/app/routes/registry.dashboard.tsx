import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ClientOnly } from "../components/client-only";
import { DOMAIN_COLORS, registry } from "../lib/spec-registry";

const TEAL = "oklch(0.75 0.15 195)";
const PIE_PALETTE = [
  "oklch(0.75 0.15 195)",
  "oklch(0.65 0.12 195)",
  "oklch(0.7 0.16 300)",
  "oklch(0.75 0.15 60)",
  "oklch(0.72 0.16 150)",
];

const TOOLTIP_STYLE = {
  background: "oklch(0.16 0.01 260)",
  border: "1px solid oklch(0.3 0.02 260)",
  borderRadius: "6px",
  fontSize: "12px",
  fontFamily: "monospace",
};

function toData(rec: Record<string, number>) {
  return Object.entries(rec)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export default function RegistryDashboard() {
  const { counts, total } = registry;
  const domainData = toData(counts.domain);
  const statusData = toData(counts.status);
  const implData = toData(counts.implementation);
  const kindData = toData(counts.kind).slice(0, 10);

  const approved = counts.status.approved ?? 0;
  const implemented = counts.implementation.complete ?? 0;

  return (
    <div>
      <h2 className="mb-6 font-mono text-lg text-muted-foreground">
        Governance health at a glance
      </h2>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total specs" value={total} />
        <Kpi label="Approved" value={approved} sub={`${Math.round((approved / total) * 100)}%`} accent />
        <Kpi label="Implemented" value={implemented} sub={`${Math.round((implemented / total) * 100)}%`} accent />
        <Kpi label="Superseded" value={counts.status.superseded ?? 0} />
      </div>

      <ClientOnly
        fallback={
          <div className="flex h-64 items-center justify-center rounded-lg border border-border/60 bg-card/30 font-mono text-xs text-muted-foreground">
            Loading charts...
          </div>
        }
      >
        {() => (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Specs by domain">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={domainData} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.01 260 / 0.4)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "oklch(0.6 0.02 260)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "oklch(0.6 0.02 260)" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "oklch(0.5 0.1 195 / 0.08)" }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {domainData.map((d) => (
                      <Cell key={d.name} fill={DOMAIN_COLORS[d.name] ?? DOMAIN_COLORS.unknown} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Status distribution">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    label={{ fontSize: 11, fill: "oklch(0.7 0.02 260)" }}
                  >
                    {statusData.map((d, i) => (
                      <Cell key={d.name} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Implementation state">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={implData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={90}
                    paddingAngle={2}
                    label={{ fontSize: 11, fill: "oklch(0.7 0.02 260)" }}
                  >
                    {implData.map((d, i) => (
                      <Cell key={d.name} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Top spec kinds">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={kindData}
                  layout="vertical"
                  margin={{ top: 4, right: 8, bottom: 4, left: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.01 260 / 0.4)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "oklch(0.6 0.02 260)" }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={{ fontSize: 10, fill: "oklch(0.6 0.02 260)" }}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "oklch(0.5 0.1 195 / 0.08)" }} />
                  <Bar dataKey="value" fill={TEAL} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>
        )}
      </ClientOnly>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className={`font-mono text-2xl font-bold ${accent ? "text-primary" : ""}`}>
        {value}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {sub && <span className="font-mono text-[11px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <h3 className="mb-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}
