/**
 * Household settings writes: event categories and family-member records.
 *
 * Categories are household-owned (editors and owners may change them); family
 * members follow the existing owner-only policy. Nothing here deletes events or
 * touches Google sync links — removing a category relies on the database's
 * ON DELETE SET NULL, so its events simply become Uncategorized.
 */

import {
  MAX_CUSTOM_CATEGORIES,
  assertCategoryColor,
  assertCategoryName,
  nextSortOrder,
  type EventCategory,
} from "@/lib/event-categories";
import { DEFAULT_CATEGORIES } from "@/lib/event-categories";
import { resolveWritableFamily, type Db } from "@/lib/calendar-ops";
import { requireOwner, resolveCurrentFamily } from "@/lib/household.server";
import { MEMBER_COLORS, type MemberColor } from "@/lib/family-data";

async function listCategories(db: Db, familyId: string): Promise<EventCategory[]> {
  const { data, error } = await db
    .from("event_categories")
    .select("id, family_id, name, color, sort_order")
    .eq("family_id", familyId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventCategory[];
}

export async function createCategory(
  db: Db,
  userId: string,
  input: { name: string; color: string },
): Promise<{ id: string }> {
  const familyId = await resolveWritableFamily(db, userId);
  const existing = await listCategories(db, familyId);
  if (existing.length >= MAX_CUSTOM_CATEGORIES) {
    throw new Error(`A household can have up to ${MAX_CUSTOM_CATEGORIES} categories`);
  }
  const name = assertCategoryName(input.name, existing);
  const color = assertCategoryColor(input.color);
  const { data, error } = await db
    .from("event_categories")
    .insert({ family_id: familyId, name, color, sort_order: nextSortOrder(existing) })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

export async function updateCategory(
  db: Db,
  userId: string,
  input: { id: string; name?: string; color?: string },
): Promise<void> {
  const familyId = await resolveWritableFamily(db, userId);
  const existing = await listCategories(db, familyId);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch["name"] = assertCategoryName(input.name, existing, input.id);
  if (input.color !== undefined) patch["color"] = assertCategoryColor(input.color);
  if (Object.keys(patch).length === 0) return;
  const { error } = await db
    .from("event_categories")
    .update(patch)
    .eq("id", input.id)
    .eq("family_id", familyId);
  if (error) throw error;
}

/** Removing a category never deletes events — they fall back to Uncategorized. */
export async function deleteCategory(db: Db, userId: string, id: string): Promise<void> {
  const familyId = await resolveWritableFamily(db, userId);
  const { error } = await db
    .from("event_categories")
    .delete()
    .eq("id", id)
    .eq("family_id", familyId);
  if (error) throw error;
}

export async function reorderCategories(db: Db, userId: string, ids: string[]): Promise<void> {
  const familyId = await resolveWritableFamily(db, userId);
  for (const [index, id] of ids.entries()) {
    const { error } = await db
      .from("event_categories")
      .update({ sort_order: index })
      .eq("id", id)
      .eq("family_id", familyId);
    if (error) throw error;
  }
}

/** One-tap starter set, only when the household has no categories yet. */
export async function seedDefaultCategories(db: Db, userId: string): Promise<{ added: number }> {
  const familyId = await resolveWritableFamily(db, userId);
  const existing = await listCategories(db, familyId);
  if (existing.length > 0) return { added: 0 };
  const rows = DEFAULT_CATEGORIES.map((c, index) => ({
    family_id: familyId,
    name: c.name,
    color: c.color,
    sort_order: index,
  }));
  const { error } = await db.from("event_categories").insert(rows);
  if (error) throw error;
  return { added: rows.length };
}

/* ------------------------------------------------------------ family members */

export interface FamilyMemberInput {
  id?: string | null;
  name: string;
  initial: string;
  color: string;
  role?: string;
  access?: string;
  active?: boolean;
}

function assertMemberColor(color: unknown): MemberColor {
  if (typeof color === "string" && (MEMBER_COLORS as string[]).includes(color)) {
    return color as MemberColor;
  }
  throw new Error("Choose a member color from the palette");
}

/**
 * Creates or edits one family-member record. Editing keeps the row's id, so
 * every existing event assignment (including per-person weekday rules) is
 * preserved; "remove" is expressed as active = false, never a delete.
 */
export async function saveFamilyMember(
  db: Db,
  userId: string,
  input: FamilyMemberInput,
): Promise<{ id: string }> {
  const current = await resolveCurrentFamily(db, userId);
  if (!current) throw new Error("No household found");
  await requireOwner(db, userId, current.familyId);

  const name = input.name.trim();
  if (!name) throw new Error("Give this person a name");
  const initial = (input.initial || name).trim().slice(0, 2).toUpperCase();
  const color = assertMemberColor(input.color);
  const role = ["parent", "child", "caregiver", "other"].includes(input.role ?? "")
    ? input.role
    : "other";
  const access = input.access === "full" ? "full" : "view_only";
  const active = input.active !== false;

  if (input.id) {
    const { error } = await db
      .from("family_members")
      .update({ name, initial, color, role, access, active })
      .eq("id", input.id)
      .eq("family_id", current.familyId);
    if (error) throw error;
    return { id: input.id };
  }

  const { data: siblings } = await db
    .from("family_members")
    .select("sort_order")
    .eq("family_id", current.familyId);
  const sortOrder =
    (siblings ?? []).reduce((max: number, m: any) => Math.max(max, m.sort_order ?? 0), -1) + 1;

  const { data, error } = await db
    .from("family_members")
    .insert({
      family_id: current.familyId,
      name,
      initial,
      color,
      role,
      access,
      active,
      sort_order: sortOrder,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string };
}
