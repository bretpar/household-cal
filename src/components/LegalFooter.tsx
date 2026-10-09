import { Link } from "@tanstack/react-router";

export function LegalFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border-soft bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 text-[11px] text-muted-foreground lg:px-8">
        <span>© {year} Our Family Calendar</span>
        <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          <Link to="/features/family-calendar" className="hover:text-foreground">
            Family calendar
          </Link>
          <Link to="/features/childcare-scheduling" className="hover:text-foreground">
            Childcare scheduling
          </Link>
          <Link to="/best-shared-calendar-app" className="hover:text-foreground">
            Compare
          </Link>
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

