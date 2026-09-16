/**
 * template.toml: the contract between the enrahitu template and the factory
 * (spec 005 §3, enrahitu spec 009). The factory reads ONLY this file to learn
 * how to stamp; anything not expressed here is not part of the interface.
 *
 * A small, self-contained reader parses the subset the contract uses (tables,
 * `key = value` with string/bool/int values, single-line inline tables, and
 * single-line arrays including a nested array inside an inline table). This
 * avoids a TOML dependency for a stable, pinned file; the parser is exercised
 * against the real template.toml fixture and version-range snippets in tests.
 */

type TomlValue = string | boolean | number | TomlValue[] | { [k: string]: TomlValue };
type TomlTable = Record<string, TomlValue>;

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

// --- the reader -----------------------------------------------------------

function skipWs(src: string, pos: number): number {
  while (pos < src.length && (src[pos] === " " || src[pos] === "\t")) pos++;
  return pos;
}

function parseString(src: string, pos: number, quote: string): { value: string; pos: number } {
  let out = "";
  let i = pos + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && quote === '"' && i + 1 < src.length) {
      out += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === quote) return { value: out, pos: i + 1 };
    out += ch;
    i++;
  }
  throw new ContractError(`unterminated string in template.toml near: ${src.slice(pos, pos + 20)}`);
}

function parseBare(src: string, pos: number): { value: TomlValue; pos: number } {
  let i = pos;
  while (i < src.length && !",]}#".includes(src[i]!) && src[i] !== " " && src[i] !== "\t") i++;
  const token = src.slice(pos, i);
  if (token === "true") return { value: true, pos: i };
  if (token === "false") return { value: false, pos: i };
  if (/^-?\d+$/.test(token)) return { value: Number(token), pos: i };
  return { value: token, pos: i };
}

function parseArray(src: string, pos: number): { value: TomlValue[]; pos: number } {
  const out: TomlValue[] = [];
  let i = pos + 1;
  for (;;) {
    i = skipWs(src, i);
    if (i >= src.length) throw new ContractError("unterminated array in template.toml");
    if (src[i] === "]") return { value: out, pos: i + 1 };
    const parsed = parseValue(src, i);
    out.push(parsed.value);
    i = skipWs(src, parsed.pos);
    if (src[i] === ",") i++;
  }
}

function parseInlineTable(src: string, pos: number): { value: TomlTable; pos: number } {
  const out: TomlTable = {};
  let i = pos + 1;
  for (;;) {
    i = skipWs(src, i);
    if (i >= src.length) throw new ContractError("unterminated inline table in template.toml");
    if (src[i] === "}") return { value: out, pos: i + 1 };
    let k = i;
    while (k < src.length && src[k] !== "=" && src[k] !== " " && src[k] !== "\t") k++;
    const key = src.slice(i, k);
    i = skipWs(src, k);
    if (src[i] !== "=") throw new ContractError(`expected '=' in inline table near ${key}`);
    const parsed = parseValue(src, i + 1);
    out[key] = parsed.value;
    i = skipWs(src, parsed.pos);
    if (src[i] === ",") i++;
  }
}

function parseValue(src: string, pos: number): { value: TomlValue; pos: number } {
  pos = skipWs(src, pos);
  const ch = src[pos];
  if (ch === '"' || ch === "'") return parseString(src, pos, ch);
  if (ch === "{") return parseInlineTable(src, pos);
  if (ch === "[") return parseArray(src, pos);
  return parseBare(src, pos);
}

/** Parse the contract into a table-of-tables. Top-level bare keys are ignored. */
export function parseToml(src: string): Record<string, TomlTable> {
  const tables: Record<string, TomlTable> = {};
  let current: TomlTable | null = null;
  for (const rawLine of src.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      const end = line.indexOf("]");
      if (end < 0) throw new ContractError(`malformed table header: ${line}`);
      const name = line.slice(1, end).trim();
      tables[name] = tables[name] ?? {};
      current = tables[name]!;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0 || current === null) continue;
    const key = line.slice(0, eq).trim();
    current[key] = parseValue(line, eq + 1).value;
  }
  return tables;
}

// --- the contract ---------------------------------------------------------

export interface SlotSpec {
  required?: boolean;
  pattern?: string;
  default?: string;
  allowed?: string[];
}

export interface TemplateContract {
  templateName: string;
  templateVersion: string;
  contractVersion: string;
  slots: Record<string, SlotSpec>;
  verbs: Record<string, string>;
  provenance: { certPath?: string; certSchema?: string; verify?: string; postures?: string[] } | null;
}

