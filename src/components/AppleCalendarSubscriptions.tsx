import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { Apple, Lock, RefreshCw, Trash2 } from "lucide-react";
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
import { FAMILY_BUNDLE_KEY, useCalendar } from "@/lib/calendar-store";
import {
  MEMBER_COLORS,
  styleForColor,
  type MemberColor,
} from "@/lib/family-data";
import {
  addIcsSubscription,
  listIcsSubscriptions,
  refreshIcsSubscription,
  removeIcsSubscription,
} from "@/lib/ics.functions";
import { cn } from "@/lib/utils";

const SUBSCRIPTIONS_KEY = ["apple-subscriptions"] as const;
const NO_MEMBER = "none";

/**
 * Read-only Apple/iCloud calendar subscriptions.
 *
 * A temporary bridge until native iOS calendar sync exists: the household pastes
 * a share link, the server reads it on a schedule, and the events appear here as
 * read-only entries. Nothing is ever written back to Apple, and Google sync is
 * completely untouched by this panel.
 */
export function AppleCalendarSubscriptions() {
  const queryClient = useQueryClient();
  const { canEdit, members } = useCalendar();

  const list = useServerFn(listIcsSubscriptions);
  const add = useServerFn(addIcsSubscription);
  const refresh = useServerFn(refreshIcsSubscription);
  const remove = useServerFn(removeIcsSubscription);

  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<MemberColor>("lilac");
  const [memberId, setMemberId] = useState<string>(NO_MEMBER);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  const subscriptions = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: () => list(),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    await queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      add({
        data: {
          url,
          name,
          color,
          member_id: memberId === NO_MEMBER ? null : memberId,
        },
      }),
    onSuccess: async (result) => {
      toast.success(
        result.imported > 0
          ? `${name} connected · ${result.imported} events imported`
          : `${name} connected`,
      );
      setAdding(false);
      setUrl("");
      setName("");
      setMemberId(NO_MEMBER);
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refreshMutation = useMutation({
    mutationFn: (id: string) => refresh({ data: { id } }),
    onSuccess: async () => {
      toast.success("Apple calendar refreshed");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: async () => {
      toast.success("Apple calendar removed");
      setRemoveTarget(null);
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = subscriptions.data?.subscriptions ?? [];

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
        <Apple className="h-4 w-4" aria-hidden />
        Apple Calendar Subscription
      </h2>
      <p className="text-xs text-muted-foreground">
        Paste an Apple or iCloud calendar share link to see those events here. They stay read only —
        changes are made in Apple Calendar and appear here within about half an hour.
      </p>

      <div className="space-y-3">
        {subscriptions.isPending ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface-muted/50 p-4 text-xs text-muted-foreground">
            No Apple calendars connected yet.
          </p>
        ) : (
          rows.map((row) => (
            <article
              key={row.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl border border-border-soft bg-card p-4"
            >
              <span
                className={cn("h-8 w-8 shrink-0 rounded-xl", styleForColor(row.color ?? undefined).dot)}
                aria-hidden
              />
              <div className="min-w-0 space-y-2">
                <h3 className="truncate text-base font-bold">{row.name}</h3>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Lock className="h-3 w-3" aria-hidden />
                    Read only
                  </span>
                  {row.member_id ? (
                    <span>· {members.find((m) => m.id === row.member_id)?.name ?? "Member"}</span>
                  ) : null}
                  {row.last_synced_at ? (
                    <span>
                      · Refreshed {formatDistanceToNow(new Date(row.last_synced_at), { addSuffix: true })}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{row.hint}</p>
                {row.sync_error ? (
                  <p className="mt-1 text-[11px] font-semibold text-destructive">{row.sync_error}</p>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={`Refresh ${row.name}`}
                    title="Refresh now"
                    className="h-9 w-9 rounded-full"
                    disabled={refreshMutation.isPending}
                    onClick={() => refreshMutation.mutate(row.id)}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={`Remove ${row.name}`}
                    title="Remove"
                    className="h-9 w-9 rounded-full text-destructive"
                    onClick={() => setRemoveTarget({ id: row.id, name: row.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </article>
          ))
        )}

        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full rounded-full font-bold"
            onClick={() => setAdding(true)}
          >
            <Apple className="h-4 w-4" aria-hidden />
            Add Apple calendar
          </Button>
        ) : null}
      </div>

      <Dialog open={adding} onOpenChange={(next) => (next ? null : setAdding(false))}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add an Apple calendar</DialogTitle>
            <DialogDescription>
              In Apple Calendar, share the calendar publicly and copy its link, then paste it here.
              The link is stored securely and is not shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="apple-url">Subscription link</Label>
              <Input
                id="apple-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="webcal://p00-caldav.icloud.com/published/…"
                autoComplete="off"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apple-name">Calendar name</Label>
              <Input
                id="apple-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Work calendar"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apple-member">Family member</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger id="apple-member" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MEMBER}>Nobody in particular</SelectItem>
                  {members
                    .filter((m) => m.active)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Event color</Label>
              <div className="flex flex-wrap gap-2">
                {MEMBER_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={`Use the ${option} color`}
                    aria-pressed={color === option}
                    onClick={() => setColor(option)}
                    className={cn(
                      "h-9 w-9 rounded-full ring-offset-2 transition",
                      styleForColor(option).dot,
                      color === option ? "ring-2 ring-ring" : "",
                    )}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" className="rounded-xl" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl"
              disabled={addMutation.isPending || !url.trim() || !name.trim()}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removeTarget} onOpenChange={(next) => (next ? null : setRemoveTarget(null))}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.name}?</DialogTitle>
            <DialogDescription>
              This will remove all events imported from this Apple calendar from Our Family Calendar.
              Nothing will be deleted from Apple Calendar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-xl" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl"
              disabled={removeMutation.isPending}
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
            >
              {removeMutation.isPending ? "Removing…" : "Remove calendar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
