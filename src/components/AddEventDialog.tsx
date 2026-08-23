import { useState } from "react";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";
import {
  EVENT_TYPES,
  FAMILY_MEMBERS,
  RECURRENCE_OPTIONS,
  memberStyles,
  type EventType,
  type MemberId,
} from "@/lib/family-data";

function combine(date: string, time: string) {
  return new Date(`${date}T${time || "00:00"}`).toISOString();
}

export function AddEventDialog({
  defaultDate,
  className,
}: {
  defaultDate?: Date;
  className?: string;
}) {
  const { addEvent } = useCalendar();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(format(defaultDate ?? new Date(), "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState("16:00");
  const [endTime, setEndTime] = useState("17:00");
  const [allDay, setAllDay] = useState(false);
  const [members, setMembers] = useState<MemberId[]>([]);
  const [eventType, setEventType] = useState<EventType>("activity");
  const [recurrence, setRecurrence] = useState<string>("none");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setTitle("");
    setMembers([]);
    setLocation("");
    setNotes("");
    setRecurrence("none");
    setAllDay(false);
  };

  const submit = () => {
    if (!title.trim()) {
      toast.error("Please add an event name");
      return;
    }
    if (members.length === 0) {
      toast.error("Choose at least one family member");
      return;
    }
    const rule = RECURRENCE_OPTIONS.find((r) => r.id === recurrence)?.rule ?? null;
    addEvent({
      title: title.trim(),
      start_at: allDay ? combine(date, "00:00") : combine(date, startTime),
      end_at: allDay ? combine(date, "23:59") : combine(date, endTime),
      all_day: allDay,
      location: location.trim() || null,
      notes: notes.trim() || null,
      event_type: eventType,
      recurrence_rule: rule,
      source_calendar: "parker_family",
      member_ids: members,
    });
    toast.success(`${title.trim()} added to the family calendar`);
    reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className={cn("h-11 rounded-full px-5 font-bold", className)}>
          <Plus className="h-4 w-4" />
          Add Event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an event</DialogTitle>
          <DialogDescription>Everything the family needs to know.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="event-name">Event name</Label>
            <Input
              id="event-name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Soccer practice"
              className="h-11 rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-date">Date</Label>
            <Input
              id="event-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2.5">
            <Label htmlFor="all-day" className="font-semibold">
              All-day event
            </Label>
            <Switch id="all-day" checked={allDay} onCheckedChange={setAllDay} />
          </div>

          {!allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start-time">Start time</Label>
                <Input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-time">End time</Label>
                <Input
                  id="end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Who?</Label>
            <div className="flex flex-wrap gap-2">
              {FAMILY_MEMBERS.map((member) => {
                const on = members.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setMembers((prev) =>
                        prev.includes(member.id)
                          ? prev.filter((m) => m !== member.id)
                          : [...prev, member.id],
                      )
                    }
                    className={cn(
                      "flex h-11 items-center gap-2 rounded-full pr-4 pl-1.5 text-sm font-semibold transition-all",
                      on
                        ? cn(memberStyles[member.id].soft, "ring-2", memberStyles[member.id].ring)
                        : "bg-surface-muted text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                        memberStyles[member.id].badge,
                        !on && "opacity-60",
                      )}
                    >
                      {member.initial}
                    </span>
                    {member.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Event type</Label>
              <Select value={eventType} onValueChange={(v) => setEventType(v as EventType)}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Repeats</Label>
              <Select value={recurrence} onValueChange={setRecurrence}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECURRENCE_OPTIONS.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Riverside Fields"
              className="h-11 rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else the family should know"
              className="min-h-20 rounded-xl"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="h-11 rounded-full"
            onClick={() => setOpen(false)}
            type="button"
          >
            Cancel
          </Button>
          <Button className="h-11 rounded-full px-6 font-bold" onClick={submit} type="button">
            Save event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
