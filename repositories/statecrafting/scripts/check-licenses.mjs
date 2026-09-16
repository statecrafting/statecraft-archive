// Spec: 005-governance-native section 3.3
//
// The license gate. Spec 001 section 3 splits this repository's packages across
// three licenses by customer reach, and section 3.2 forbids an Apache-2.0
// package from depending on an AGPL-3.0 one: the copyleft would reach through
// the dependency and contradict the permissive promise made to stamped apps.
//
// Spec 001 section 3.2 calls that "the invariant most likely to be violated by
// accident, because nothing in npm enforces it and the packages now sit
// adjacent in one tree". Until spec 005 it lived only in prose. This script is
// the enforcement, wired into the spec-spine workflow so a violation fails the
// pull request.
//
// The declared tiers live in the root package.json under
// `statecrafting.licenseTiers`, because spec-spine.toml rejects unknown
// configuration fields and so cannot carry them.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = (pkg, msg) => failures.push(`${pkg}: ${msg}`);

const read = (p) => readFileSync(join(repoRoot, p), "utf8");
const readJson = (p) => JSON.parse(read(p));

const root = readJson("package.json");
const tiers = root.statecrafting?.licenseTiers;
if (!tiers || Object.keys(tiers).length === 0) {
  console.error("root package.json has no statecrafting.licenseTiers map");
  process.exit(1);
}

// A license is identified by a distinctive line of its own text, so a package
// cannot declare one license and ship another's LICENSE file.
//
// The matching is case-sensitive on purpose. MPL-2.0 section 1.12 names the
// "GNU Affero General Public License" as a Secondary License in its own body
// (spec 001 section 3.1), so a case-insensitive AGPL fingerprint would report
// every MPL package as shipping AGPL text. The all-caps forms below are the
// document headings, which appear only in the license they name.
const LICENSE_FINGERPRINTS = {
  "Apache-2.0": "Apache License",
  "MPL-2.0": "Mozilla Public License, version 2.0",
  "AGPL-3.0": "GNU AFFERO GENERAL PUBLIC LICENSE",
};

// The tier that carries the SaaS shield. Spec 001 section 3: its members are
// control-plane internals no stamped app touches.
const COPYLEFT = "AGPL-3.0";

// Tiers whose packages a stamped customer app can reach, directly or through
// the toolchain. Spec 001 section 3.2's invariant is about this reach: the
// copyleft must not travel down a dependency edge into an app we promised
// would stay unencumbered. MPL-2.0 is here as well as Apache-2.0 because the
// toolchain platform packages ship inside stamped apps too; MPL's file-level
// copyleft is upstream Encore's own choice and says nothing about what those
// packages may depend on.
const CUSTOMER_REACHING = new Set(["Apache-2.0", "MPL-2.0"]);

const NPM_DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

// Every npm name this repository publishes, mapped back to its tier, so a
// dependency edge can be resolved to a license without a registry lookup.
const npmNameToTier = new Map();
// Likewise for crate names, for the Cargo side of the same question.
const crateNameToTier = new Map();

