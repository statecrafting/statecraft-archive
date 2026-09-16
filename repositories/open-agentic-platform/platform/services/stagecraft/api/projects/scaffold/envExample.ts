// Spec 227 Stage 2: plumb user-supplied Base-app config values into a
// scaffolded project's committed `apps/api/.env.example`. The gateway knobs
// (PRIVATE_API_BASE_URL, GATEWAY_TIMEOUT_MS) are born-with baseline env the
// generated app reads via `apps/api/lib/env.ts`; they ship commented-out in the
// template. When the create form supplies a value we uncomment the matching
// line and set it, so the value rides commit #1. Pure string transform (no fs)
// so it is unit-testable; `perRequestScaffold.ts` reads/writes the file.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return `body` with each `overrides` key's line set to `KEY=value`
 * (uncommented). A commented (`# KEY=...`) or bare (`KEY=...`) line is replaced
 * in place; a key with no matching line is appended under a trailing override
 * block. Only keys present in `overrides` are touched, so unset knobs keep the
 * template's commented default.
 */
export function patchEnvExample(
  body: string,
  overrides: Record<string, string>
): string {
  // Defensive: strip CR/LF from every value so one override can never emit more
  // than a single `KEY=value` line (a `\n` in a value would otherwise inject
  // additional env lines). The caller also validates the value server-side.
  const remaining = new Map(
    Object.entries(overrides).map(([k, v]) => [k, v.replace(/[\r\n]/g, "")])
  );
  const lines = body.split("\n").map((line) => {
    for (const [key, value] of remaining) {
      if (new RegExp(`^\\s*#?\\s*${escapeRegExp(key)}=`).test(line)) {
        remaining.delete(key);
        return `${key}=${value}`;
      }
    }
    return line;
  });
  if (remaining.size > 0) {
    lines.push("", "# OAP create-project overrides");
    for (const [key, value] of remaining) lines.push(`${key}=${value}`);
  }
  return lines.join("\n");
}
