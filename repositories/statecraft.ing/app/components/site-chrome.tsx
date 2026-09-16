import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { ThemeToggle } from "./theme-toggle";
import { SignInLink } from "./sign-in-link";
import { ORG_URL, PRODUCT_FAMILY } from "~/lib/product-family";

const NAV_ITEMS = [
  { path: "/", label: "Overview" },
  { path: "/products", label: "Products" },
  { path: "/papers", label: "Papers" },
  { path: "/registry", label: "Registry" },
  { path: "/docs", label: "Docs" },
  { path: "/get-started", label: "Get Started" },
];

function isActive(pathname: string, path: string) {
  return path === "/" ? pathname === "/" : pathname.startsWith(path);
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" />
      <path d="M3 7.5 12 12l9-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

function Wordmark() {
  return (
    <Link to="/" className="group flex items-center gap-2">
      <Logo className="h-5 w-5 text-primary transition-all group-hover:text-glow" />
      <span className="font-mono text-sm font-bold tracking-tight">
        Statecraft
      </span>
    </Link>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      {open ? (
        <path d="M18 6 6 18M6 6l12 12" />
      ) : (
        <path d="M3 12h18M3 6h18M3 18h18" />
      )}
    </svg>
  );
}

export function SiteHeader() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Wordmark />

        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-1 lg:flex"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                isActive(pathname, item.path)
                  ? "bg-primary/10 text-primary glow-cyan-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <span className="spec-chip hidden xl:inline-flex">
            <span className="pulse-dot" />
            spec-governed
          </span>
          <ThemeToggle />
          <SignInLink className="hidden rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground sm:inline-flex">
            Sign in
          </SignInLink>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileOpen}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          >
            <MenuIcon open={mobileOpen} />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          aria-label="Mobile navigation"
          className="border-t border-border/40 bg-background/95 px-4 py-2 lg:hidden"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`block rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                isActive(pathname, item.path)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <div className="my-2 h-px bg-border/50" />
          <SignInLink className="block rounded-lg border border-border px-4 py-3 text-center text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground">
            Sign in
          </SignInLink>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/50 py-10">
      <div className="container mx-auto flex max-w-6xl flex-col gap-6 px-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCT_FAMILY.map((r) => (
            <a
              key={r.repo}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-lg border border-border/60 p-3 transition-colors hover:border-primary/50"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold group-hover:text-primary">
                  {r.name}
                </span>
                <span className="spec-chip">{r.license}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{r.role}</p>
            </a>
          ))}
        </div>
        <div className="flex flex-col items-center justify-between gap-3 border-t border-border/40 pt-6 text-xs text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2 font-mono">
            <span className="pulse-dot" />
            <span>governed by spec-spine</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 font-mono">
            <Link to="/registry" className="transition-colors hover:text-primary">
              Registry
            </Link>
            <a
              href={ORG_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-primary"
            >
              GitHub
            </a>
            <span>Static, spec-governed, no tracking.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