// The tier map must cover the repository's whole declared package inventory,
// or a package could dodge the gate simply by never being listed. spec-spine
// .toml's two standalone lists are that inventory: spec 000 section 3 says a
// package appends itself to them as its own spec lands it. Checking the map
// against the lists makes the two mutually enforcing, in both directions.
const spine = read("spec-spine.toml");
const tomlList = (key) => {
  const body = spine.match(new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m"))?.[1];
  return body ? [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
};

const declared = new Set([
  ...tomlList("standalone_npm_packages"),
  ...tomlList("standalone_rust_workspaces"),
]);
if (declared.size === 0) {
  console.error("spec-spine.toml declares no standalone packages; refusing to vacuously pass");
  process.exit(1);
}

for (const dir of declared) {
  if (!(dir in tiers)) {
    fail(dir, "is declared in spec-spine.toml but has no statecrafting.licenseTiers row");
  }
}
for (const dir of Object.keys(tiers)) {
  if (!declared.has(dir)) {
    fail(dir, "has a licenseTiers row but is not declared in spec-spine.toml");
  }
}

const packages = [];

for (const [dir, tier] of Object.entries(tiers)) {
  if (!LICENSE_FINGERPRINTS[tier]) {
    fail(dir, `declares unknown tier "${tier}"`);
    continue;
  }

  const pkgJsonPath = join(dir, "package.json");
  if (!existsSync(join(repoRoot, pkgJsonPath))) {
    fail(dir, "is in licenseTiers but has no package.json");
    continue;
  }
  const pkg = readJson(pkgJsonPath);

  const cargoPath = join(dir, "Cargo.toml");
  const cargo = existsSync(join(repoRoot, cargoPath)) ? read(cargoPath) : null;

  packages.push({ dir, tier, pkg, cargo });
  npmNameToTier.set(pkg.name, tier);

  if (cargo) {
    const crateName = cargo.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    if (crateName) crateNameToTier.set(crateName, tier);
  }
}

for (const { dir, tier, pkg, cargo } of packages) {
  // 1. the npm manifest declares the tier
  if (pkg.license !== tier) {
    fail(dir, `package.json license is "${pkg.license}", expected "${tier}"`);
  }

  // 2. the crate manifest declares the tier, where the package is a crate
  if (cargo) {
    // Only the [package] license, not a dependency's `license` key.
    const cargoLicense = cargo
      .split(/^\[/m)[0]
      .concat(cargo.match(/^\[package\][^[]*/m)?.[0] ?? "")
      .match(/^\s*license\s*=\s*"([^"]+)"/m)?.[1];
    if (cargoLicense !== tier) {
      fail(dir, `Cargo.toml license is "${cargoLicense ?? "absent"}", expected "${tier}"`);
    }
  }

  // 3. the LICENSE file exists and is the license it claims
  const licensePath = join(dir, "LICENSE");
  if (!existsSync(join(repoRoot, licensePath))) {
    fail(dir, `declares ${tier} but ships no LICENSE file`);
  } else {
    const text = read(licensePath);
    const want = LICENSE_FINGERPRINTS[tier];
    if (!text.includes(want)) {
      fail(dir, `LICENSE text does not look like ${tier} (no "${want}")`);
    }
    // A permissive package must not ship copyleft text, and vice versa.
    for (const [other, fingerprint] of Object.entries(LICENSE_FINGERPRINTS)) {
      if (other !== tier && text.includes(fingerprint)) {
        fail(dir, `declares ${tier} but its LICENSE contains ${other} text`);
      }
    }
  }

  // 4. the dependency-direction invariant (spec 001 section 3.2)
  if (!CUSTOMER_REACHING.has(tier)) continue;

  for (const field of NPM_DEP_FIELDS) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (npmNameToTier.get(dep) === COPYLEFT) {
        fail(dir, `is ${tier} but ${field} names the ${COPYLEFT} package "${dep}" (spec 001 section 3.2)`);
      }
    }
  }

  if (cargo) {
    for (const [crate, crateTier] of crateNameToTier) {
      if (crateTier !== COPYLEFT) continue;
      // Match a dependency table entry for the crate, in either form:
      //   crate = "..."            /  crate = { ... }
      //   [dependencies.crate]
      const asEntry = new RegExp(`^\\s*${crate}\\s*=`, "m");
      const asTable = new RegExp(`^\\s*\\[[^\\]]*dependencies\\.${crate}\\]`, "m");
      if (asEntry.test(cargo) || asTable.test(cargo)) {
        fail(dir, `is ${tier} but its Cargo.toml depends on the ${COPYLEFT} crate "${crate}" (spec 001 section 3.2)`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("license gate failed (spec 001 section 3, spec 005 section 3.3):\n");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("");
  process.exit(1);
}

const counts = packages.reduce((acc, p) => {
  acc[p.tier] = (acc[p.tier] ?? 0) + 1;
  return acc;
}, {});
const summary = Object.entries(counts)
  .map(([tier, n]) => `${n} ${tier}`)
  .join(", ");
console.log(`license gate: ${packages.length} packages checked (${summary}); no customer-reaching package depends on an ${COPYLEFT} one`);
