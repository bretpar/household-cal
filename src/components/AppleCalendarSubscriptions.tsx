import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { Lock, RefreshCw, Trash2 } from "lucide-react";
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
import { MEMBER_COLORS, styleForColor, type MemberColor } from "@/lib/family-data";
import {
  addIcsSubscription,
  listIcsSubscriptions,
  refreshIcsSubscription,
  removeIcsSubscription,
} from "@/lib/ics.functions";
import { cn } from "@/lib/utils";

export const SUBSCRIPTIONS_KEY = ["apple-subscriptions"] as const;
const NO_MEMBER = "none";

function useAppleSubscriptions() {
  const list = useServerFn(listIcsSubscriptions);
  return useQuery({ queryKey: SUBSCRIPTIONS_KEY, queryFn: () => list() });
}

function useAppleInvalidate() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    await queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
  };
}

export function AppleCalendarControls({ sourceId }: { sourceId: string }) {
  const { canEdit } = useCalendar();
  const subscriptions = useAppleSubscriptions();
  const invalidate = useAppleInvalidate();
  const refresh = useServerFn(refreshIcsSubscription);
  const remove = useServerFn(removeIcsSubscription);
  const [removeOpen, setRemoveOpen] = useState(false);
  const row = subscriptions.data?.subscriptions.find((item) => item.id === sourceId);

  const refreshMutation = useMutation({
    mutationFn: () => refresh({ data: { id: sourceId } }),
    onSuccess: async () => { toast.success("Apple calendar refreshed"); await invalidate(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const removeMutation = useMutation({
    mutationFn: () => remove({ data: { id: sourceId } }),
    onSuccess: async () => { toast.success("Apple calendar removed"); setRemoveOpen(false); await invalidate(); },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!row) return null;
  return (
    <div className="space-y-2 border-t border-border-soft pt-3">
      <p className="flex items-center gap-1 text-xs font-semibold"><Lock className="h-3.5 w-3.5" aria-hidden /> Apple calendar · Read only</p>
      <p className="text-[11px] text-muted-foreground">
        {row.last_synced_at ? `Refreshed ${formatDistanceToNow(new Date(row.last_synced_at), { addSuffix: true })}` : "Not refreshed yet"}
      </p>
      {row.sync_error ? <p className="text-xs font-semibold text-destructive">{row.sync_error}</p> : null}
      {canEdit ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button size="sm" variant="outline" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshMutation.isPending && "animate-spin")} aria-hidden /> Refresh
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoveOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
          </Button>
        </div>
      ) : null}
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {row.name}?</DialogTitle>
            <DialogDescription>This removes its imported events here. Nothing is deleted from Apple Calendar.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate()}>
              {removeMutation.isPending ? "Removing…" : "Remove calendar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AddAppleCalendarDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { canEdit, members } = useCalendar();
  const add = useServerFn(addIcsSubscription);
  const invalidate = useAppleInvalidate();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<MemberColor>("lilac");
  const [memberId, setMemberId] = useState<string>(NO_MEMBER);

  const addMutation = useMutation({
    mutationFn: () => add({ data: { url, name, color, member_id: memberId === NO_MEMBER ? null : memberId } }),
    onSuccess: async (result) => {
      toast.success(result.imported > 0 ? `${name} connected · ${result.imported} events imported` : `${name} connected`);
      setUrl(""); setName(""); setMemberId(NO_MEMBER); onOpenChange(false);
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!canEdit) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an Apple calendar</DialogTitle>
          <DialogDescription>Paste its public Apple or iCloud sharing link. It stays read only.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="apple-url">Subscription link</Label><Input id="apple-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="webcal://p00-caldav.icloud.com/published/…" autoComplete="off" className="h-11" /></div>
          <div className="space-y-1.5"><Label htmlFor="apple-name">Calendar name</Label><Input id="apple-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Work calendar" className="h-11" /></div>
          <div className="space-y-1.5">
            <Label htmlFor="apple-member">Family member</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger id="apple-member" className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NO_MEMBER}>Nobody in particular</SelectItem>{members.filter((member) => member.active).map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Event color</Label>
            <div className="flex flex-wrap gap-2">{MEMBER_COLORS.map((option) => <button key={option} type="button" aria-label={`Use the ${option} color`} aria-pressed={color === option} onClick={() => setColor(option)} className={cn("h-9 w-9 rounded-full ring-offset-2 transition", styleForColor(option).dot, color === option && "ring-2 ring-ring")} />)}</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={addMutation.isPending || !url.trim() || !name.trim()} onClick={() => addMutation.mutate()}>{addMutation.isPending ? "Connecting…" : "Connect"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Kept as a compatibility wrapper for any older call sites. */
export function AppleCalendarSubscriptions() {
  return null;
}
