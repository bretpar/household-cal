import { setTimesheetsEnabled } from "@/lib/timesheets.functions";
import { TIMESHEETS_STATUS_KEY } from "@/lib/use-timesheets-status";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Info, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FAMILY_BUNDLE_KEY } from "@/lib/calendar-store";
import { MEMBER_COLORS, styleForColor, type MemberColor } from "@/lib/family-data";
import {
  createHouseholdFn,
  getOnboardingStatus,
  saveHouseholdMembersFn,
  finishOnboardingFn,
  sendOnboardingInvitationFn,
} from "@/lib/onboarding.functions";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/SignOutButton";
import { CalendarAppearanceSettings } from "@/components/CalendarAppearanceSettings";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChildcareSetupFields, useChildcareSetup } from "@/components/ChildcareSetup";
import { useCalendar } from "@/lib/calendar-store";
import { beginCalendarSetup, finishCalendarSetup } from "@/lib/onboarding-calendar-session";
import { retryGuard } from "@/lib/auth-guard";
import { requestHeartReveal } from "@/components/StartupSplash";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your family — Family Calendar" },
      {
        name: "description",
        content: "Create your household and add family members to start your shared calendar.",
      },
      { property: "og:title", content: "Set up your family — Family Calendar" },
      {
        property: "og:description",
        content: "A few quick steps and your household calendar is ready.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OnboardingPage,
});

type MemberRoleInput = "parent" | "child" | "caregiver" | "other";

interface MemberRow {
  id?: string | undefined;
  key: string;
  name: string;
  initial: string;
  initialTouched: boolean;
  color: MemberColor;
  role: MemberRoleInput;
  is_me: boolean;
  invite: boolean;
  email: string;
}

let rowSeq = 0;
function newRow(overrides: Partial<MemberRow> = {}, usedColors: MemberColor[] = []): MemberRow {
  rowSeq += 1;
  const color = MEMBER_COLORS.find((color) => !usedColors.includes(color)) ?? MEMBER_COLORS[usedColors.length % MEMBER_COLORS.length] ?? "sky";
  return {
    key: `row-${rowSeq}`,
    name: "",
    initial: "",
    initialTouched: false,
    color,
    role: "parent",
    is_me: false,
    invite: false,
    email: "",
    ...overrides,
  };
}

