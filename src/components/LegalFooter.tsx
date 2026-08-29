import { Link } from "@tanstack/react-router";

export function LegalFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border-soft bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 text-[11px] text-muted-foreground lg:px-8">
        <span>© {year} Our Family Calendar</span>
        <nav className="flex items-center gap-4">
          <Link to="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-foreground">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}

