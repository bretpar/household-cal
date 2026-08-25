import { Link } from "@tanstack/react-router";

export function LegalFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border-soft bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <span className="text-sm font-semibold text-foreground">Our Family Calendar</span>
          <nav className="flex items-center gap-6">
            <Link
              to="/privacy"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Privacy Policy
            </Link>
            <Link
              to="/terms"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Terms
            </Link>
          </nav>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground sm:text-left">
          © {year} Our Family Calendar. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
