/**
 * infra/secrets/catalog.ts (spec 010)
 *
 * The generator/validator over infra/secrets/catalog.toml, the single
 * documented source for the statecraft platform's secret surface. It holds no
 * values; this tool turns it into an example and validates real files against
 * it. Run via the package.json `secrets:*` scripts.
 *
 *   secrets:example    -> rewrite infra/hetzner/.env.example
 *   secrets:validate   -> validate the operator .env against the catalog
 *   secrets:check      -> assert agreement with spec 002's infra.config.json
 *   secret-keys        -> print the secret-classed key names (SOPS regex)
 *   keys               -> print every key name
 *
 * Design decision (spec 010 section 2): the generated example is the
 * infra-local operator example, NOT the root .env.example (spec 002's
 * local-dev ledger doc). The catalog only AGREES WITH the 002 artifacts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

type Provenance =
  | "user-supplied"
  | "generated"
  | "provider-produced"
  | "derived";

interface CatalogKey {
  name: string;
  provenance: Provenance;
  secret: boolean;
  required: boolean;
  group: string;
  consumer: string;
  description: string;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const CATALOG_PATH = resolve(SCRIPT_DIR, "catalog.toml");
const EXAMPLE_PATH = resolve(REPO_ROOT, "infra", "hetzner", ".env.example");
const INFRA_CONFIG_PATH = resolve(REPO_ROOT, "infra.config.json");
const OPERATOR_ENV_PATH = resolve(
  homedir(),
  ".config",
  "statecrafting",
  "infra",
  "hetzner",
  ".env",
);

const PROVENANCE_ORDER: Provenance[] = [
  "user-supplied",
  "generated",
  "provider-produced",
  "derived",
];

const PROVENANCE_TITLE: Record<Provenance, string> = {
  "user-supplied": "User-supplied: the operator provides these.",
  generated: "Generated: minted with crypto/rand or `npm run generate-keys`.",
  "provider-produced":
    "Provider-produced: a provider hands these back (GitHub App, rauthy).",
  derived: "Derived: computed from another value (must equal the formula).",
};

/**
 * A deliberately small TOML reader for THIS catalog's regular shape:
 * top-level scalars and repeated `[[key]]` tables of quoted-string / bool /
 * integer fields, one field per line, no inline comments, no multiline
 * values. It is not a general TOML parser; it parses a file this repo owns and
 * whose structure the generator otherwise validates. Avoids a dependency.
 */
function parseCatalogToml(text: string): { key: Record<string, unknown>[] } {
  const tables: Record<string, unknown>[] = [];
  const top: Record<string, unknown> = {};
  let current: Record<string, unknown> = top;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line === "[[key]]") {
      current = {};
      tables.push(current);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const field = line.slice(0, eq).trim();
    const rawValue = line.slice(eq + 1).trim();
    let value: unknown;
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      value = rawValue.slice(1, -1);
    } else if (rawValue === "true" || rawValue === "false") {
      value = rawValue === "true";
    } else if (/^\d+$/.test(rawValue)) {
      value = Number(rawValue);
    } else {
      value = rawValue;
    }
    current[field] = value;
  }
  return { key: tables };
}

function loadCatalog(): CatalogKey[] {
  const raw = parseCatalogToml(readFileSync(CATALOG_PATH, "utf8"));
  const entries = Array.isArray(raw.key) ? raw.key : [];
  return entries.map((e, i) => {
    const k = e as Record<string, unknown>;
    const name = k.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`catalog.toml: [[key]] #${i} has no name`);
    }
    const provenance = k.provenance as Provenance;
    if (!PROVENANCE_ORDER.includes(provenance)) {
      throw new Error(`catalog.toml: ${name} has invalid provenance`);
    }
    return {
      name,
      provenance,
      secret: k.secret === true,
      required: k.required === true,
      group: typeof k.group === "string" ? k.group : "",
      consumer: typeof k.consumer === "string" ? k.consumer : "",
      description: typeof k.description === "string" ? k.description : "",
    };
  });
}

/**
 * Parse a dotenv file into a map of KEY -> value. Handles multi-line quoted
 * values (the operator .env stores RS256 PEMs as quoted blocks spanning many
 * lines); a continuation line is consumed as part of the value, never parsed
 * as its own KEY= assignment.
 */
function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    i += 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) continue;
    const key = raw.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const rest = raw.slice(eq + 1).replace(/^[ \t]+/, "");
    const q = rest[0];
    if (q === '"' || q === "'") {
      const body = rest.slice(1);
      const close = body.indexOf(q);
      if (close !== -1) {
        out.set(key, body.slice(0, close));
        continue;
      }
      const parts = [body];
      while (i < lines.length) {
        const cont = lines[i];
        i += 1;
        const idx = cont.indexOf(q);
        if (idx === -1) {
          parts.push(cont);
        } else {
          parts.push(cont.slice(0, idx));
          break;
        }
      }
      out.set(key, parts.join("\n"));
    } else {
      out.set(key, rest.trim());
    }
  }
  return out;
}

