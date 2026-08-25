import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { LegalFooter } from "./LegalFooter";

export function LegalPageLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5 lg:px-8">
        <Link to="/" className="font-display text-lg font-bold">
          Our Family Calendar
        </Link>
        <Link
          to="/"
          className="text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Back to Our Family Calendar
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 lg:px-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{title}</h1>
        <div className="mt-8 space-y-8 text-foreground">{children}</div>
      </main>

      <LegalFooter />
    </div>
  );
}
