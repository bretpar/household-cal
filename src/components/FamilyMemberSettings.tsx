import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Users } from "lucide-react";
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
import { FAMILY_BUNDLE_KEY, useCalendar } from "@/lib/calendar-store";
import { MEMBER_COLORS, styleForColor, type FamilyMember, type MemberColor } from "@/lib/family-data";
import { saveFamilyMemberFn } from "@/lib/settings.functions";
import { cn } from "@/lib/utils";

const ROLES = [
  { id: "parent", label: "Parent" },
  { id: "child", label: "Child" },
  { id: "caregiver", label: "Caregiver" },
  { id: "other", label: "Other" },
];

interface Draft {
  id: string | null;
  name: string;
  initial: string;
  color: MemberColor;
  role: string;
  access: string;
  active: boolean;
}

function draftFrom(member: FamilyMember | null): Draft {
  return {
    id: member?.id ?? null,
    name: member?.name ?? "",
    initial: member?.initial ?? "",
    color: (member?.color as MemberColor) ?? "sky",
    role: member?.role ?? "child",
    access: member?.access ?? "view_only",
    active: member?.active ?? true,
  };
}

/**
 * Maintains the family-member records created during onboarding. Editing keeps
 * the record's id, so historical event assignments are untouched; people are
 * deactivated rather than deleted.
 */
export function FamilyMemberSettings() {
  const { members, isOwner } = useCalendar();
  const queryClient = useQueryClient();
  const save = useServerFn(saveFamilyMemberFn);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const activeCount = members.filter((m) => m.active).length;

  const submit = () =>
    runGuardedMutation({
      busy,
      setBusy,
      perform: async () => {
        if (!draft) return;
        await save({ data: draft });
        await queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
      },
      onSuccess: () => {
        toast.success(draft?.id ? "Family member updated" : "Family member added");
        setDraft(null);
      },
      onError: toast.error,
      errorFallback: "Could not save this family member.",
    });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
          <Users className="h-4 w-4" aria-hidden />
          Family members · {activeCount} active
        </h2>
        {isOwner ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-9 rounded-full font-bold"
            onClick={() => setDraft(draftFrom(null))}
          >
            <Plus className="h-4 w-4" />
            Add member
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {members.map((member) => (
          <article
            key={member.id}
            className={cn(
              "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl border border-border-soft bg-card p-4 shadow-soft",
              !member.active && "opacity-60",
            )}
          >
            <span
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full text-base font-bold",
                styleForColor(member.color).badge,
              )}
            >
              {member.initial}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold">{member.name}</h3>
              <p className="text-xs font-semibold text-muted-foreground capitalize">
                {member.role}
                {member.active ? "" : " · inactive"}
              </p>
            </div>
            {isOwner ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 rounded-full font-bold"
                onClick={() => setDraft(draftFrom(member))}
              >
                Edit
              </Button>
            ) : null}
          </article>
        ))}
      </div>

      <Dialog open={draft !== null} onOpenChange={(next) => (next ? null : setDraft(null))}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit family member" : "Add family member"}</DialogTitle>
            <DialogDescription>
              Member colors are used for the small initial badge and stay separate from category
              colors.
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="member-name">Name</Label>
                <Input
                  id="member-name"
                  value={draft.name}
                  onChange={(e) => set("name", e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="member-initial">Initial</Label>
                <Input
                  id="member-initial"
                  value={draft.initial}
                  maxLength={2}
                  onChange={(e) => set("initial", e.target.value.toUpperCase())}
                  className="h-11 w-24 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2">
                  {MEMBER_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      aria-pressed={draft.color === color}
                      onClick={() => set("color", color)}
                      className={cn(
                        "h-9 w-9 rounded-full transition-all",
                        styleForColor(color).dot,
                        draft.color === color ? "ring-2 ring-primary ring-offset-2" : "opacity-70",
                      )}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={draft.role} onValueChange={(v) => set("role", v)}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2.5">
                <div className="min-w-0 pr-3">
                  <Label htmlFor="member-active" className="font-semibold">
                    Active
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Turn off to archive someone. Past events keep their assignment.
                  </p>
                </div>
                <Switch
                  id="member-active"
                  checked={draft.active}
                  onCheckedChange={(v) => set("active", v)}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="ghost"
              className="h-11 rounded-full"
              onClick={() => setDraft(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              className="h-11 rounded-full px-6 font-bold"
              onClick={() => void submit()}
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
