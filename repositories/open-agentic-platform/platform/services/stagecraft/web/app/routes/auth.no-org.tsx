/**
 * No connected org error page (spec 080 FR-002 step 11, Phase 4 generalized).
 * Shown when a user logs in but none of their organizations are connected
 * to Statecraft (no GitHub App installed or no OIDC provider configured).
 */

import { Link, useSearchParams } from "react-router";

export default function NoOrg() {
  const [params] = useSearchParams();
  const login = params.get("login");
  const provider = params.get("provider");
  const isEnterprise = provider && provider !== "github";

  return (
    <div className="min-h-full container px-4 mx-auto my-16 max-w-md text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-yellow-100 flex items-center justify-center dark:bg-yellow-900">
        <svg
          className="h-6 w-6 text-yellow-600 dark:text-yellow-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
      </div>
      <h1 className="mt-4 text-xl font-bold text-gray-900 dark:text-gray-100">
        No connected organization
      </h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        {login ? (
          <>
            Signed in as <strong>{login}</strong>, but none of your
            organizations are connected to Statecraft.
          </>
        ) : (
          "None of your organizations are connected to Statecraft."
        )}
      </p>
      <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
        {isEnterprise
          ? "Ask your organization admin to configure the OIDC identity provider connection, then try signing in again."
          : "Ask your organization admin to install the Statecraft GitHub App, then try signing in again."}
      </p>
      <div className="mt-6">
        <Link
          to="/signin"
          className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 text-sm font-medium"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
