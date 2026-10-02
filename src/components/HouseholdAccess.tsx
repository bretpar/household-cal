import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleCheck, Clock3, Copy, MailPlus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  BABYSITTER_SETUP_KEY,
  BabysitterAccessDialog,
  BabysitterConfigFields,
  useBabysitterSetup,
} from "@/components/BabysitterAccessDialog";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
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
import {
  getHouseholdAccess,
  inviteHouseholdUser,
  removeHouseholdUser,
  resendHouseholdInvitation,
  revokeHouseholdInvitation,
  setBabysitterAccess,
  setHouseholdRole,
} from "@/lib/household.functions";

const ROLE_HINT: Record<string, string> = {
  owner: "Owner · manages everything",
  editor: "Editor · can add and edit",
  viewer: "Viewer · view only",
};

const HOUSEHOLD_ACCESS_KEY = ["household-access"] as const;

export function HouseholdAccess() {
  const queryClient = useQueryClient();
  const fetchAccess = useServerFn(getHouseholdAccess);
  const invite = useServerFn(inviteHouseholdUser);
  const revoke = useServerFn(revokeHouseholdInvitation);
  const resend = useServerFn(resendHouseholdInvitation);
  const changeRole = useServerFn(setHouseholdRole);
  const removeUser = useServerFn(removeHouseholdUser);
  const saveBabysitter = useServerFn(setBabysitterAccess);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [bsMember, setBsMember] = useState("");
  const [bsScope, setBsScope] = useState<"shift_days_only" | "all_permitted">("shift_days_only");
  const [bsCalendars, setBsCalendars] = useState<string[]>([]);
  const [configuringMembershipId, setConfiguringMembershipId] = useState<string | null>(null);
  const [removingBabysitterId, setRemovingBabysitterId] = useState<string | null>(null);
  const isBabysitterInvite = role === "babysitter";

  const access = useQuery({ queryKey: HOUSEHOLD_ACCESS_KEY, queryFn: () => fetchAccess() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: HOUSEHOLD_ACCESS_KEY });

  const isOwner = access.data?.my_role === "owner";
  const babysitterSetup = useBabysitterSetup(Boolean(isOwner));
  const ownerCount = (access.data?.memberships ?? []).filter((m) => m.role === "owner").length;

  const copyLink = async (token: string) => {
    const link = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invitation link copied");
    } catch {
      toast.info(link);
    }
  };

  const inviteMutation = useMutation({
    mutationFn: () =>
      invite({
        data: {
          email,
          role: isBabysitterInvite ? "viewer" : role,
          babysitter: isBabysitterInvite
            ? { family_member_id: bsMember, date_scope: bsScope, calendar_ids: bsCalendars }
            : null,
        },
      }),
    onSuccess: async (result) => {
      const sentTo = email;
      setOpen(false);
      setEmail("");
      setRole("viewer");
      setBsMember("");
      setBsScope("shift_days_only");
      setBsCalendars([]);
      await refresh();
      if (result?.emailed) {
        toast.success(`Invitation emailed to ${sentTo}`);
      } else {
        toast.info("Invitation created — email could not be sent, link copied instead");
        if (result?.token) void copyLink(result.token);
      }
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Could not send the invitation"),
  });


  const revokeMutation = useMutationLike(
    (id: string) => revoke({ data: { invitation_id: id } }),
    "Invitation revoked",
    refresh,
  );
  const resendMutation = useMutation({
    mutationFn: (id: string) => resend({ data: { invitation_id: id } }),
    onSuccess: async (result) => {
      await refresh();
      if (result?.emailed) {
        toast.success("Invitation email resent");
      } else {
        toast.info("Email could not be sent — invitation link copied instead");
        if (result?.token) void copyLink(result.token);
      }
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "That change was not allowed"),
  });

  const roleMutation = useMutation({
    mutationFn: (vars: { id: string; role: string }) =>
      changeRole({ data: { membership_id: vars.id, role: vars.role } }),
    onSuccess: async () => {
      await invalidateAccessQueries(queryClient);
      toast.success("Role updated");
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "That change was not allowed"),
  });
  const removeBabysitterMutation = useMutation({
    mutationFn: (id: string) =>
      saveBabysitter({
        data: {
          membership_id: id,
          enabled: false,
          family_member_id: null,
          date_scope: "shift_days_only",
          calendar_ids: [],
        },
      }),
    onSuccess: async () => {
      setRemovingBabysitterId(null);
      await invalidateAccessQueries(queryClient);
      toast.success("Role updated to Viewer");
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "That change was not allowed"),
  });
  const removeMutation = useMutationLike(
    (id: string) => removeUser({ data: { membership_id: id } }),
    "Access removed",
    refresh,
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Household access
        </h2>
        {isOwner ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="h-10 rounded-full font-bold" type="button">
                <MailPlus className="mr-1 h-4 w-4" aria-hidden />
                Invite user
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-3xl sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Invite someone to this household</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-role">Role</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger id="invite-role" className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer · view only</SelectItem>
                      <SelectItem value="editor">Editor · can add and edit</SelectItem>
                      <SelectItem value="owner">Owner · manages everything</SelectItem>
                      <SelectItem value="babysitter">Babysitter · limited view</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {isBabysitterInvite ? (
                  <>
                  <p className="text-xs text-muted-foreground">
                    Already listed under Caregivers? Use “Give sign-in access” on their card instead.
                  </p>
                  <BabysitterConfigFields
                    setup={babysitterSetup.data && {
                      ...babysitterSetup.data,
                      // Only caregivers with no sign-in yet — prevents a second login for the same person.
                      family_members: babysitterSetup.data.family_members.filter(
                        (fm) => !(access.data?.memberships ?? []).some((mm) => mm.family_member_id === fm.id),
                      ),
                    }}
                    memberId={bsMember}
                    setMemberId={setBsMember}
                    scope={bsScope}
                    setScope={setBsScope}
                    calendarIds={bsCalendars}
                    setCalendarIds={setBsCalendars}
                  />
                  </>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  They create or sign into their own account — you never set a password for them.
                </p>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  className="h-11 w-full rounded-full font-bold"
                  disabled={inviteMutation.isPending || (isBabysitterInvite && !bsMember)}
                  onClick={() => inviteMutation.mutate()}
                >
                  Send invitation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <div className="divide-y divide-border-soft overflow-hidden rounded-3xl border border-border-soft bg-card">
        {access.isLoading || (isOwner && babysitterSetup.isLoading) ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : null}
        {(isOwner && babysitterSetup.isLoading ? [] : access.data?.memberships ?? []).map((m) => {
          const isBabysitter =
            babysitterSetup.data?.profiles.some((profile) => profile.family_user_id === m.id) ?? false;
          // Caregiver logins are managed from the Caregivers section.
          if (isBabysitter) return null;
          const displayRole = isBabysitter ? "babysitter" : m.role;
          return (
          <div key={m.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-1.5 text-sm font-bold">
                <span className="truncate">
                  {m.display_name ?? m.email ?? "Household user"}
                  {m.is_self ? " (you)" : ""}
                </span>
                {isOwner ? (
                  <span title="Account set up" className="shrink-0 text-success">
                    <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">Account set up</span>
                  </span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {m.email ?? "no email on file"} · {isBabysitter ? "Babysitter · limited view" : ROLE_HINT[m.role] ?? m.role}
              </p>
            </div>
            {isOwner ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={displayRole}
                  onValueChange={(next) => {
                    if (next === "babysitter") {
                      setConfiguringMembershipId(m.id);
                    } else if (isBabysitter && next === "viewer") {
                      setRemovingBabysitterId(m.id);
                    } else {
                      roleMutation.mutate({ id: m.id, role: next });
                    }
                  }}
                  disabled={m.role === "owner" && ownerCount <= 1}
                >
                  <SelectTrigger className="h-10 w-[130px] rounded-xl" aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="babysitter">Babysitter</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${m.display_name ?? m.email ?? "user"}`}
                  disabled={m.role === "owner" && ownerCount <= 1}
                  onClick={() => removeMutation.mutate(m.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ) : (
              <span className="rounded-full bg-surface-muted px-3 py-1.5 text-[11px] font-bold text-muted-foreground capitalize">
                {displayRole}
              </span>
            )}
          </div>
          );
        })}
      </div>

      {isOwner && (access.data?.invitations ?? []).length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Invitations
          </h3>
          <div className="divide-y divide-border-soft overflow-hidden rounded-3xl border border-dashed border-border bg-card">
            {(access.data?.invitations ?? []).map((inv) => (
              <div
                key={inv.id}
                className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-bold">
                    <span className="truncate">{inv.email}</span>
                    <span title="Invitation pending" className="shrink-0 text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">Invitation pending</span>
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {inv.is_babysitter ? "Babysitter" : inv.role} · {inv.status}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {inv.token ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-full text-xs font-bold"
                      onClick={() => copyLink(inv.token as string)}
                    >
                      <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Copy link
                    </Button>
                  ) : null}
                  {inv.status === "pending" || inv.status === "expired" ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 rounded-full text-xs font-bold"
                        onClick={() => resendMutation.mutate(inv.id)}
                      >
                        Resend
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 rounded-full text-xs font-bold"
                        onClick={() => revokeMutation.mutate(inv.id)}
                      >
                        Revoke
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(() => {
        const membership = (access.data?.memberships ?? []).find(
          (item) => item.id === configuringMembershipId,
        );
        return membership ? (
          <BabysitterAccessDialog
            open
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setConfiguringMembershipId(null);
            }}
            membershipId={membership.id}
            label={membership.display_name ?? membership.email ?? "Household user"}
            linkedMemberId={membership.family_member_id}
            {...(membership.role === "viewer"
              ? {}
              : {
                  prepareSave: () =>
                    changeRole({
                      data: { membership_id: membership.id, role: "viewer" },
                    }),
                })}
            onSaved={refresh}
          />
        ) : null;
      })()}

      <AlertDialog
        open={Boolean(removingBabysitterId)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRemovingBabysitterId(null);
        }}
      >
        <AlertDialogContent className="max-w-md rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Change to Viewer?</AlertDialogTitle>
            <AlertDialogDescription>
              Viewer has broader household calendar visibility. This will remove the Babysitter
              calendar and date restrictions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeBabysitterMutation.isPending}
              onClick={() => {
                if (removingBabysitterId) removeBabysitterMutation.mutate(removingBabysitterId);
              }}
            >
              Change to Viewer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Small helper so each owner action shares the same toast + refresh behaviour. */
function useMutationLike<T>(
  fn: (value: T) => Promise<unknown>,
  successMessage: string,
  refresh: () => void,
) {
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      refresh();
      toast.success(successMessage);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "That change was not allowed"),
  });
}
