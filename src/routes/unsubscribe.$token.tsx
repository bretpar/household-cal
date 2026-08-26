import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { LegalPageLayout } from "@/components/LegalPageLayout";
import { unsubscribeSummaryRecipient } from "@/lib/email-summaries.functions";

export const Route = createFileRoute("/unsubscribe/$token")({
  head: () => ({
    meta: [
      { title: "Unsubscribe — Our Family Calendar" },
      {
        name: "description",
        content: "Stop receiving this Our Family Calendar email summary.",
      },
      { property: "og:title", content: "Unsubscribe — Our Family Calendar" },
      {
        property: "og:description",
        content: "Stop receiving this Our Family Calendar email summary.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<"working" | "done" | "invalid">("working");
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    unsubscribeSummaryRecipient({ data: { token } })
      .then((result) => {
        if (!active) return;
        setName(result?.name ?? null);
        setState(result?.ok ? "done" : "invalid");
      })
      .catch(() => active && setState("invalid"));
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <LegalPageLayout title="Email summaries">
      {state === "working" && <p className="text-muted-foreground">Updating your preferences…</p>}
      {state === "done" && (
        <div className="space-y-3">
          <p className="text-lg font-semibold">You've been unsubscribed.</p>
          <p className="text-muted-foreground">
            {name ? `${name} will` : "You will"} no longer receive this calendar summary. Other
            emails from this household are unaffected, and a household owner can add you back at any
            time.
          </p>
        </div>
      )}
      {state === "invalid" && (
        <div className="space-y-3">
          <p className="text-lg font-semibold">This unsubscribe link is no longer valid.</p>
          <p className="text-muted-foreground">
            It may have already been used, or the summary may have been removed. Ask a household
            owner to check the schedule's recipients.
          </p>
        </div>
      )}
    </LegalPageLayout>
  );
}
