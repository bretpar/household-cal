export type ChildcareDestination = "ofc" | "google" | "existing";

/** Creation is invoked by confirmation only; the existing household claim is idempotent. */
export async function confirmChildcareSetup(
  input: { destination: ChildcareDestination; name: string; calendarId: string | null },
  actions: {
    create: (name: string) => Promise<{ id: string }>;
    isGoogle: (id: string) => Promise<boolean>;
    linkGoogle: (id: string, name: string) => Promise<unknown>;
    select: (id: string) => Promise<unknown>;
  },
) {
  if (input.destination === "existing") {
    if (!input.calendarId) throw new Error("Choose a calendar for babysitting shifts.");
    await actions.select(input.calendarId);
    return input.calendarId;
  }
  const name = input.name.trim() || "Babysitter";
  const { id } = await actions.create(name);
  if (input.destination === "google" && !(await actions.isGoogle(id))) {
    await actions.linkGoogle(id, name);
  }
  return id;
}