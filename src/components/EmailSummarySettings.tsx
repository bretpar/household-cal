import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, Plus, Send, Trash2, UserPlus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { runGuardedMutation } from "@/lib/async-submit";
import { useCalendar } from "@/lib/calendar-store";
import {
  deleteEmailRecipient,
  deleteEmailSchedule,
  getEmailSummarySettings,
  saveEmailRecipient,
  saveEmailSchedule,
  sendEmailSummaryPreview,
  setEmailScheduleEnabled,
} from "@/lib/email-summaries.functions";
import { cn } from "@/lib/utils";

const SUMMARY_KEY = ["email-summaries"] as const;

const FREQUENCY_LABEL: Record<string, string> = {
  daily: "Daily — the next day's activities",
  weekly: "Weekly — the upcoming Mon–Sun week",
  monthly: "Monthly — the upcoming month",
};

const FREQUENCY_HINT: Record<string, string> = {
  daily: "Sends the evening before, covering the next calendar day.",
  weekly: "Sends on Sunday, covering Monday through Sunday.",
  monthly: "Sends three days before the month starts, covering the whole month.",
};

const DEFAULT_TIME: Record<string, string> = {
  daily: "18:00",
  weekly: "18:00",
  monthly: "18:00",
};

interface RecipientDraft {
  id?: string | null;
  schedule_id: string;
  name: string;
  email: string;
  family_member_id: string | null;
  calendar_source_ids: string[];
  resubscribe?: boolean;
}

