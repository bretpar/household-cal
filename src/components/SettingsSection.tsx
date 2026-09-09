import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Collapsible Settings panel with a always-visible, easy-to-scan header.
 * Presentation only — children keep their own behavior.
 */
export function SettingsSection({
  title,
  description,
  icon,
  defaultOpen = false,
  tone = "default",
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  tone?: "default" | "muted";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-3">
      <CollapsibleTrigger
        className={cn(
          "flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tone === "muted"
            ? "border-dashed border-border bg-surface-muted/50"
            : "border-border-soft bg-card shadow-soft",
        )}
      >
        {icon ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          {description ? (
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 px-0.5 pb-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}
