/**
 * Factory configuration (spec 005 §3).
 *
 * The template source is pinned to a commit SHA, never floating main: the
 * factory always stamps from a known-good tree. The pin defaults to a recorded
 * enrahitu commit (contract 0.5.0: scaffold verb + provenance) and is
 * overridable via env so the factory can be pointed at a newer known-good SHA
 * without a code change. The template repo is public, so it is cloned over
 * https with no credentials; the customer repo is pushed over https with the
 * tenant's installation token.
 */
import { join } from "node:path";

/** Public enrahitu template repo. Overridable (e.g. a mirror) via env. */
export const TEMPLATE_REPO =
  process.env.FACTORY_TEMPLATE_REPO ?? "https://github.com/statecrafting/enrahitu.git";

/**
 * Pinned template commit. Default: the enrahitu v0.2.0 release (contract 0.5.0:
 * scaffold verb v0.4, provenance v0.3). This SHA carries BOTH the project-Pages
 * base-path fix (enrahitu spec 013) that the opt-in Pages provisioning
 * (spec 005 §3) depends on, AND the export-ignore that keeps the vendored
 * toolchain source out of the stamp (enrahitu spec 018). An older pin ships a
 * base-path-buggy pages.yml or ~190K lines of vendor/encore build-source. Pin to
 * a tagged release, never floating main (spec 005 §3).
 */
export const TEMPLATE_REF =
  process.env.FACTORY_TEMPLATE_REF ?? "ec29aa7c7c4fbb8fc24b5bb3cae8f590f5370236";

/** The bare-clone cache and per-job workdirs live under the app data dir. */
export const FACTORY_DATA_DIR =
  process.env.FACTORY_DATA_DIR ?? join(process.cwd(), ".data", "factory");

export const TEMPLATE_CACHE_DIR = join(FACTORY_DATA_DIR, "enrahitu.git");

/** Identity recorded in the born-with cert's stampedBy field. */
export const FACTORY_STAMPED_BY_ID = "statecraft/factory@1";

/** Git commit author for the initial stamped commit (spec 005 §3 step 5). */
export const FACTORY_GIT_AUTHOR_NAME = "statecraft Factory";
export const FACTORY_GIT_AUTHOR_EMAIL = "factory@statecraft.ing";

/** How long to wait for the born-green verify run before failing (spec 005 §3 step 6). */
export const VERIFY_TIMEOUT_MS = 30 * 60 * 1000;
export const VERIFY_POLL_INTERVAL_MS = 15 * 1000;
