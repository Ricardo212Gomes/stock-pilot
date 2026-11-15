"use server";

import { refresh } from "next/cache";
import { currentUserId } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import {
  createSavedProjection,
  deleteSavedProjection,
  renameSavedProjection,
  updateSavedProjection,
  type SaveInput,
} from "@/lib/saved-projections";

export type SavedActionResult = { ok: true; id: string } | { ok: false; error: string };

async function signedInUser(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in to save projections." };
  if (!isDatabaseConfigured()) return { ok: false, error: "Saving projections needs a database. Set DATABASE_URL." };
  return { ok: true, userId };
}

const DATABASE_ERROR = "The projection couldn't be saved. Check the database connection.";

// A new save, or, with an id, saving again over that one. The user comes from the session cookie, never the browser.
export async function saveProjectionAction(input: SaveInput & { id?: string | null }): Promise<SavedActionResult> {
  const user = await signedInUser();
  if (!user.ok) return user;
  try {
    const result = input.id ? await updateSavedProjection(user.userId, input.id, input) : await createSavedProjection(user.userId, input);
    if (!result.ok) return { ok: false, error: result.message };
    refresh();
    return result;
  } catch {
    return { ok: false, error: DATABASE_ERROR };
  }
}

export async function renameProjectionAction(id: string, name: string): Promise<SavedActionResult> {
  const user = await signedInUser();
  if (!user.ok) return user;
  try {
    const result = await renameSavedProjection(user.userId, id, name);
    if (!result.ok) return { ok: false, error: result.message };
    refresh();
    return result;
  } catch {
    return { ok: false, error: DATABASE_ERROR };
  }
}

export async function deleteProjectionAction(id: string): Promise<SavedActionResult> {
  const user = await signedInUser();
  if (!user.ok) return user;
  try {
    if (!(await deleteSavedProjection(user.userId, id))) return { ok: false, error: "That saved projection no longer exists." };
    refresh();
    return { ok: true, id };
  } catch {
    return { ok: false, error: "The projection couldn't be deleted. Check the database connection." };
  }
}
