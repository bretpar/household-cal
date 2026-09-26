import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Apple, Archive, CalendarPlus, ChevronDown, Link2, Pencil, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AddAppleCalendarDialog, AppleCalendarControls } from "@/components/AppleCalendarSubscriptions";
import { GoogleAccountSettings, GoogleCalendarControls, GoogleCalendarDialog } from "@/components/CalendarSyncSettings";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FAMILY_BUNDLE_KEY, useCalendar } from "@/lib/calendar-store";
import {
  CALENDAR_COLORS,
  CALENDAR_ICON_KEYS,
  CALENDAR_ICON_LABELS,
  CALENDAR_ICON_NONE,
  MUTED_CALENDAR_TINT,
  defaultCalendarColor,
} from "@/lib/calendar-appearance";

import { calendarIconComponent } from "@/lib/calendar-icons";
import { styleForColor, type CalendarSource, type DisplayMode, type MemberColor } from "@/lib/family-data";
import { setCalendarAppearance, setCalendarDisplayMode } from "@/lib/google.functions";
import {
  updateIcsSubscriptionAppearance,
  updateIcsSubscriptionDisplayMode,
} from "@/lib/ics.functions";
import {
  archiveOfcCalendar,
  createOfcCalendar,
  renameOfcCalendar,
} from "@/lib/ofc-calendars.functions";
import { cn } from "@/lib/utils";

/**
 * Persistent presentation choices only; calendar visibility stays in Calendar
 * filters and nothing here is written back to Google or Apple.
 */
