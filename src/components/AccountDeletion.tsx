import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { deleteMyAccount, getAccountDeletionPlan } from "@/lib/account-deletion.functions";

export function AccountDeletion() {
  const [open, setOpen] = useState(false);
  const [transfers, setTransfers] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Record<string, boolean>>({});
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const fetchPlan = useServerFn(getAccountDeletionPlan);
  const remove = useServerFn(deleteMyAccount);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const plan = useQuery({ queryKey: ["account-deletion-plan"], queryFn: () => fetchPlan(), enabled: open });
  const plans = plan.data ?? [];

  const ready =
    typed.trim().toUpperCase() === "DELETE" &&
    plans.every((p) => {
      if (p.action.kind === "needs_transfer") return Boolean(transfers[p.family_id]);
      if (p.action.kind === "needs_delete_confirmation") return Boolean(confirmDelete[p.family_id]);
      return true;
    });

  const submit = async () => {
    setBusy(true);
    try {
      const result = await remove({
        data: {
          transfers,
          delete_households: Object.keys(confirmDelete).filter((k) => confirmDelete[k]),
        },
      });
      if (!result.ok) {
        toast.error("Please finish the household choices before deleting.");
        await plan.refetch();
        return;
      }
      await supabase.auth.signOut({ scope: "local" });
      queryClient.clear();
      toast.success("Your account has been deleted.");
      navigate({ to: "/auth" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete your account");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="h-11 w-full rounded-full text-sm font-semibold text-destructive"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        Delete my account
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-destructive/40 bg-card p-4" role="region" aria-label="Delete account">
      <div>
        <p className="text-sm font-bold text-destructive">Delete my account</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This permanently deletes your sign-in and personal settings. Shared household calendars stay
          with the other members. This can't be undone.
        </p>
      </div>

      {plan.isLoading ? <p className="text-xs text-muted-foreground">Checking your households…</p> : null}
      {plan.error ? <p className="text-xs text-destructive">Couldn't load your households.</p> : null}

      {plans.map((p) => (
        <div key={p.family_id} className="rounded-xl border border-border-soft p-3 text-xs">
          <p className="font-bold">{p.family_name}</p>
          {p.action.kind === "leave" ? (
            <p className="mt-1 text-muted-foreground">You'll be removed; the household stays for everyone else.</p>
          ) : null}
          {p.action.kind === "needs_transfer" ? (
            <label className="mt-2 block">
              <span className="text-muted-foreground">You're the only owner. Choose who becomes owner:</span>
              <select
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
                value={transfers[p.family_id] ?? ""}
                onChange={(e) => setTransfers((t) => ({ ...t, [p.family_id]: e.target.value }))}
              >
                <option value="">Select a member…</option>
                {p.action.candidates.map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {p.action.kind === "needs_delete_confirmation" ? (
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={Boolean(confirmDelete[p.family_id])}
                onChange={(e) => setConfirmDelete((c) => ({ ...c, [p.family_id]: e.target.checked }))}
              />
              <span>
                You're the only member. Delete this household and all of its calendars, events and
                connected calendar links too.
              </span>
            </label>
          ) : null}
        </div>
      ))}

      <label className="block text-xs">
        <span className="text-muted-foreground">Type DELETE to confirm</span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
          autoComplete="off"
        />
      </label>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1 rounded-full" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="flex-1 rounded-full"
          disabled={!ready || busy || plan.isLoading}
          onClick={submit}
        >
          {busy ? "Deleting…" : "Delete account"}
        </Button>
      </div>
    </div>
  );
}