function asString(value: TomlValue | undefined, where: string): string {
  if (typeof value !== "string") throw new ContractError(`${where} must be a string`);
  return value;
}

function asStringArray(value: TomlValue | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => String(v));
}

function toSlotSpec(value: TomlValue): SlotSpec {
  if (typeof value !== "object" || Array.isArray(value)) return {};
  const t = value as TomlTable;
  return {
    required: typeof t.required === "boolean" ? t.required : undefined,
    pattern: typeof t.pattern === "string" ? t.pattern : undefined,
    default: typeof t.default === "string" ? t.default : undefined,
    allowed: asStringArray(t.allowed),
  };
}

export function readContract(src: string): TemplateContract {
  const toml = parseToml(src);
  const contract = toml.contract;
  if (!contract) throw new ContractError("template.toml has no [contract] table");
  const template = toml.template ?? {};

  const slots: Record<string, SlotSpec> = {};
  for (const [name, spec] of Object.entries(toml.slots ?? {})) slots[name] = toSlotSpec(spec);

  const verbs: Record<string, string> = {};
  for (const [name, cmd] of Object.entries(toml.verbs ?? {})) {
    if (typeof cmd === "string") verbs[name] = cmd;
  }

  const p = toml.provenance;
  const provenance = p
    ? {
        certPath: typeof p.cert_path === "string" ? p.cert_path : undefined,
        certSchema: typeof p.cert_schema === "string" ? p.cert_schema : undefined,
        verify: typeof p.verify === "string" ? p.verify : undefined,
        postures: asStringArray(p.postures),
      }
    : null;

  return {
    templateName: typeof template.name === "string" ? template.name : "",
    templateVersion: typeof template.version === "string" ? template.version : "",
    contractVersion: asString(contract.version, "[contract].version"),
    slots,
    verbs,
    provenance,
  };
}

// --- version gating -------------------------------------------------------

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(v: string): Semver {
  const core = v.split("-")[0]!.split("+")[0]!;
  const parts = core.split(".").map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n))) throw new ContractError(`invalid semver: ${v}`);
  return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0 };
}

function compareSemver(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** The supported contract range: major 0, `>=0.1.0 <1.0.0` (spec 005 §3, §4). */
export function isSupportedContract(contractVersion: string): boolean {
  const v = parseSemver(contractVersion);
  return v.major === 0 && compareSemver(v, { major: 0, minor: 1, patch: 0 }) >= 0;
}

export function assertSupportedContract(c: TemplateContract): void {
  if (!isSupportedContract(c.contractVersion)) {
    throw new ContractError(
      `unsupported template contract ${c.contractVersion}; factory supports >=0.1.0 <1.0.0`,
    );
  }
}

/** The scaffold verb is usable when the contract declares one (v0.4+). */
export function hasScaffoldVerb(c: TemplateContract): boolean {
  return typeof c.verbs.scaffold === "string" && c.verbs.scaffold.length > 0;
}

/** Cert emission is usable when [provenance] exists and contract >= 0.2 (spec 005 §3 step 3). */
export function supportsCert(c: TemplateContract): boolean {
  if (!c.provenance) return false;
  return compareSemver(parseSemver(c.contractVersion), { major: 0, minor: 2, patch: 0 }) >= 0;
}

// --- slot validation ------------------------------------------------------

export interface SlotRequest {
  appName: string;
  org: string;
  frontend?: string;
}

export interface ResolvedSlots {
  appName: string;
  org: string;
  frontend: string;
}

export function validateSlots(c: TemplateContract, req: SlotRequest): ResolvedSlots {
  const appSlot = c.slots.app_name;
  if (appSlot?.required && !req.appName) throw new ContractError("app_name is required");
  if (appSlot?.pattern && !new RegExp(appSlot.pattern).test(req.appName)) {
    throw new ContractError(`app_name "${req.appName}" does not match ${appSlot.pattern}`);
  }

  const orgSlot = c.slots.org;
  if (orgSlot?.required && !req.org) throw new ContractError("org is required");

  const feSlot = c.slots.frontend;
  const frontend = req.frontend ?? feSlot?.default ?? "";
  if (feSlot?.allowed && frontend && !feSlot.allowed.includes(frontend)) {
    throw new ContractError(`frontend "${frontend}" must be one of ${feSlot.allowed.join(", ")}`);
  }

  return { appName: req.appName, org: req.org, frontend };
}
