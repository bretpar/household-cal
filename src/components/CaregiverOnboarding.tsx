import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CaregiverGoogleSettings } from "@/components/CaregiverGoogleSettings";
import { SignOutButton } from "@/components/SignOutButton";
import { finishCaregiverOnboarding, saveCaregiverClient } from "@/lib/independent-caregiver.functions";
import { MEMBER_COLORS, styleForColor, type MemberColor } from "@/lib/family-data";
import { requestHeartReveal } from "@/components/StartupSplash";
import { cn } from "@/lib/utils";

export function CaregiverOnboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const save = useServerFn(saveCaregiverClient);
  const finish = useServerFn(finishCaregiverOnboarding);
  const [step, setStep] = useState<"contacts" | "google">("contacts");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [color, setColor] = useState<MemberColor>("sky");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const identity = useQuery({ queryKey: ["caregiver-verified-user"], queryFn: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw new Error("Sign in to continue setup");
    return data.user.id;
  } });
  const contacts = useQuery({ queryKey: ["caregiver-onboarding-contacts", identity.data], enabled: Boolean(identity.data), queryFn: async () => {
    if (!identity.data) throw new Error("Sign in to continue setup");
    const { data, error } = await supabase.from("caregiver_clients").select("id,name,color").eq("user_id", identity.data).eq("archived", false).order("created_at");
    if (error) throw new Error("Could not load your family contacts");
    return data;
  } });
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await action(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save setup"); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const add = async () => {
    await save({ data: { name, email, color } });
    setName(""); setEmail("");
    setColor(MEMBER_COLORS.find(c => c !== color && !contacts.data?.some(contact => contact.color === c)) ?? "sky");
    await contacts.refetch();
  };
  const done = () => run(async () => {
    await finish();
    await queryClient.invalidateQueries({ queryKey: ["caregiver-work"] });
    requestHeartReveal();
    await navigate({ to: "/caregiver/today" });
  });
  return <main className="min-h-dvh bg-background px-4 py-10 pb-[calc(3rem+env(safe-area-inset-bottom))]">
    <div className="mx-auto max-w-xl space-y-6">
      <ol aria-label="Setup progress" className="flex gap-5 text-sm font-semibold text-muted-foreground"><li className={step === "contacts" ? "text-foreground" : ""}>1. Families</li><li className={step === "google" ? "text-foreground" : ""}>2. Google Calendar</li></ol>
      <h1 className="font-display text-2xl font-bold">{step === "contacts" ? "Your family contacts" : "Connect your work calendar"}</h1>
      {identity.isError || contacts.isError ? <div role="alert"><p className="text-destructive">Could not load setup.</p><Button variant="outline" onClick={() => { void identity.refetch(); void contacts.refetch(); }}>Try again</Button></div> : !identity.data || !contacts.data ? <p className="text-muted-foreground">Loading setup…</p> : step === "contacts" ? <>
        <ul className="space-y-2">{contacts.data.map(c => <li key={c.id} className="flex items-center gap-2 font-semibold"><span className={cn("size-3 rounded-full", styleForColor(c.color as MemberColor).dot)} />{c.name}</li>)}</ul>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(add); }}>
          <div className="space-y-1"><Label htmlFor="setup-family-name">Family name</Label><Input id="setup-family-name" required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="setup-family-email">Email (optional)</Label><Input id="setup-family-email" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div role="group" aria-label="Family color" className="flex flex-wrap gap-2">{MEMBER_COLORS.map(c => <Button key={c} type="button" variant="ghost" size="icon" aria-label={`Select ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}><span className={cn("flex size-8 items-center justify-center rounded-full", styleForColor(c).badge)}>{color === c && <Check className="size-4" />}</span></Button>)}</div>
          <Button type="submit" variant="outline" disabled={busy}><Plus className="size-4" />{contacts.data.length ? "Add another family" : "Add family"}</Button>
        </form>
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run(async () => { if (name.trim() || email.trim()) await add(); setStep("google"); })}>Continue</Button><Button variant="ghost" disabled={busy} onClick={() => setStep("google")}>Skip for now</Button></div>
      </> : <>
        <CaregiverGoogleSettings userId={identity.data} />
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => setStep("contacts")}>Back</Button><Button disabled={busy} onClick={() => void done()}>Go to Calendar</Button><Button variant="ghost" disabled={busy} onClick={() => void done()}>Skip for now</Button></div>
      </>}
      <SignOutButton />
    </div>
  </main>;
}