export function EmailSummarySettings() {
  const { isOwner, sources, members, family } = useCalendar();
  const queryClient = useQueryClient();
  const load = useServerFn(getEmailSummarySettings);
  const saveSchedule = useServerFn(saveEmailSchedule);
  const toggleSchedule = useServerFn(setEmailScheduleEnabled);
  const removeSchedule = useServerFn(deleteEmailSchedule);
  const saveRecipient = useServerFn(saveEmailRecipient);
  const removeRecipient = useServerFn(deleteEmailRecipient);
  const sendPreview = useServerFn(sendEmailSummaryPreview);

  const [busy, setBusy] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<
    | null
    | {
        id?: string | null;
        name: string;
        frequency: string;
        send_time: string;
      }
  >(null);
  const [recipientDraft, setRecipientDraft] = useState<RecipientDraft | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: () => load({}),
    enabled: isOwner,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
  const selectableSources = sources.filter((s) => s.active);

  if (!isOwner) return null;

  const openNewSchedule = () =>
    setScheduleDraft({ name: "", frequency: "weekly", send_time: DEFAULT_TIME["weekly"]! });

  const persistSchedule = () =>
    runGuardedMutation({
      busy,
      setBusy,
      perform: async () => {
        await saveSchedule({ data: scheduleDraft! as never });
        await refresh();
      },
      onSuccess: () => {
        toast.success(scheduleDraft?.id ? "Schedule updated" : "Schedule created — add recipients");
        setScheduleDraft(null);
      },
      onError: toast.error,
      errorFallback: "Could not save the schedule.",
    });

  const persistRecipient = () =>
    runGuardedMutation({
      busy,
      setBusy,
      perform: async () => {
        await saveRecipient({ data: { ...recipientDraft!, resubscribe: true } as never });
        await refresh();
      },
      onSuccess: () => {
        toast.success("Recipient saved");
        setRecipientDraft(null);
      },
      onError: toast.error,
      errorFallback: "Could not save the recipient.",
    });

  const act = (perform: () => Promise<unknown>, message: string, fallback: string) =>
    runGuardedMutation({
      busy,
      setBusy,
      perform: async () => {
        await perform();
        await refresh();
      },
      onSuccess: () => toast.success(message),
      onError: toast.error,
      errorFallback: fallback,
    });

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <Mail className="h-5 w-5 text-primary" /> Email Summaries
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Send the schedule ahead to family, sitters or grandparents. Each recipient only sees the
            calendars you pick for them, in {data?.timezone ?? "your household"} time.
          </p>
        </div>
        <Button onClick={openNewSchedule} className="rounded-full">
          <Plus className="mr-1.5 h-4 w-4" /> New summary
        </Button>
      </div>

      {isLoading && <p className="mt-5 text-sm text-muted-foreground">Loading summaries…</p>}

      {!isLoading && (data?.schedules?.length ?? 0) === 0 && (
        <p className="mt-5 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
          No summaries yet. Create one to email {family?.name ?? "your household"}'s upcoming
          schedule automatically.
        </p>
      )}

      <div className="mt-5 space-y-4">
        {(data?.schedules ?? []).map((schedule) => (
          <div key={schedule.id} className="rounded-xl border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold">{schedule.name}</p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      schedule.enabled
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {schedule.enabled ? "Enabled" : "Paused"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {FREQUENCY_LABEL[schedule.frequency]} · sends at {schedule.send_time}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {FREQUENCY_HINT[schedule.frequency]}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Switch
                  checked={schedule.enabled}
                  aria-label={schedule.enabled ? "Pause summary" : "Enable summary"}
                  onCheckedChange={(next) =>
                    act(
                      () => toggleSchedule({ data: { id: schedule.id, enabled: next } }),
                      next ? "Summary enabled" : "Summary paused",
                      "Could not change the schedule.",
                    )
                  }
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() =>
                    setScheduleDraft({
                      id: schedule.id,
                      name: schedule.name,
                      frequency: schedule.frequency,
                      send_time: schedule.send_time,
                    })
                  }
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() =>
                    act(
                      async () => {
                        const result = await sendPreview({
                          data: { schedule_id: schedule.id },
                        });
                        if (!result.sent) throw new Error("The preview email could not be sent.");
                      },
                      "Preview sent to your email",
                      "Could not send the preview.",
                    )
                  }
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" /> Send preview
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${schedule.name}`}
                  onClick={() =>
                    act(
                      () => removeSchedule({ data: { id: schedule.id } }),
                      "Summary deleted",
                      "Could not delete the summary.",
                    )
                  }
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {schedule.recipients.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No recipients yet — add one to enable this summary.
                </p>
              )}
              {schedule.recipients.map((recipient) => (
                <div
                  key={recipient.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {recipient.name}
                      {recipient.unsubscribed_at && (
                        <span className="ml-2 text-xs font-medium text-muted-foreground">
                          unsubscribed
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {recipient.email} ·{" "}
                      {recipient.calendar_source_ids.length === 0
                        ? "main calendar only"
                        : `${recipient.calendar_source_ids.length} calendar${
                            recipient.calendar_source_ids.length === 1 ? "" : "s"
                          }`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      onClick={() =>
                        setRecipientDraft({
                          id: recipient.id,
                          schedule_id: schedule.id,
                          name: recipient.name,
                          email: recipient.email,
                          family_member_id: recipient.family_member_id,
                          calendar_source_ids: recipient.calendar_source_ids,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${recipient.name}`}
                      onClick={() =>
                        act(
                          () => removeRecipient({ data: { id: recipient.id } }),
                          "Recipient removed",
                          "Could not remove the recipient.",
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() =>
                  setRecipientDraft({
                    schedule_id: schedule.id,
                    name: "",
                    email: "",
                    family_member_id: null,
                    calendar_source_ids: [],
                  })
                }
              >
                <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Add recipient
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={scheduleDraft !== null} onOpenChange={(open) => !open && setScheduleDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{scheduleDraft?.id ? "Edit summary" : "New summary"}</DialogTitle>
            <DialogDescription>
              Pick how often it sends and what time. Times use your household timezone and follow
              daylight saving automatically.
            </DialogDescription>
          </DialogHeader>
          {scheduleDraft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="summary-name">Name</Label>
                <Input
                  id="summary-name"
                  value={scheduleDraft.name}
                  placeholder="Babysitter Weekly Schedule"
                  onChange={(e) => setScheduleDraft({ ...scheduleDraft, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select
                  value={scheduleDraft.frequency}
                  onValueChange={(frequency) =>
                    setScheduleDraft({
                      ...scheduleDraft,
                      frequency,
                      send_time: DEFAULT_TIME[frequency] ?? scheduleDraft.send_time,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {FREQUENCY_HINT[scheduleDraft.frequency]}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="summary-time">Send time</Label>
                <Input
                  id="summary-time"
                  type="time"
                  value={scheduleDraft.send_time}
                  onChange={(e) =>
                    setScheduleDraft({ ...scheduleDraft, send_time: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleDraft(null)}>
              Cancel
            </Button>
            <Button onClick={persistSchedule} disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={recipientDraft !== null}
        onOpenChange={(open) => !open && setRecipientDraft(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{recipientDraft?.id ? "Edit recipient" : "Add recipient"}</DialogTitle>
            <DialogDescription>
              Choose which calendars this person's email includes. Everyone gets their own email.
            </DialogDescription>
          </DialogHeader>
          {recipientDraft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Household member (optional)</Label>
                <Select
                  value={recipientDraft.family_member_id ?? "manual"}
                  onValueChange={(value) => {
                    const member = members.find((m) => m.id === value);
                    setRecipientDraft({
                      ...recipientDraft,
                      family_member_id: value === "manual" ? null : value,
                      name: member?.name ?? recipientDraft.name,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Someone else (name + email)</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recipient-name">Name</Label>
                <Input
                  id="recipient-name"
                  value={recipientDraft.name}
                  placeholder="Grandma Parker"
                  onChange={(e) => setRecipientDraft({ ...recipientDraft, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="recipient-email">Email</Label>
                <Input
                  id="recipient-email"
                  type="email"
                  value={recipientDraft.email}
                  placeholder="name@example.com"
                  onChange={(e) => setRecipientDraft({ ...recipientDraft, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Calendars in this email</Label>
                {selectableSources.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No calendars yet — the main household calendar is used.
                  </p>
                )}
                <div className="space-y-1.5">
                  {selectableSources.map((source) => {
                    const checked = recipientDraft.calendar_source_ids.includes(source.id);
                    return (
                      <label
                        key={source.id}
                        className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={checked}
                          onChange={() =>
                            setRecipientDraft({
                              ...recipientDraft,
                              calendar_source_ids: checked
                                ? recipientDraft.calendar_source_ids.filter(
                                    (id) => id !== source.id,
                                  )
                                : [...recipientDraft.calendar_source_ids, source.id],
                            })
                          }
                        />
                        <span className="truncate">{source.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave all unchecked to send just the main household calendar.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecipientDraft(null)}>
              Cancel
            </Button>
            <Button onClick={persistRecipient} disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
