import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { acceptHouseholdInvitation, getInvitationPreview } from "@/lib/household.functions";

export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Household invitation — Family Calendar" },
      {
        name: "description",
        content: "Accept your invitation to join a shared household calendar.",
      },
      { property: "og:title", content: "Household invitation — Family Calendar" },
      {
        property: "og:description",
        content: "Join a shared household calendar with your own account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvitePage,
});

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner — full household access",
  editor: "Editor — can add and edit events",
  viewer: "Viewer — view only",
};

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const preview = useServerFn(getInvitationPreview);
  const accept = useServerFn(acceptHouseholdInvitation);

  const [invite, setInvite] = useState<Awaited<ReturnType<typeof preview>> | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setInvite(await preview({ data: { token } }));
      } catch {
        setInvite(null);
      } finally {
        setLoading(false);
      }
      const { data } = await supabase.auth.getSession();
      setSignedIn(Boolean(data.session));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const acceptInvite = async () => {
    setBusy(true);
    try {
      await accept({ data: { token } });
      toast.success("You're in — welcome to the household");
      navigate({ to: "/today", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not accept this invitation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-border-soft bg-card p-6 shadow-soft">
        {loading ? (
          <p className="text-sm text-muted-foreground">Checking your invitation…</p>
        ) : !invite ? (
          <>
            <h1 className="font-display text-2xl font-bold">Invitation not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This link is not valid. Ask the household owner to send a new invitation.
            </p>
          </>
        ) : invite.status !== "pending" ? (
          <>
            <h1 className="font-display text-2xl font-bold">
              {invite.status === "accepted" ? "Already accepted" : `Invitation ${invite.status}`}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {invite.status === "accepted"
                ? "This invitation has already been used. Sign in to open the household."
                : "Ask the household owner to send a fresh invitation."}
            </p>
            <Link to="/auth" className="mt-5 block">
              <Button className="h-11 w-full rounded-full font-bold" type="button">
                Go to sign in
              </Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">
              You&rsquo;ve been invited to join {invite.family_name}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Invitation for <span className="font-semibold">{invite.email}</span>
              <br />
              {ROLE_LABEL[invite.role] ?? invite.role}
            </p>
            {signedIn ? (
              <Button
                className="mt-5 h-11 w-full rounded-full font-bold"
                type="button"
                disabled={busy}
                onClick={acceptInvite}
              >
                Accept invitation
              </Button>
            ) : (
              <>
                <p className="mt-4 text-sm text-muted-foreground">
                  Create your own account (or sign into an existing one) with that email address,
                  then come back to this link to accept.
                </p>
                <Link
                  to="/auth"
                  search={{ redirect: `/invite/${token}` }}
                  className="mt-5 block"
                >
                  <Button className="h-11 w-full rounded-full font-bold" type="button">
                    Create account or sign in
                  </Button>
                </Link>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
