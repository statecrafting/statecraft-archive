import type { ReactNode } from "react";

// Sign-in hand-off (spec 004 section 3.2). The static apex runs no auth flow:
// it links out to the control plane's driver-agnostic login initiator, which
// 302s to the active auth driver's OIDC kickoff (rauthy today). The bare
// `/auth/rauthy` path this used before is the rauthy proxy passthrough, not a
// login route, and a top-level navigation to it is refused by rauthy's CSRF
// guard with "cross-origin request forbidden"; `/api/v1/auth/login` is the
// route the app's own sign-in button uses and it allows cross-site navigation.
// A plain absolute URL so it renders identically in prerendered HTML with no
// client JavaScript, and so middle-click / cmd-click behave.
export const SIGN_IN_URL = "https://app.statecraft.ing/api/v1/auth/login";

export function SignInLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={SIGN_IN_URL} className={className}>
      {children}
    </a>
  );
}
