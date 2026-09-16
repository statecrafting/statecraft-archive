import { useEffect, useState, type ReactNode } from "react";

// Kicks off the Rauthy OIDC flow directly (skipping the /signin interstitial).
// SSR renders a root-relative href (resolves against the current host + scheme,
// and is proxied to Encore in local dev). After hydration, on any non-local
// host we rewrite the href to an absolute https URL, so the OAuth kickoff is
// https for every interaction (plain, middle, and cmd/ctrl-click alike).
function isLocalHost(host: string): boolean {
  const h = host.replace(/:\d+$/, ""); // strip :port
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

export function SignInLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [href, setHref] = useState("/auth/rauthy");
  useEffect(() => {
    const host = window.location.host;
    if (!isLocalHost(host)) setHref(`https://${host}/auth/rauthy`);
  }, []);
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
