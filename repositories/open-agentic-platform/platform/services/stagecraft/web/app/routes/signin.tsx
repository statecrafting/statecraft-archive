import { useSearchParams } from "react-router";

const ERROR_MESSAGES: Record<string, string> = {
  github_denied: "GitHub login was denied. Please try again.",
  no_email: "Could not retrieve your email from your identity provider. Please ensure your email is verified.",
  token_failed: "Authentication failed. Please try again.",
  github_api_failed: "Could not reach the identity provider. Please try again in a moment.",
  account_error: "Failed to create or link your account. Please try again or contact support.",
  membership_failed: "Could not resolve your organization memberships. Please try again.",
  rauthy_unavailable: "Identity service is temporarily unavailable. Please try again later.",
  oauth_failed: "Login failed. Please try again.",
  session_expired: "Session expired. Please sign in again.",
};

export default function Signin() {
  const [searchParams] = useSearchParams();
  const oauthError = searchParams.get("error");
  const errorMessage = oauthError
    ? ERROR_MESSAGES[oauthError] ?? oauthError
    : null;

  return (
    <div className="min-h-full container px-4 mx-auto my-16 max-w-sm">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        Sign in
      </h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Sign in with your GitHub or Google account.
      </p>
      {errorMessage ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      ) : null}

      {/* GitHub login: routes through Rauthy with idp_hint=github (spec 106 FR-004). */}
      <a
        href="/auth/rauthy"
        className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700 dark:focus:ring-offset-gray-900"
      >
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            clipRule="evenodd"
          />
        </svg>
        Continue with GitHub
      </a>

      {/* Google login: routes through Rauthy with idp_hint=google. */}
      <a
        href="/auth/google"
        className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 dark:focus:ring-offset-gray-900"
      >
        <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        Continue with Google
      </a>
    </div>
  );
}
