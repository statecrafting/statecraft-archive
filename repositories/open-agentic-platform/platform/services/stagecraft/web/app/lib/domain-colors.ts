// Domain -> accent color, shared by the registry table, graph, and detail view.
// Kept in its own tiny module so importing it never pulls a data JSON.
export const DOMAIN_COLORS: Record<string, string> = {
  platform: "oklch(0.72 0.15 220)",
  opc: "oklch(0.70 0.16 300)",
  tooling: "oklch(0.75 0.15 60)",
  substrate: "oklch(0.72 0.16 150)",
  unknown: "oklch(0.6 0.02 260)",
};
