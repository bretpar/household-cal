import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, MailPlus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");

  const access = useQuery({ queryKey: HOUSEHOLD_ACCESS_KEY, queryFn: () => fetchAccess() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: HOUSEHOLD_ACCESS_KEY });

  const isOwner = access.data?.my_role === "owner";
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
    mutationFn: () => invite({ data: { email, role } }),
    onSuccess: async (result) => {
      const sentTo = email;
      setOpen(false);
      setEmail("");
      setRole("viewer");
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

  const roleMutation = useMutationLike(
    (vars: { id: string; role: string }) =>
      changeRole({ data: { membership_id: vars.id, role: vars.role } }),
    "Role updated",
    refresh,
  );
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
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  They create or sign into their own account — you never set a password for them.
                </p>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  className="h-11 w-full rounded-full font-bold"
                  disabled={inviteMutation.isPending}
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
        {access.isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : null}
        {(access.data?.memberships ?? []).map((m) => (
          <div key={m.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">
                {m.display_name ?? m.email ?? "Household user"}
                {m.is_self ? " (you)" : ""}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {m.email ?? "no email on file"} · {ROLE_HINT[m.role] ?? m.role}
              </p>
            </div>
            {isOwner ? (
              <div className="flex items-center gap-2">
                <Select
                  value={m.role}
                  onValueChange={(next) => roleMutation.mutate({ id: m.id, role: next })}
                  disabled={m.role === "owner" && ownerCount <= 1}
                >
                  <SelectTrigger className="h-10 w-[130px] rounded-xl" aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
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
                {m.role}
              </span>
            )}
          </div>
        ))}
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
                  <p className="truncate text-sm font-bold">{inv.email}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {inv.role} · {inv.status}
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
