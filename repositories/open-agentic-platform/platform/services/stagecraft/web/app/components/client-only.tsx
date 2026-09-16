import { useEffect, useState, type ReactNode } from "react";

// Renders children only after hydration. Use for browser-only widgets (canvas,
// recharts) so they never run during SSR. `children` is a thunk so the heavy
// tree is not evaluated on the server.
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: () => ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children() : fallback}</>;
}
