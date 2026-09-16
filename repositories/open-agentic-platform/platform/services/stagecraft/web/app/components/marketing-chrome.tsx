import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Menu, X } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { SignInLink } from "./sign-in-link";

const NAV_ITEMS = [
  { path: "/", label: "Overview" },
  { path: "/products", label: "Products" },
  { path: "/papers", label: "Papers" },
  { path: "/registry", label: "Registry" },
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
        Open Agentic Platform
      </span>
    </Link>
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
          <span className="spec-chip hidden md:inline-flex">
            <span className="pulse-dot" />
            spec-governed
          </span>
          <ThemeToggle />
          <SignInLink className="hidden rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground sm:inline-flex">
            Sign in
          </SignInLink>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div
        className={`fixed right-0 top-0 z-[101] h-full w-72 border-l border-border/60 bg-card shadow-2xl transition-transform duration-200 ease-out lg:hidden ${
          mobileOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border/40 p-4">
          <span className="font-mono text-sm font-bold">Open Agentic Platform</span>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav aria-label="Mobile navigation" className="flex flex-col gap-1 p-4">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                isActive(pathname, item.path)
                  ? "border border-primary/20 bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <div className="my-2 h-px bg-border/50" />
          <SignInLink className="rounded-lg border border-border px-4 py-3 text-center text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground">
            Sign in
          </SignInLink>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/50 py-8">
      <div className="container mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-xs text-muted-foreground md:flex-row">
        <div className="flex items-center gap-2 font-mono">
          <span className="pulse-dot" />
          <span>governed by spec-spine</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 font-mono">
          <a
            href="https://github.com/statecrafting/open-agentic-platform"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-primary"
          >
            GitHub
          </a>
          <span>Open Agentic Platform</span>
          <span>AGPL-3.0</span>
          <span>&copy; {new Date().getFullYear()} OAP</span>
        </div>
      </div>
    </footer>
  );
}
