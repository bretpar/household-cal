import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { CategoryFilter } from "@/components/CategoryFilter";
import { MemberFilter } from "@/components/MemberFilter";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useCalendar } from "@/lib/calendar-store";
import { cn } from "@/lib/utils";

/**
 * Compact entry point for the family-member and category filters so the
 * calendar itself sits higher on small screens. Filtering logic is unchanged —
 * this only moves the existing controls into a bottom sheet.
 */
export function CalendarFiltersSheet({ className }: { className?: string }) {
  const { selectedMembers, selectedCategory, clearMembers, setSelectedCategory } = useCalendar();
  const [open, setOpen] = useState(false);
  const activeCount = selectedMembers.length + (selectedCategory ? 1 : 0);
  const filtered = activeCount > 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-9 gap-2 rounded-full border px-3 text-sm font-semibold",
            filtered
              ? "border-primary bg-secondary text-foreground"
              : "border-border-soft bg-surface text-muted-foreground",
            className,
          )}
          aria-label={filtered ? `Filters — ${activeCount} active` : "Filters"}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          <span>Filters</span>
          {filtered ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl">
        <SheetHeader className="text-left">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Choose who and what shows on the calendar.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <section className="space-y-2">
            <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Family members
            </h3>
            <MemberFilter />
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Categories
            </h3>
            <CategoryFilter />
          </section>
          <div className="flex justify-between gap-2 pb-2">
            <Button
              variant="ghost"
              className="h-10 rounded-full px-4 text-sm font-semibold"
              disabled={!filtered}
              onClick={() => {
                clearMembers();
                setSelectedCategory(null);
              }}
            >
              Reset filters
            </Button>
            <Button className="h-10 rounded-full px-5 text-sm font-bold" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
