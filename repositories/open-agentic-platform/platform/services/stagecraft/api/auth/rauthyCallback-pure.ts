/**
 * Pure callback helpers for Rauthy login flow (spec 106 FR-004).
 *
 * Split out from `rauthyCallback.ts` so unit tests can exercise the error
 * mapping without loading the Encore runtime or the DB handle that
 * `rauthyCallback.ts` pulls in via its service imports.
 *
 * `MembershipReason` is imported as a type-only reference; TypeScript erases
 * this at emit time, so importing from `./membershipResolver` here does not
 * cause its Encore imports to load.
 */

import type { MembershipReason } from "./membershipResolver";

export function errorCodeForReason(reason: MembershipReason): string {
  switch (reason) {
    case "pat_required":
      return "pat_required";
    case "pat_invalid":
      return "pat_invalid";
    case "pat_saml_not_authorized":
      return "pat_saml_not_authorized";
    case "pat_rate_limited":
      return "pat_rate_limited";
    case "membership_api_failed":
      return "membership_failed";
    default:
      return "no_orgs";
  }
}
