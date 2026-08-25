import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";
import {
  UNCATEGORIZED_APPEARANCE,
  UNCATEGORIZED_FILTER,
  UNCATEGORIZED_LABEL,
} from "@/lib/event-categories";
import { styleForColor } from "@/lib/family-data";

/**
 * Optional category filter. Nothing selected = every category shows.
 * Coverage background layers are never filtered out.
 */
export function CategoryFilter({ className }: { className?: string }) {
  const { categories, selectedCategory, setSelectedCategory } = useCalendar();

  const options = [
    ...categories.map((category) => ({
      value: category.value ?? category.id,
      label: category.name,
      swatch: styleForColor(category.color).badge,
    })),
    {
      value: UNCATEGORIZED_FILTER,
      label: UNCATEGORIZED_LABEL,
      swatch: UNCATEGORIZED_APPEARANCE.swatch,
    },
  ];

  if (categories.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} aria-label="Filter by category">
      <button
        type="button"
        onClick={() => setSelectedCategory(null)}
        aria-pressed={selectedCategory === null}
        className={cn(
          "h-9 rounded-full px-3.5 text-xs font-bold transition-colors",
          selectedCategory === null
            ? "bg-primary text-primary-foreground"
            : "bg-surface text-muted-foreground border border-border-soft hover:bg-secondary",
        )}
      >
        All categories
      </button>
      {options.map((option) => {
        const on = selectedCategory === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setSelectedCategory(on ? null : option.value)}
            aria-pressed={on}
            className={cn(
              "flex h-9 items-center gap-2 rounded-full border px-3.5 text-xs font-bold transition-colors",
              on
                ? "border-primary bg-secondary text-foreground"
                : "border-border-soft bg-surface text-muted-foreground hover:bg-secondary",
            )}
          >
            <span className={cn("h-2.5 w-2.5 rounded-full", option.swatch)} aria-hidden />
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
