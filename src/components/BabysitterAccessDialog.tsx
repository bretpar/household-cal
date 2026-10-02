import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getBabysitterSetup, setBabysitterAccess } from "@/lib/household.functions";
import { FAMILY_BUNDLE_KEY } from "@/lib/calendar-store";
import { IS_CAREGIVER_KEY } from "@/lib/use-caregiver";

export const BABYSITTER_SETUP_KEY = ["babysitter-setup"] as const;

/** Refetch everything whose visible data depends on caregiver access. */
export function invalidateAccessQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: BABYSITTER_SETUP_KEY }),
    queryClient.invalidateQueries({ queryKey: ["household-access"] }),
    queryClient.invalidateQueries({ queryKey: IS_CAREGIVER_KEY }),
    queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY }),
    queryClient.invalidateQueries({ queryKey: ["shift-settings"] }),
  ]);
}

export function useBabysitterSetup(enabled: boolean) {
  const fetchSetup = useServerFn(getBabysitterSetup);
  return useQuery({ queryKey: BABYSITTER_SETUP_KEY, queryFn: () => fetchSetup(), enabled });
}

export function BabysitterAccessDialog({
  open,
  onOpenChange,
  membershipId,
  label,
  linkedMemberId,
  prepareSave,
  onSaved,
  loginEmail,
}: {
  loginEmail?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membershipId: string;
  label: string;
  linkedMemberId: string | null;
  prepareSave?: () => Promise<unknown>;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const setup = useBabysitterSetup(true);
  const save = useServerFn(setBabysitterAccess);
  const profile = setup.data?.profiles.find((p) => p.family_user_id === membershipId);

  const [memberId, setMemberId] = useState<string>("");
  const [scope, setScope] = useState<"shift_days_only" | "all_permitted">("shift_days_only");
  const [calendarIds, setCalendarIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setMemberId(linkedMemberId ?? "");
    setScope(profile?.date_scope ?? "shift_days_only");
    setCalendarIds(profile?.calendar_ids ?? []);
  }, [open, profile, linkedMemberId]);

  const mutation = useMutation({
    mutationFn: async () => {
      await prepareSave?.();
      return save({
        data: {
          membership_id: membershipId,
          enabled: true,
          family_member_id: memberId || null,
          date_scope: scope,
          calendar_ids: calendarIds,
        },
      });
    },
    onSuccess: async () => {
      await invalidateAccessQueries(queryClient);
      onSaved();
      onOpenChange(false);
      toast.success("Babysitter access saved");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{linkedMemberId ? "Manage app access" : `Babysitter access · ${label}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {linkedMemberId ? (
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border-soft bg-surface-muted/50 p-3 text-sm">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">Caregiver</p>
                <p className="truncate font-bold">{label}</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">Login</p>
                <p className="truncate font-bold">{loginEmail ?? "Linked login"}</p>
                <p className="text-xs text-muted-foreground">Access active</p>
              </div>
            </div>
          ) : null}
          <BabysitterConfigFields
            hideMember={!!linkedMemberId}
            name={linkedMemberId ? label : undefined}
            setup={setup.data}
            memberId={memberId}
            setMemberId={setMemberId}
            scope={scope}
            setScope={setScope}
            calendarIds={calendarIds}
            setCalendarIds={setCalendarIds}
          />
          {!profile ? (
            <p className="text-xs text-muted-foreground">
              Privacy note: this person already has full Viewer access and may have seen the whole
              calendar. To give a new babysitter restricted access from the start, invite them as a
              Babysitter instead.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            className="h-11 w-full rounded-full font-bold"
            disabled={mutation.isPending || !memberId}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Scope = "shift_days_only" | "all_permitted";

export function BabysitterConfigFields({
  setup,
  memberId,
  setMemberId,
  scope,
  setScope,
  calendarIds,
  setCalendarIds,
  hideMember = false,
  name,
}: {
  name?: string | undefined;
  hideMember?: boolean;
  setup: { calendars: { id: string; name: string }[]; family_members: { id: string; name: string }[] } | undefined;
  memberId: string;
  setMemberId: (v: string) => void;
  scope: Scope;
  setScope: (v: Scope) => void;
  calendarIds: string[];
  setCalendarIds: (fn: (prev: string[]) => string[]) => void;
}) {
  const toggleCalendar = (id: string, on: boolean) =>
    setCalendarIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((c) => c !== id)));
  return (
    <>
      {hideMember ? null : <div className="space-y-1.5">
        <Label htmlFor="babysitter-member">Family member</Label>
        <Select value={memberId} onValueChange={setMemberId}>
          <SelectTrigger id="babysitter-member" className="h-11 rounded-xl">
            <SelectValue placeholder="Choose who this is" />
          </SelectTrigger>
          <SelectContent>
            {(setup?.family_members ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>}
      <div className="space-y-2">
        <p className="text-sm font-semibold">Calendar access</p>
        {(setup?.calendars ?? []).map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={calendarIds.includes(c.id)}
              onCheckedChange={(v) => toggleCalendar(c.id, v === true)}
            />
            {c.name}
          </label>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Schedule visibility</p>
        <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)}>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="shift_days_only" /> Only days {name ?? "they"} babysit{name ? "s" : ""}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="all_permitted" /> All permitted calendar dates
          </label>
        </RadioGroup>
      </div>
    </>
  );
}