const STEPS = ["Household", "Family", "Calendars", "Done"];

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadStatus = useServerFn(getOnboardingStatus);
  const createHousehold = useServerFn(createHouseholdFn);
  const saveMembers = useServerFn(saveHouseholdMembersFn);
  const { isOwner, family, sources, loadError } = useCalendar();
  const childcareSetup = useChildcareSetup();

  const status = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => loadStatus(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const finishSetup = useServerFn(finishOnboardingFn);
  const sendInvitation = useServerFn(sendOnboardingInvitationFn);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [householdName, setHouseholdName] = useState("");
  const [rows, setRows] = useState<MemberRow[]>(() => [newRow({ is_me: true })]);
  const [expandedMemberKey, setExpandedMemberKey] = useState<string | null>(null);
  const [colorPickerKey, setColorPickerKey] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<{ key: string; message: string } | null>(null);
  const [removedMemberIds, setRemovedMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [enableChildcare, setEnableChildcare] = useState(false);
  const [enableTimesheets, setEnableTimesheets] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [inviteResults, setInviteResults] = useState<Record<string, { status: string; token?: string | null; message?: string }>>({});
  const saveTimesheetsEnabled = useServerFn(setTimesheetsEnabled);

  // Resume from real database state rather than client-side step memory —
  // but only on the FIRST load. A later background refetch must not move the
  // step or overwrite in-progress member edits.
  const stepInitialized = useRef(false);
  useEffect(() => {
    const data = status.data;
    if (!data || stepInitialized.current) return;
    stepInitialized.current = true;
    const name = data.family_name;
    if (name) setHouseholdName((prev) => prev || name);
    if (!data.family_id) {
      setStep(1);
      return;
    }
    if (data.members.length === 0) {
      setStep((prev) => (prev >= 3 ? prev : 2));
      return;
    }
    setRows(
      data.members.map((m) =>
        newRow({
          id: m.id,
          name: m.name,
          initial: m.initial,
          initialTouched: true,
          color: m.color as MemberColor,
          role: (["parent", "child", "caregiver"].includes(m.role) ? m.role : "other") as MemberRoleInput,
          is_me: m.id === data.my_member_id,
          invite: Boolean(m.onboarding_invite_email),
          email: m.onboarding_invite_email ?? "",
        }),
      ),
    );
    setCompleted(Boolean(data.completed));
    setStep((prev) => data.completed || prev === 4 ? 4 : 3);
  }, [status.data]);

  const duplicateInitials = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of rows) {
      const initial = (row.initialTouched ? row.initial : row.name.charAt(0)).toUpperCase();
      if (!initial) continue;
      seen.set(initial, (seen.get(initial) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, count]) => count > 1).map(([initial]) => initial);
  }, [rows]);

  const activeMemberKey = expandedMemberKey ?? rows.at(-1)?.key;
  const patchRow = (key: string, patch: Partial<MemberRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    if (memberError?.key === key) setMemberError(null);
  };

  const validateMember = (row: MemberRow): string | null => {
    if (!row.name.trim()) return "Enter a name for this family member";
    if (!(row.initialTouched ? row.initial : row.name.trim().charAt(0)).trim()) return "Choose an initial";
    if (row.invite && !row.is_me && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email.trim())) return "Enter a valid invitation email";
    if (row.invite && !row.is_me && rows.some((other) => other.key !== row.key && other.invite && !other.is_me && other.email.trim().toLowerCase() === row.email.trim().toLowerCase())) return "Use a different email for each invitation";
    return null;
  };

  const keepInvalidMemberOpen = (row: MemberRow): boolean => {
    const message = validateMember(row);
    if (!message) return false;
    setExpandedMemberKey(row.key);
    setColorPickerKey(null);
    setMemberError({ key: row.key, message });
    return true;
  };

  const expandMember = (key: string) => {
    const active = rows.find((row) => row.key === activeMemberKey);
    if (active && active.key !== key && keepInvalidMemberOpen(active)) return;
    setExpandedMemberKey(key);
    setColorPickerKey(null);
    setMemberError(null);
  };

  const addMember = () => {
    const invalid = rows.find((row) => validateMember(row));
    if (invalid && keepInvalidMemberOpen(invalid)) return;
    const added = newRow({ role: "child" }, rows.map((row) => row.color));
    setRows((prev) => [...prev, added]);
    setExpandedMemberKey(added.key);
    setColorPickerKey(null);
    setMemberError(null);
  };

  const submitHousehold = async () => {
    if (!householdName.trim()) {
      toast.error("Give your household a name");
      return;
    }
    setBusy(true);
    try {
      const result = await createHousehold({ data: { name: householdName.trim() } });
      beginCalendarSetup(result.user_id, result.family_id);
      const verification = await retryGuard("/onboarding");
      if (!("family_id" in verification) || verification.family_id !== result.family_id) {
        throw new Error("Could not confirm your new household. Please try again.");
      }
      void queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
      await status.refetch();
      setStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create your household");
    } finally {
      setBusy(false);
    }
  };

  const finishCalendars = async (skip: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!skip && enableChildcare) await childcareSetup.confirm();
      // Optional and independent: the Babysitter calendar works either way.
      if (!skip && enableTimesheets && (enableChildcare || family?.babysitter_calendar_source_id)) {
        await saveTimesheetsEnabled({ data: { enabled: true } }).catch(() =>
          toast.error("Couldn't turn on Timesheets — you can enable them later in Settings"),
        );
        void queryClient.invalidateQueries({ queryKey: TIMESHEETS_STATUS_KEY });
      }
      setStep(4);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not set up your calendar");
    } finally { setBusy(false); }
  };

  const deliverInvitation = async (memberId: string) => {
    try {
      const result = await sendInvitation({ data: { member_id: memberId } });
      setInviteResults((prev) => ({ ...prev, [memberId]: result }));
    } catch (error) {
      setInviteResults((prev) => ({ ...prev, [memberId]: { status: "failed", message: error instanceof Error ? error.message : "Could not create invitation" } }));
    }
  };

  const completeSetup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await finishSetup();
      setCompleted(true);
      // Each selected invitation invokes its own fixed-recipient action; retries
      // reuse the existing invitation and email idempotency key.
      await Promise.all(result.member_ids.map(deliverInvitation));
      void queryClient.invalidateQueries({ queryKey: ["household-access"] });
    } catch (error) {
      // Completion remains usable even if reading outstanding invitations fails.
      toast.error(error instanceof Error ? error.message : "Could not finish setup; please retry");
    } finally { setBusy(false); }
  };

  const leaveOnboarding = (to: "/calendar" | "/family") => {
    finishCalendarSetup();
    if (to === "/calendar") requestHeartReveal();
    void navigate({ to });
  };

  const submitMembers = async () => {
    const invalid = rows.find((row) => validateMember(row));
    if (invalid && keepInvalidMemberOpen(invalid)) return;
    const submittedRows = rows.filter((row) => row.name.trim().length > 0);
    if (submittedRows.some((row) => row.invite && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email.trim()))) {
      toast.error("Enter an email address for each selected invitation");
      return;
    }
    const payload = submittedRows
      .map((row) => ({
        id: row.id,
        name: row.name.trim(),
        initial: (row.initialTouched ? row.initial : row.name.charAt(0)).toUpperCase().slice(0, 1),
        color: row.color,
        role: row.role,
        is_me: row.is_me,
        invite_email: row.invite && !row.is_me ? row.email.trim() : null,
      }))
      .filter((row) => row.name.length > 0);

    if (payload.length === 0) {
      toast.error("Add at least one family member");
      return;
    }
    setBusy(true);
    try {
      const result = await saveMembers({ data: { members: payload, removed_member_ids: removedMemberIds } });
      setRows(submittedRows.map((row, index) => ({ ...row, id: result.member_ids[index] })));
      setRemovedMemberIds([]);
      await queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
      await status.refetch();
      setStep(3);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your family");
    } finally {
      setBusy(false);
    }
  };

  if (status.data && !status.data.family_id && status.data.had_access && !creatingNew) {
    return (
      <div className="flex min-h-screen items-center bg-background px-4 py-8">
        <div className="mx-auto w-full max-w-md space-y-4 rounded-3xl border border-border-soft bg-card p-6 text-center">
          <h1 className="text-xl font-bold">You no longer have access to this family</h1>
          <p className="text-sm text-muted-foreground">
            Your Our Family Calendar account is still active, but you no longer have access to this household.
          </p>
          <p className="text-sm text-muted-foreground">
            If you're invited to another family, you can use this same account.
          </p>
          <Button className="h-11 w-full rounded-full font-bold" onClick={() => setCreatingNew(true)}>
            Create a new family
          </Button>
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-xl">
        <ol className="mb-6 flex flex-wrap items-center justify-center gap-1 text-xs font-bold sm:gap-2">
          {STEPS.map((label, index) => {
            const number = index + 1;
            const state = number < step ? "done" : number === step ? "current" : "todo";
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-full px-2 sm:gap-1.5 sm:px-3",
                    state === "current"
                      ? "bg-primary text-primary-foreground"
                      : state === "done"
                        ? "bg-secondary text-foreground"
                        : "bg-surface-muted text-muted-foreground",
                  )}
                >
                  {state === "done" ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <span>{number}.</span>
                  )}
                  {label}
                </span>
                {number < STEPS.length ? (
                  <span className="h-px w-3 bg-border-soft sm:w-6" aria-hidden />
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="rounded-3xl border border-border-soft bg-card p-5 shadow-soft sm:p-7">
          {step === 1 ? (
            <div className="space-y-5">
              <div>
                <h1 className="font-display text-2xl font-bold sm:text-3xl">
                  Let&rsquo;s set up your family
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Name your household. You can invite other people later.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="household-name">Household name</Label>
                <Input
                  id="household-name"
                  className="h-12 rounded-xl text-base"
                  placeholder="Smith Family"
                  value={householdName}
                  onChange={(event) => setHouseholdName(event.target.value)}
                />
              </div>
              <Button
                className="h-12 w-full rounded-full font-bold"
                onClick={submitHousehold}
                disabled={busy}
                type="button"
              >
                Continue
              </Button>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <div>
                <h1 className="font-display text-2xl font-bold sm:text-3xl">
                  Who&rsquo;s in your family?
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Each person gets an initial and a color used across the calendar.
                </p>
              </div>

              {duplicateInitials.length > 0 ? (
                <p className="rounded-2xl bg-surface-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
                  Two people share the initial {duplicateInitials.join(", ")}. That still works, but
                  a unique letter is easier to read.
                </p>
              ) : null}

              <div className="space-y-4">
                {rows.map((row, index) => {
                  const initial = (
                    row.initialTouched ? row.initial : row.name.charAt(0)
                  ).toUpperCase();
                  const usedColors = rows.filter((other) => other.key !== row.key).map((other) => other.color);
                  const suggestedColors = [...new Set([
                    row.color,
                    ...MEMBER_COLORS.filter((color) => !usedColors.includes(color)),
                    ...MEMBER_COLORS,
                  ])].slice(0, 3);
                  return (
                    <div
                      key={row.key}
                      className="overflow-hidden rounded-lg border border-border-soft bg-surface"
                    >
                      {row.key !== activeMemberKey ? (
                        <Button type="button" variant="ghost" className="h-auto min-h-16 w-full justify-start gap-3 rounded-none px-4 py-2 text-left" aria-expanded={false} aria-controls={`member-form-${row.key}`} onClick={() => expandMember(row.key)}>
                          <span aria-hidden className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold", styleForColor(row.color).badge)}>{initial || "?"}</span>
                          <span className="min-w-0 flex-1 whitespace-normal">
                            <span className="block break-words font-bold">{row.name}</span>
                            <span className="block text-xs font-normal text-muted-foreground">{row.role === "parent" ? "Parent (Owner)" : row.role === "child" ? "Child (Viewer)" : row.role === "caregiver" ? "Caregiver (Viewer)" : "Other"}</span>
                          </span>
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        </Button>
                      ) : null}
                      <div id={`member-form-${row.key}`} hidden={row.key !== activeMemberKey} className="p-4" role="group" aria-label={`Edit ${row.name || "family member"}`}>
                        <div className="space-y-1.5">
                          <Label htmlFor={`member-name-${row.key}`}>Name</Label>
                          <Input id={`member-name-${row.key}`} className="h-12 rounded-xl text-base" placeholder="e.g. Dad" value={row.name} onChange={(event) => patchRow(row.key, { name: event.target.value })} />
                        </div>
                        <div className="mt-3 grid w-full max-w-sm grid-cols-[minmax(0,1fr)_minmax(0,2.7fr)] gap-3">
                          <div className="min-w-0 space-y-1.5">
                            <Label htmlFor={`member-initial-${row.key}`}>Initial</Label>
                            <Input id={`member-initial-${row.key}`} className="h-12 rounded-xl text-center text-base font-bold" maxLength={1} value={initial} onChange={(event) => patchRow(row.key, { initial: event.target.value.slice(0, 1).toUpperCase(), initialTouched: true })} />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <Label id={`member-color-label-${row.key}`}>Color</Label>
                            <Popover open={colorPickerKey === row.key} onOpenChange={(open) => setColorPickerKey(open ? row.key : null)}>
                              <div className="flex h-12 min-w-0 items-center rounded-xl border border-input bg-background shadow-sm" role="group" aria-labelledby={`member-color-label-${row.key}`}>
                                <div className="grid min-w-0 flex-1 grid-cols-3 px-0.5 sm:px-1">
                                  {suggestedColors.map((color) => (
                                    <Button key={color} type="button" variant="ghost" size="icon" aria-label={`Select ${color}`} aria-pressed={row.color === color} onClick={() => patchRow(row.key, { color })} className="h-11 w-full min-w-0 rounded-lg p-0">
                                      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full sm:size-8", styleForColor(color).badge, row.color === color && "ring-1 ring-ring ring-offset-2 ring-offset-background")}>
                                        {row.color === color ? <Check aria-hidden /> : null}
                                      </span>
                                    </Button>
                                  ))}
                                </div>
                                <PopoverTrigger asChild>
                                  <Button id={`member-color-${row.key}`} type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-none rounded-r-xl p-0" aria-label={`More colors for ${row.name || "family member"}`} title="More colors">
                                    <span className="flex h-6 w-full items-center justify-center border-l border-input"><ChevronDown className="text-muted-foreground" aria-hidden /></span>
                                  </Button>
                                </PopoverTrigger>
                              </div>
                              <PopoverContent align="end" collisionPadding={16} className="w-auto max-w-[calc(100vw-2rem)] p-3">
                                <div className="grid grid-cols-4 gap-2" role="group" aria-label="Member colors">
                                  {MEMBER_COLORS.map((color) => (
                                    <Button key={color} type="button" variant="ghost" size="icon" aria-label={color} aria-pressed={row.color === color} onClick={() => { patchRow(row.key, { color }); setColorPickerKey(null); }} className={cn("h-11 w-11 rounded-full", styleForColor(color).badge, row.color === color && "ring-2 ring-ring ring-offset-2 ring-offset-surface")}>
                                      {row.color === color ? <Check className="h-5 w-5" aria-hidden /> : null}
                                    </Button>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </div>
                        <div className="mt-3 space-y-1.5">
                          <Label>Family role</Label>
                          <Select value={row.role} onValueChange={(value) => patchRow(row.key, { role: value as MemberRoleInput })}>
                            <SelectTrigger className="h-12 rounded-xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="parent">Parent</SelectItem>
                              <SelectItem value="child">Child</SelectItem>
                              <SelectItem value="caregiver">Caregiver</SelectItem>
                              {row.role === "other" ? <SelectItem value="other">Other (existing)</SelectItem> : null}
                            </SelectContent>
                          </Select>
                        </div>
                        {memberError?.key === row.key ? <p role="alert" className="mt-3 text-sm text-destructive">{memberError.message}</p> : null}

                      {!row.is_me ? <div className="mt-3 space-y-2 border-t border-border-soft pt-3">
                        <Label htmlFor={`invite-${row.key}`} className="flex min-h-10 cursor-pointer items-center gap-3">
                          <Checkbox id={`invite-${row.key}`} checked={row.invite} onCheckedChange={(checked) => patchRow(row.key, { invite: checked === true, email: checked === true ? row.email : "" })} />
                          Invite to Our Family Calendar
                        </Label>
                        {row.invite ? <div className="space-y-2">
                          <Label htmlFor={`email-${row.key}`}>Email address</Label>
                          <Input id={`email-${row.key}`} type="email" autoComplete="email" required value={row.email} onChange={(event) => patchRow(row.key, { email: event.target.value })} className="h-12 text-base" />
                          <p className="text-xs text-muted-foreground">Invitation sent after setup finishes.</p>
                          <p className="text-xs text-muted-foreground">{row.role === "parent" ? "Owner — full household management. Owner access permits managing this household and its calendars." : row.role === "caregiver" ? "Caregiver — limited calendars and existing Timesheet capabilities." : "Viewer — read-only access."}</p>
                        </div> : null}
                      </div> : null}

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setRows((prev) =>
                              prev.map((r) => ({ ...r, is_me: r.key === row.key, ...(r.key === row.key ? { invite: false, email: "" } : {}) })),
                            )
                          }
                          className={cn(
                            "h-10 rounded-full px-4 text-sm font-bold transition-colors",
                            row.is_me
                              ? "bg-secondary text-foreground"
                              : "text-muted-foreground hover:bg-secondary",
                          )}
                        >
                          {row.is_me ? "This is me" : "Set as me"}
                        </button>
                        {rows.length > 1 ? (
                          <Button
                            variant="ghost"
                            className="h-10 rounded-full text-muted-foreground"
                            onClick={() => {
                              const memberId = row.id;
                              if (memberId) setRemovedMemberIds((prev) => [...prev, memberId]);
                              const remaining = rows.filter((r) => r.key !== row.key);
                              setRows(remaining);
                              setExpandedMemberKey(remaining.at(-1)?.key ?? null);
                              setColorPickerKey(null);
                              setMemberError(null);
                            }}
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                            Remove
                          </Button>
                        ) : (
                          <span className="text-xs font-semibold text-muted-foreground">
                            Person {index + 1}
                          </span>
                        )}
                      </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <Button
                variant="outline"
                className="h-12 w-full rounded-full font-bold"
                onClick={addMember}
                type="button"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add another member
              </Button>

              <Button
                className="h-12 w-full rounded-full font-bold"
                onClick={submitMembers}
                disabled={busy}
                type="button"
              >
                Save family
              </Button>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <header>
                <h1 className="font-display text-2xl font-bold sm:text-3xl">Let&rsquo;s set up your calendars</h1>
                <p className="mt-1 text-sm text-muted-foreground">Create a new calendar or bring in one you already use. You can always add more later.</p>
              </header>
              {isOwner ? <CalendarAppearanceSettings onboarding /> : (
                <p role="status" className="text-sm text-muted-foreground">{loadError ? "Calendar setup couldn't load. You can skip for now and add calendars later." : "Loading your calendars…"}</p>
              )}
              {isOwner ? <div className="space-y-3 border-t border-border-soft pt-4">
                <div>
                  <h2 className="text-base font-bold">Set up childcare scheduling <span className="text-xs font-normal text-muted-foreground">Optional</span></h2>
                  <p className="mt-1 text-sm text-muted-foreground">Organize babysitting shifts and caregiver schedules.</p>
                </div>
                {family?.babysitter_calendar_source_id && !enableChildcare ? <p className="text-sm text-muted-foreground">
                  Calendar for babysitting shifts: <span className="font-semibold text-foreground">{sources.find((s) => s.id === family.babysitter_calendar_source_id)?.name ?? "Already set up"}</span>. Your existing setup will be kept.
                </p> : <>
                  <div className="flex items-center gap-3">
                    <Checkbox id="enable-childcare" checked={enableChildcare} disabled={busy} onCheckedChange={(checked) => setEnableChildcare(checked === true)} aria-controls="childcare-setup-options" aria-expanded={enableChildcare} />
                    <Label htmlFor="enable-childcare">Enable childcare scheduling</Label>
                  </div>
                  {enableChildcare ? <div id="childcare-setup-options"><ChildcareSetupFields setup={childcareSetup} disabled={busy} /></div> : null}
                </>}
                {enableChildcare || family?.babysitter_calendar_source_id ? <div className="flex items-start gap-3 rounded-xl bg-surface-muted/60 p-3">
                  <Checkbox id="onboarding-timesheets" className="mt-0.5" checked={enableTimesheets} disabled={busy} onCheckedChange={(checked) => setEnableTimesheets(checked === true)} />
                  <div className="flex min-w-0 items-center gap-1">
                    <Label htmlFor="onboarding-timesheets" className="font-semibold leading-snug">Enable Timesheets for Caregiver?</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground" aria-label="About caregiver Timesheets">
                          <Info className="h-4 w-4" aria-hidden />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent collisionPadding={16} className="max-w-[calc(100vw-2rem)] text-sm">
                        Track caregiver hours, let caregivers submit time cards, and review their hours for approval. You can enable this later in Settings.
                      </PopoverContent>
                    </Popover>
                  </div>
                </div> : null}
              </div> : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy} onClick={() => setStep(2)}>Back</Button>
                <Button className="min-w-28 flex-1" disabled={busy || (enableChildcare && !childcareSetup.ready)} onClick={() => void finishCalendars(false)}>{busy ? "Saving…" : "Continue"}</Button>
                <Button variant="ghost" disabled={busy} onClick={() => void finishCalendars(true)}>Skip for now</Button>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-5 text-center">
              <h1 className="font-display text-2xl font-bold sm:text-3xl">
                {completed ? "Your family calendar is ready" : "Your family is almost ready!"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {householdName || "Your household"} · {rows.filter((r) => r.name).length}{" "}
                {rows.filter((r) => r.name).length === 1 ? "person" : "people"}
              </p>
              <ul className="flex flex-wrap items-center justify-center gap-2" aria-label="Your family members">
                {rows.filter((r) => r.name.trim()).map((row) => (
                  <li
                    key={row.key}
                    className="flex items-center gap-2 rounded-full border border-border-soft bg-surface px-3 py-1.5 text-sm font-semibold"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                        styleForColor(row.color).badge,
                      )}
                    >
                      {(row.initialTouched ? row.initial : row.name.charAt(0)).toUpperCase().slice(0, 1)}
                    </span>
                    {row.name.trim()}
                    <span className="text-xs font-normal text-muted-foreground">{row.role === "parent" ? "Parent" : row.role === "caregiver" ? "Caregiver" : row.role === "child" ? "Child" : "Other"}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-2 text-left text-sm">
                <p><span className="font-semibold">Calendars:</span> {sources.filter((s) => s.active && s.calendar_kind !== "legacy_internal").map((s) => s.name).join(", ") || "Family calendar"}</p>
                <p><span className="font-semibold">Childcare:</span> {family?.babysitter_calendar_source_id ? sources.find((s) => s.id === family.babysitter_calendar_source_id)?.name ?? "Set up" : "Not enabled"}</p>
                {rows.filter((r) => r.invite && !r.is_me).map((row) => <p key={row.key} className="break-words">{row.name}: {row.email} — {completed ? "See invitation status below" : "Invitation after Finish setup"}</p>)}
                {completed ? Object.entries(inviteResults).map(([memberId, result]) => <div key={memberId} className="space-y-1 border-t border-border-soft pt-2">
                  <p className="font-semibold">{rows.find((r) => r.id === memberId)?.name ?? "Family member"}: {result.status === "sent" ? "Invitation sent" : result.status === "manual" ? "Pending — email not sent; share a link" : result.status === "accepted" || result.status === "already_joined" ? "Already joined" : result.status === "expired" ? "Expired — resend from Settings" : result.status === "none" ? "No invitation selected" : "Invitation failed"}</p>
                  {result.message ? <p className="text-xs text-muted-foreground">{result.message}</p> : null}
                  {result.token ? <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(`https://ourfamilycalendar.com/invite/${result.token}`).then(() => toast.success("Invitation link copied")).catch(() => toast.error("Could not copy link"))}>Copy invitation link</Button> : null}
                  {result.status === "failed" || result.status === "manual" ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setBusy(true); void deliverInvitation(memberId).finally(() => setBusy(false)); }}>Retry invitation</Button> : null}
                </div>) : null}
              </div>
              <div className="space-y-2">
                <Button
                  className="h-12 w-full rounded-full font-bold"
                  disabled={busy}
                  onClick={() => completed ? leaveOnboarding("/calendar") : void completeSetup()}
                  type="button"
                >
                  {busy ? "Finishing…" : completed ? "Go to Calendar" : "Finish setup"}
                </Button>
                {!completed ? <Button variant="ghost" disabled={busy} onClick={() => setStep(3)}>Back</Button> : <>
                  <Button variant="ghost" disabled={busy} onClick={() => void completeSetup()}>Refresh invitation status</Button>
                  <p className="text-xs text-muted-foreground">Invite additional people or manage invitations later in Settings.</p>
                </>}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
