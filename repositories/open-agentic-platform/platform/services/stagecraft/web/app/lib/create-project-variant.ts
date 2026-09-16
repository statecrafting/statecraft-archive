// Spec 227 Stage 2: the pure mapping between the create form's orthogonal axes
// (Topology x Audience) and the Build Spec `variant` the backend expects, plus
// the manifest profile name a pair resolves to. Audience is not independently
// selectable for `dual` (it serves both stacks); the `minimal` profile is never
// produced at the OAP surface (the surface always ships a public/internal/dual
// variant). Kept pure (no react-router/server imports) so the mapping is
// unit-testable and safe in the client bundle.
//
// The auth DRIVER (spec 229) is a separate, orthogonal axis: the app-level
// AUTH_DRIVER, only `mock` (dev) or `rauthy` (prod). It does not affect the
// variant (every real IdP federates inside Rauthy), so it is not an input to
// toVariant/profileName; it is patched into apps/api/.env.example at scaffold.

export type Topology = "single" | "dual";
export type Auth = "public" | "internal";
export type Variant = "single-public" | "single-internal" | "dual";

/** The auth driver axis (spec 229): the app-level AUTH_DRIVER. Only `mock`
 * (zero-dependency dev identity) and `rauthy` (production) are app-level
 * drivers; enterprise IdPs (github/google/auth0/entra/SAML-via-Google-Workspace)
 * federate inside Rauthy, not as AUTH_DRIVER values. */
export type AuthDriver = "mock" | "rauthy";

/** Default driver at the OAP create surface: production Rauthy. */
export const DEFAULT_AUTH_DRIVER: AuthDriver = "rauthy";

/** Map the two axes to the Build Spec variant the backend still expects. */
export function toVariant(topology: Topology, auth: Auth): Variant {
  if (topology === "dual") return "dual";
  return auth === "internal" ? "single-internal" : "single-public";
}

/** The manifest profile name a (topology, auth) pair resolves to. */
export function profileName(topology: Topology, auth: Auth): string {
  return topology === "dual" ? "dual" : auth;
}