export function CalendarAppearanceSettings() {
  const queryClient = useQueryClient();
  const { sources, canEdit, isOwner } = useCalendar();
  const updateCalendarMode = useServerFn(setCalendarDisplayMode);
  const updateAppleMode = useServerFn(updateIcsSubscriptionDisplayMode);
  const updateCalendarLook = useServerFn(setCalendarAppearance);
  const updateAppleLook = useServerFn(updateIcsSubscriptionAppearance);

  const createCalendar = useServerFn(createOfcCalendar);
  const renameCalendar = useServerFn(renameOfcCalendar);
  const archiveCalendar = useServerFn(archiveOfcCalendar);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [managedSourceId, setManagedSourceId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [createOfcOpen, setCreateOfcOpen] = useState(false);
  const [googleAddMode, setGoogleAddMode] = useState<"existing" | "create" | null>(null);
  const [appleAddOpen, setAppleAddOpen] = useState(false);

  // My Calendars: the Family calendar, user-created OFC calendars, and connected
  // Google/Apple calendars. Legacy internal rows (e.g. "Caregiver coverage") stay hidden.
  const appearanceSources = sources.filter(
    (source) =>
      source.active &&
      (source.provider === "google" ||
        source.provider === "ics" ||
        (source.provider === "local" &&
          (source.calendar_kind === "household_default" || source.calendar_kind === "custom"))),
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
    await queryClient.invalidateQueries({ queryKey: ["calendar-sync"] });
    await queryClient.invalidateQueries({ queryKey: ["apple-subscriptions"] });
  };

  const mutation = useMutation({
    mutationFn: async ({ source, displayMode }: { source: CalendarSource; displayMode: DisplayMode }) => {
      if (source.provider === "ics") {
        return updateAppleMode({ data: { id: source.id, display_mode: displayMode } });
      }
      return updateCalendarMode({
        data: { source_id: source.id, display_mode: displayMode },
      });
    },
    onSuccess: async () => {
      toast.success("Calendar appearance updated");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const lookMutation = useMutation({
    mutationFn: async ({
      source,
      color,
      icon,
    }: {
      source: CalendarSource;
      color: MemberColor;
      icon: string | null;
    }) => {
      if (source.provider === "ics") {
        return updateAppleLook({ data: { id: source.id, color, icon } });
      }
      return updateCalendarLook({ data: { source_id: source.id, color, icon } });
    },
    onSuccess: async () => {
      toast.success("Calendar appearance updated");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const manageMutation = useMutation({
    mutationFn: async (
      action:
        | { kind: "create"; name: string }
        | { kind: "rename"; id: string; name: string }
        | { kind: "archive"; id: string },
    ) => {
      if (action.kind === "create") {
        return createCalendar({
          data: {
            name: action.name,
            color: defaultCalendarColor(appearanceSources.length),
            icon: null,
            display_mode: "events",
          },
        });
      }
      if (action.kind === "rename") {
        return renameCalendar({ data: { source_id: action.id, name: action.name } });
      }
      return archiveCalendar({ data: { source_id: action.id } });
    },
    onSuccess: async (_r, action) => {
      toast.success(
        action.kind === "create"
          ? "Calendar created"
          : action.kind === "rename"
            ? "Calendar renamed"
            : "Calendar archived — its events are kept",
      );
      if (action.kind === "create") setNewName("");
      if (action.kind === "create") setCreateOfcOpen(false);
      setRenaming(null);
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const busy = mutation.isPending || lookMutation.isPending || manageMutation.isPending;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
        My Calendars
      </h3>
      <div className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card">
        {appearanceSources.map((source, index) => {
          const isFamily = source.provider === "local" && source.calendar_kind === "household_default";
          const isCustom = source.provider === "local" && source.calendar_kind === "custom";
          const editable = isFamily ? false : source.provider === "ics" ? canEdit : isOwner;
          const color = (source.color ?? defaultCalendarColor(index)) as MemberColor;
          const iconValue = source.display_icon ?? CALENDAR_ICON_NONE;
          const SelectedIcon = calendarIconComponent(source.display_icon);
          const isLocal = isFamily;
          const providerLabel =
            source.provider === "google" ? "Google" : source.provider === "ics" ? "Apple" : "OFC";
          const status = isFamily
            ? "Main household calendar"
            : isCustom
              ? "Created in Our Family Calendar"
              : source.provider === "ics"
                ? "Subscribed · read only"
                : "Connected";
          const background = source.display_mode === "coverage_background";
          const previewTint = background
            ? MUTED_CALENDAR_TINT[color]
            : styleForColor(color).soft;
          return (
            <div key={source.id} className="space-y-2 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn("h-6 w-6 shrink-0 rounded-lg", styleForColor(color).dot)}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  {renaming?.id === source.id ? (
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        manageMutation.mutate({ kind: "rename", id: source.id, name: renaming.name });
                      }}
                    >
                      <Input
                        value={renaming.name}
                        maxLength={60}
                        autoFocus
                        aria-label="Calendar name"
                        onChange={(e) => setRenaming({ id: source.id, name: e.target.value })}
                        className="h-8 text-sm"
                      />
                      <Button type="submit" size="sm" disabled={busy || !renaming.name.trim()}>
                        Save
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <p className="truncate text-sm font-semibold leading-snug">{source.name}</p>
                  )}
                  <p className="truncate text-[11px] text-muted-foreground">
                    {providerLabel} · {status}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0 rounded-lg px-2.5 text-xs"
                  aria-expanded={managedSourceId === source.id}
                  aria-controls={`calendar-management-${source.id}`}
                  onClick={() =>
                    setManagedSourceId((current) => (current === source.id ? null : source.id))
                  }
                >
                  <Settings2 className="h-3.5 w-3.5" aria-hidden />
                  Manage
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform",
                      managedSourceId === source.id && "rotate-180",
                    )}
                    aria-hidden
                  />
                </Button>
              </div>

              {managedSourceId === source.id ? (
                <div
                  id={`calendar-management-${source.id}`}
                  className="space-y-3 rounded-xl bg-surface-muted/60 p-3"
                >
                  {isFamily ? (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><p className="font-semibold">Display</p><p className="text-muted-foreground">Events</p></div>
                      <div><p className="font-semibold">Appearance</p><p className="text-muted-foreground">Household default</p></div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={source.display_mode}
                          disabled={!editable || busy}
                          onValueChange={(displayMode: DisplayMode) =>
                            mutation.mutate({ source, displayMode })
                          }
                        >
                          <SelectTrigger
                            className="h-9 w-40 rounded-lg text-xs"
                            aria-label={`Display style for ${source.name}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="events">Events (front)</SelectItem>
                            <SelectItem value="coverage_background">Background layer</SelectItem>
                          </SelectContent>
                        </Select>
                        <span
                          className={cn(
                            "flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold",
                            previewTint,
                            background && "text-muted-foreground",
                          )}
                        >
                          {SelectedIcon ? <SelectedIcon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                          <span className="truncate">{source.name}</span>
                        </span>
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        {background
                          ? "Sits softly behind family events"
                          : "Shows as a normal event card"}
                      </p>
                    </>
                  )}

                  {isLocal ? null : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {CALENDAR_COLORS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={!editable || busy}
                        aria-label={`Use the ${option} color for ${source.name}`}
                        aria-pressed={color === option}
                        onClick={() =>
                          lookMutation.mutate({
                            source,
                            color: option,
                            icon: source.display_icon ?? null,
                          })
                        }
                        className={cn(
                          "h-6 w-6 rounded-full ring-offset-2 transition disabled:opacity-50",
                          styleForColor(option).dot,
                          color === option ? "ring-2 ring-ring" : "",
                        )}
                      />
                    ))}
                  </div>
                  <Select
                    value={iconValue}
                    disabled={!editable || busy}
                    onValueChange={(next) =>
                      lookMutation.mutate({
                        source,
                        color,
                        icon: next === CALENDAR_ICON_NONE ? null : next,
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-9 w-36 rounded-lg text-xs"
                      aria-label={`Icon for ${source.name}`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {SelectedIcon ? <SelectedIcon className="h-3.5 w-3.5" aria-hidden /> : null}
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CALENDAR_ICON_NONE}>No icon</SelectItem>
                      {CALENDAR_ICON_KEYS.map((key) => {
                        const Icon = calendarIconComponent(key);
                        return (
                          <SelectItem key={key} value={key}>
                            <span className="flex items-center gap-2">
                              {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
                              {CALENDAR_ICON_LABELS[key]}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                    </div>
                  )}

                  {isCustom && isOwner ? (
                    <div className="flex flex-wrap gap-2 border-t border-border-soft pt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setRenaming({ id: source.id, name: source.name })}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        Rename
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Archive "${source.name}"? Its events stay on your calendar; you just can't add new ones to it.`,
                            )
                          ) {
                            manageMutation.mutate({ kind: "archive", id: source.id });
                          }
                        }}
                      >
                        <Archive className="h-3.5 w-3.5" aria-hidden />
                        Archive
                      </Button>
                    </div>
                  ) : null}
                  {source.provider === "google" ? (
                    <GoogleCalendarControls sourceId={source.id} />
                  ) : null}
                  {source.provider === "ics" ? (
                    <AppleCalendarControls sourceId={source.id} />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="space-y-3 pt-1">
        <GoogleAccountSettings />
        {canEdit ? (
          <Popover open={addMenuOpen} onOpenChange={setAddMenuOpen}>
            <PopoverTrigger asChild>
              <Button type="button" className="w-full sm:w-auto">
                <Plus className="h-4 w-4" aria-hidden /> Add calendar
                <ChevronDown className="h-4 w-4" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] space-y-1 p-1.5">
              {isOwner ? (
                <Button variant="ghost" className="w-full justify-start" onClick={() => { setAddMenuOpen(false); setCreateOfcOpen(true); }}>
                  <CalendarPlus className="h-4 w-4" aria-hidden /> Create OFC calendar
                </Button>
              ) : null}
              {isOwner ? (
                <>
                  <Button variant="ghost" className="w-full justify-start" onClick={() => { setAddMenuOpen(false); setGoogleAddMode("existing"); }}>
                    <Link2 className="h-4 w-4" aria-hidden /> Connect existing Google calendar
                  </Button>
                  <Button variant="ghost" className="w-full justify-start" onClick={() => { setAddMenuOpen(false); setGoogleAddMode("create"); }}>
                    <CalendarPlus className="h-4 w-4" aria-hidden /> Create new Google calendar
                  </Button>
                </>
              ) : null}
              <Button variant="ghost" className="w-full justify-start" onClick={() => { setAddMenuOpen(false); setAppleAddOpen(true); }}>
                <Apple className="h-4 w-4" aria-hidden /> Add Apple subscription
              </Button>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      <Dialog open={createOfcOpen} onOpenChange={setCreateOfcOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Create OFC calendar</DialogTitle></DialogHeader>
          <Input value={newName} maxLength={60} placeholder="Calendar name" aria-label="New calendar name" onChange={(event) => setNewName(event.target.value)} className="h-11" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOfcOpen(false)}>Cancel</Button>
            <Button disabled={busy || !newName.trim()} onClick={() => manageMutation.mutate({ kind: "create", name: newName })}>
              Create calendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <GoogleCalendarDialog open={googleAddMode !== null} onOpenChange={(open) => !open && setGoogleAddMode(null)} initialMode={googleAddMode ?? "existing"} />
      <AddAppleCalendarDialog open={appleAddOpen} onOpenChange={setAppleAddOpen} />
    </section>
  );
}
