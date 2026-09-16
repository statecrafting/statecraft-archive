// Theme toggle. Flips the `.dark` class on <html> and persists the choice to
// localStorage. The icon is chosen purely by the `dark:` CSS variant, so there
// is no client render state and no hydration mismatch: the correct icon is
// visible the moment the no-flash script in root.tsx runs.

function setTheme(next: "dark" | "light") {
  const el = document.documentElement;
  el.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* storage unavailable (private mode); the toggle still works this session */
  }
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      aria-label="Toggle color theme"
      onClick={() =>
        setTheme(
          document.documentElement.classList.contains("dark") ? "light" : "dark"
        )
      }
      className={
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground " +
        className
      }
    >
      {/* Sun: shown in dark mode (click to go light) */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="hidden h-4 w-4 dark:block"
        aria-hidden
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
      {/* Moon: shown in light mode (click to go dark) */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="block h-4 w-4 dark:hidden"
        aria-hidden
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}