function renderExample(catalog: CatalogKey[]): string {
  const lines: string[] = [
    "# infra/hetzner/.env.example",
    "#",
    "# GENERATED from infra/secrets/catalog.toml by `npm run secrets:example`.",
    "# Do not edit by hand: edit the catalog and regenerate.",
    "#",
    "# This is the example for the OPERATOR .env at",
    "#   ~/.config/statecrafting/infra/hetzner/.env",
    "# (gitignored). It documents the platform secret surface (spec 010); it is",
    "# NOT the root .env.example, which is spec 002's local-dev ledger doc.",
    "#",
    "# Validate a real .env with `npm run secrets:validate`.",
    "",
  ];
  for (const prov of PROVENANCE_ORDER) {
    const keys = catalog.filter((k) => k.provenance === prov);
    if (keys.length === 0) continue;
    lines.push(
      "# " + "=".repeat(74),
      `# ${PROVENANCE_TITLE[prov]}`,
      "# " + "=".repeat(74),
    );
    for (const k of keys) {
      const meta = [
        `required: ${k.required ? "yes" : "no"}`,
        `consumer: ${k.consumer}`,
      ];
      if (k.group) meta.push(`group: ${k.group} (all-or-nothing)`);
      lines.push("", `# ${k.description}`, `#   ${meta.join(" | ")}`, `${k.name}=`);
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Validate an env map against the catalog. Returns a list of error strings. */
function validateEnv(catalog: CatalogKey[], env: Map<string, string>): string[] {
  const errors: string[] = [];
  const byName = new Map(catalog.map((k) => [k.name, k]));
  const present = (name: string) => (env.get(name) ?? "").length > 0;

  // Standalone required keys.
  for (const k of catalog) {
    if (k.required && k.group === "" && !present(k.name)) {
      errors.push(`missing required key: ${k.name} (${k.consumer})`);
    }
  }

  // Groups: all-or-nothing.
  const groups = new Map<string, CatalogKey[]>();
  for (const k of catalog) {
    if (k.group === "") continue;
    (groups.get(k.group) ?? groups.set(k.group, []).get(k.group)!).push(k);
  }
  for (const [group, members] of groups) {
    const set = members.filter((m) => present(m.name));
    if (set.length > 0 && set.length < members.length) {
      const missing = members
        .filter((m) => m.required && !present(m.name))
        .map((m) => m.name);
      if (missing.length > 0) {
        errors.push(
          `group "${group}" is all-or-nothing but partially set; missing: ${missing.join(", ")}`,
        );
      }
    }
  }

  // Unknown keys.
  for (const name of env.keys()) {
    if (!byName.has(name)) {
      errors.push(`unknown key not in catalog: ${name}`);
    }
  }

  // Derived agreement. Nothing to check today: the two DOMAIN-derived URL keys
  // (APP_BASE_URL and RAUTHY_URL) were dropped from the catalog on 2026-07-20,
  // because no code reads either and the rauthy issuer is same-origin, derived
  // in-container from ENRAHITU_PUBLIC_URL rather than supplied (spec 010
  // section 2.1, spec 009 section 2.4). The surviving derived key,
  // FLEET_IMAGE_PULL_SECRET, is a base64 dockerconfigjson with no formula this
  // validator can restate. Reinstate a formula table here if one returns.

  return errors;
}

/** Every secret Encore injects in infra.config.json must be a catalog key. */
function checkInfraConfigAgreement(catalog: CatalogKey[]): string[] {
  const errors: string[] = [];
  const names = new Set(catalog.map((k) => k.name));
  const cfg = JSON.parse(readFileSync(INFRA_CONFIG_PATH, "utf8")) as {
    secrets?: Record<string, unknown>;
  };
  for (const name of Object.keys(cfg.secrets ?? {})) {
    if (!names.has(name)) {
      errors.push(
        `infra.config.json declares secret "${name}" absent from catalog.toml`,
      );
    }
  }
  return errors;
}

function main(): void {
  const [cmd, arg] = process.argv.slice(2);
  const catalog = loadCatalog();

  switch (cmd) {
    case "example": {
      writeFileSync(EXAMPLE_PATH, renderExample(catalog));
      console.log(`wrote ${EXAMPLE_PATH} (${catalog.length} keys)`);
      break;
    }
    case "validate": {
      const path = arg ?? OPERATOR_ENV_PATH;
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        console.error(`cannot read env file: ${path}`);
        process.exit(2);
      }
      const errors = validateEnv(catalog, parseEnv(text));
      if (errors.length > 0) {
        console.error(`INVALID: ${path}`);
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
      }
      console.log(`OK: ${path} satisfies the catalog (${catalog.length} keys)`);
      break;
    }
    case "check": {
      const errors = checkInfraConfigAgreement(catalog);
      if (errors.length > 0) {
        console.error("catalog / infra.config.json disagreement:");
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
      }
      console.log("OK: infra.config.json agrees with catalog.toml");
      break;
    }
    case "secret-keys": {
      for (const k of catalog) if (k.secret) console.log(k.name);
      break;
    }
    case "keys": {
      for (const k of catalog) console.log(k.name);
      break;
    }
    default:
      console.error(
        "usage: catalog.ts <example|validate [envpath]|check|secret-keys|keys>",
      );
      process.exit(2);
  }
}

main();
