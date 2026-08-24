import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
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
} from "@/lib/onboarding.functions";
import { cn } from "@/lib/utils";

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
    ],
  }),
  component: OnboardingPage,
});

type MemberRoleInput = "parent" | "child" | "other";

interface MemberRow {
  key: string;
  name: string;
  initial: string;
  initialTouched: boolean;
  color: MemberColor;
  role: MemberRoleInput;
  is_me: boolean;
}

let rowSeq = 0;
function newRow(overrides: Partial<MemberRow> = {}): MemberRow {
  rowSeq += 1;
  const color = MEMBER_COLORS[(rowSeq - 1) % MEMBER_COLORS.length] ?? "sky";
  return {
    key: `row-${rowSeq}`,
    name: "",
    initial: "",
    initialTouched: false,
    color,
    role: "parent",
    is_me: false,
    ...overrides,
  };
}

const STEPS = ["Household", "Family", "Done"];

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadStatus = useServerFn(getOnboardingStatus);
  const createHousehold = useServerFn(createHouseholdFn);
  const saveMembers = useServerFn(saveHouseholdMembersFn);

  const status = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => loadStatus(),
    staleTime: 0,
  });

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [householdName, setHouseholdName] = useState("");
  const [rows, setRows] = useState<MemberRow[]>(() => [newRow({ is_me: true })]);
  const [busy, setBusy] = useState(false);

  // resume from real database state rather than client-side step memory
  useEffect(() => {
    const data = status.data;
    if (!data) return;
    if (data.family_name) setHouseholdName((prev) => prev || data.family_name!);
    if (!data.family_id) {
      setStep(1);
      return;
    }
    if (data.members.length === 0) {
      setStep((prev) => (prev === 3 ? 3 : 2));
      return;
    }
    setRows(
      data.members.map((m) =>
        newRow({
          name: m.name,
          initial: m.initial,
          initialTouched: true,
          color: m.color as MemberColor,
          role: (m.role === "parent" || m.role === "child" ? m.role : "other") as MemberRoleInput,
          is_me: m.id === data.my_member_id,
        }),
      ),
    );
    setStep(3);
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

  const patchRow = (key: string, patch: Partial<MemberRow>) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const submitHousehold = async () => {
    if (!householdName.trim()) {
      toast.error("Give your household a name");
      return;
    }
    setBusy(true);
    try {
      await createHousehold({ data: { name: householdName.trim() } });
      await status.refetch();
      setStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create your household");
    } finally {
      setBusy(false);
    }
  };

  const submitMembers = async () => {
    const payload = rows
      .map((row) => ({
        name: row.name.trim(),
        initial: (row.initialTouched ? row.initial : row.name.charAt(0)).toUpperCase().slice(0, 1),
        color: row.color,
        role: row.role,
        is_me: row.is_me,
      }))
      .filter((row) => row.name.length > 0);

    if (payload.length === 0) {
      toast.error("Add at least one family member");
      return;
    }
    setBusy(true);
    try {
      await saveMembers({ data: { members: payload } });
      await queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
      await status.refetch();
      setStep(3);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your family");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-xl">
        <ol className="mb-6 flex items-center justify-center gap-2 text-xs font-bold">
          {STEPS.map((label, index) => {
            const number = index + 1;
            const state = number < step ? "done" : number === step ? "current" : "todo";
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-full px-3",
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
                  return (
                    <div
                      key={row.key}
                      className="rounded-2xl border border-border-soft bg-surface p-4"
                    >
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_5rem]">
                        <div className="space-y-1.5">
                          <Label htmlFor={`member-name-${row.key}`}>Name</Label>
                          <Input
                            id={`member-name-${row.key}`}
                            className="h-12 rounded-xl text-base"
                            placeholder="e.g. Dad"
                            value={row.name}
                            onChange={(event) => patchRow(row.key, { name: event.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`member-initial-${row.key}`}>Initial</Label>
                          <Input
                            id={`member-initial-${row.key}`}
                            className="h-12 rounded-xl text-center text-base font-bold"
                            maxLength={1}
                            value={initial}
                            onChange={(event) =>
                              patchRow(row.key, {
                                initial: event.target.value.slice(0, 1).toUpperCase(),
                                initialTouched: true,
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Role</Label>
                          <Select
                            value={row.role}
                            onValueChange={(value) =>
                              patchRow(row.key, { role: value as MemberRoleInput })
                            }
                          >
                            <SelectTrigger className="h-12 rounded-xl">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="parent">Parent</SelectItem>
                              <SelectItem value="child">Child</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Color</Label>
                          <div className="flex flex-wrap gap-2">
                            {MEMBER_COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                aria-label={color}
                                aria-pressed={row.color === color}
                                onClick={() => patchRow(row.key, { color })}
                                className={cn(
                                  "h-10 w-10 rounded-full ring-offset-2 ring-offset-surface transition",
                                  styleForColor(color).dot,
                                  row.color === color ? "ring-2 ring-foreground" : "",
                                )}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setRows((prev) =>
                              prev.map((r) => ({ ...r, is_me: r.key === row.key })),
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
                            onClick={() =>
                              setRows((prev) => prev.filter((r) => r.key !== row.key))
                            }
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
                  );
                })}
              </div>

              <Button
                variant="outline"
                className="h-12 w-full rounded-full font-bold"
                onClick={() => setRows((prev) => [...prev, newRow({ role: "child" })])}
                type="button"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add family member
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
            <div className="space-y-5 text-center">
              <h1 className="font-display text-2xl font-bold sm:text-3xl">
                Your family calendar is ready
              </h1>
              <p className="text-sm text-muted-foreground">
                {householdName || "Your household"} is set up with {rows.filter((r) => r.name).length}{" "}
                {rows.filter((r) => r.name).length === 1 ? "person" : "people"}. Add your first event
                whenever you like.
              </p>
              <div className="space-y-2">
                <Button
                  className="h-12 w-full rounded-full font-bold"
                  onClick={() => navigate({ to: "/calendar" })}
                  type="button"
                >
                  Go to Calendar
                </Button>
                <Button
                  variant="outline"
                  className="h-12 w-full rounded-full font-bold"
                  onClick={() => navigate({ to: "/family" })}
                  type="button"
                >
                  Invite someone
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
