import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Plus, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runGuardedMutation } from "@/lib/async-submit";
import { FAMILY_BUNDLE_KEY, useCalendar } from "@/lib/calendar-store";
import {
  CATEGORY_COLORS,
  MAX_CUSTOM_CATEGORIES,
  UNCATEGORIZED_APPEARANCE,
  UNCATEGORIZED_LABEL,
  canAddCategory,
  categoryAppearance,
  type EventCategory,
} from "@/lib/event-categories";
import {
  addStarterCategories,
  createEventCategory,
  deleteEventCategory,
  reorderEventCategories,
  updateEventCategory,
} from "@/lib/settings.functions";
import { styleForColor, type MemberColor } from "@/lib/family-data";
import { cn } from "@/lib/utils";

function ColorPicker({
  value,
  onChange,
}: {
  value: MemberColor;
  onChange: (next: MemberColor) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORY_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
          className={cn(
            "h-9 w-9 rounded-full transition-all",
            styleForColor(color).dot,
            value === color ? "ring-2 ring-primary ring-offset-2" : "opacity-70",
          )}
        />
      ))}
    </div>
  );
}

export function EventCategorySettings() {
  const { categories, canEdit } = useCalendar();
  const queryClient = useQueryClient();
  const create = useServerFn(createEventCategory);
  const update = useServerFn(updateEventCategory);
  const remove = useServerFn(deleteEventCategory);
  const reorder = useServerFn(reorderEventCategories);
  const seed = useServerFn(addStarterCategories);

  const [editing, setEditing] = useState<EventCategory | "new" | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<MemberColor>("sky");
  const [busy, setBusy] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });

  const openNew = () => {
    setName("");
    setColor(CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length] ?? "sky");
    setEditing("new");
  };
  const openEdit = (category: EventCategory) => {
    setName(category.name);
    setColor(category.color);
    setEditing(category);
  };

  const save = () =>
    runGuardedMutation({
      busy,
      setBusy,
      perform: async () => {
        if (editing === "new") await create({ data: { name, color } });
        else if (editing) await update({ data: { id: editing.id, name, color } });
        await refresh();
      },
      onSuccess: () => {
        toast.success(editing === "new" ? "Category added" : "Category updated");
        setEditing(null);
      },
      onError: toast.error,
      errorFallback: "Could not save the category.",
    });

  const destroy = (category: EventCategory) =>
    runGuardedMutation({
      busy,
      setBusy,
      perform: async () => {
        await remove({ data: { id: category.id } });
        await refresh();
      },
      onSuccess: () =>
        toast.success(`${category.name} removed · its events are now ${UNCATEGORIZED_LABEL}`),
      onError: toast.error,
      errorFallback: "Could not remove the category.",
    });

  const move = (index: number, delta: number) => {
    const next = [...categories];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    void runGuardedMutation({
      busy,
      setBusy,
      perform: async () => {
        await reorder({ data: { ids: next.map((c) => c.id) } });
        await refresh();
      },
      onSuccess: () => undefined,
      onError: toast.error,
      errorFallback: "Could not reorder categories.",
    });
  };

  const addStarters = () =>
    runGuardedMutation({
      busy,
      setBusy,
      perform: async () => {
        await seed({});
        await refresh();
      },
      onSuccess: () => toast.success("Starter categories added"),
      onError: toast.error,
      errorFallback: "Could not add the starter categories.",
    });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
          <Tags className="h-4 w-4" aria-hidden />
          Event categories
        </h2>
        {canEdit ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-9 rounded-full font-bold"
            onClick={openNew}
            disabled={!canAddCategory(categories) || busy}
          >
            <Plus className="h-4 w-4" />
            Add category
          </Button>
        ) : null}
      </div>

      <div className="divide-y divide-border-soft overflow-hidden rounded-3xl border border-border-soft bg-card">
        {categories.map((category, index) => (
          <div
            key={category.id}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-4"
          >
            <span
              className={cn("h-6 w-6 rounded-full", categoryAppearance(category).swatch)}
              aria-hidden
            />
            <button
              type="button"
              className="min-w-0 text-left"
              onClick={() => (canEdit ? openEdit(category) : undefined)}
            >
              <p className="truncate text-sm font-bold">{category.name}</p>
              <p className="text-xs text-muted-foreground">
                {canEdit ? "Tap to rename or recolor" : "Category"}
              </p>
            </button>
            {canEdit ? (
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 rounded-full"
                  aria-label={`Move ${category.name} up`}
                  disabled={index === 0 || busy}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 rounded-full"
                  aria-label={`Move ${category.name} down`}
                  disabled={index === categories.length - 1 || busy}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 rounded-full text-muted-foreground"
                  aria-label={`Remove ${category.name}`}
                  disabled={busy}
                  onClick={() => void destroy(category)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
        ))}

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-4">
          <span
            className={cn("h-6 w-6 rounded-full", UNCATEGORIZED_APPEARANCE.swatch)}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-sm font-bold">{UNCATEGORIZED_LABEL}</p>
            <p className="text-xs text-muted-foreground">
              Always available · used by imported events until you pick a category
            </p>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {categories.length} of {MAX_CUSTOM_CATEGORIES} categories used. Removing a category keeps its
        events — they become {UNCATEGORIZED_LABEL}.
      </p>

      {canEdit && categories.length === 0 ? (
        <Button
          variant="secondary"
          className="h-10 rounded-full font-bold"
          onClick={() => void addStarters()}
          disabled={busy}
        >
          Add starter categories
        </Button>
      ) : null}

      <Dialog open={editing !== null} onOpenChange={(next) => (next ? null : setEditing(null))}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add category" : "Edit category"}</DialogTitle>
            <DialogDescription>
              Category colors are separate from family-member colors.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="category-name">Name</Label>
              <Input
                id="category-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sports"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              className="h-11 rounded-full"
              onClick={() => setEditing(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              className="h-11 rounded-full px-6 font-bold"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
