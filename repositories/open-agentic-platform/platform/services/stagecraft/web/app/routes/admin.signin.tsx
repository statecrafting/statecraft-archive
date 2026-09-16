import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

/**
 * Separate admin login removed in Phase 5 (spec 087).
 * Admin access is determined by the platform_role claim in the Rauthy JWT.
 * All users sign in via GitHub OAuth on /signin.
 */
export async function loader(_args: LoaderFunctionArgs) {
  return redirect("/signin");
}

export default function AdminSignin() {
  return null;
}
