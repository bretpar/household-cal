import { createFileRoute } from "@tanstack/react-router";
import { CalendarCog } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { SettingsSection } from "@/components/SettingsSection";
import { CALENDAR_VIEW_LABEL, type CalendarViewMode } from "@/lib/calendar-view-preference";
import { cn } from "@/lib/utils";
import { useUserPreferences, type WeekStart } from "@/lib/user-preferences";

export const Route = createFileRoute("/_authenticated/preferences")({
  head: () => ({
    meta: [
      { title: "Preferences — Parker Family Calendar" },
      {
        name: "description",
        content:
          "Choose whether your weeks start on Monday or Sunday and which calendar view opens first. Saved to your account.",
      },
      { property: "og:title", content: "Preferences — Parker Family Calendar" },
      {
        property: "og:description",
        content: "Your week start day and default calendar view, synced to every device you use.",
      },
    ],
  }),
  component: PreferencesPage,
});

const WEEK_START_OPTIONS: { value: WeekStart; label: string }[] = [
  { value: 1, label: "Monday" },
  { value: 0, label: "Sunday" },
];

function OptionGroup<T extends string | number>({
  label,
  options,
  current,
  disabled,
  onSelect,
}: {
  label: string;
  options: { value: T; label: string }[];
  current: T;
  disabled?: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="flex rounded-full bg-surface-muted p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          disabled={disabled}
          aria-pressed={current === option.value}
          onClick={() => onSelect(option.value)}
          className={cn(
            "h-10 min-w-20 rounded-full px-4 text-sm font-semibold transition-colors",
            current === option.value ? "bg-surface text-foreground shadow-soft" : "text-muted-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PreferencesPage() {
  const { weekStart, defaultView, ready, savePreferences } = useUserPreferences();

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold sm:text-3xl">Preferences</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            These settings are saved to your account, so they follow you on every phone, iPad and
            computer you sign in on.
          </p>
        </header>

        <SettingsSection
          title="Calendar Display"
          description="How your weeks are laid out and which view opens first"
          icon={<CalendarCog className="h-4 w-4" aria-hidden />}
        >
          <div className="divide-y divide-border-soft overflow-hidden rounded-3xl border border-border-soft bg-card">
            <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-bold">Week starts on</p>
                <p className="text-xs text-muted-foreground">
                  Applies to the Month grid and the full Week view, including when you page forward
                  and back.
                </p>
              </div>
              <OptionGroup
                label="Week starts on"
                options={WEEK_START_OPTIONS}
                current={weekStart}
                disabled={!ready}
                onSelect={(value) => void savePreferences({ weekStart: value })}
              />
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-bold">Default calendar view</p>
                <p className="text-xs text-muted-foreground">
                  The Calendar page opens on this view.
                </p>
              </div>
              <OptionGroup
                label="Default calendar view"
                options={(["day", "week", "month"] as CalendarViewMode[]).map((value) => ({
                  value,
                  label: CALENDAR_VIEW_LABEL[value],
                }))}
                current={defaultView}
                disabled={!ready}
                onSelect={(value) => void savePreferences({ defaultView: value })}
              />
            </div>
          </div>
        </SettingsSection>
      </div>
    </AppShell>
  );
}
