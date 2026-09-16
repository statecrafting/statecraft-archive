import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

/**
 * Password-based signup removed in Phase 5 (spec 087).
 * All account creation flows through GitHub OAuth.
 */
export async function loader(_args: LoaderFunctionArgs) {
  return redirect("/signin");
}

export default function Signup() {
  return null;
}
