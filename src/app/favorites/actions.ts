"use server";

import { refresh } from "next/cache";
import { currentUserId, signIn } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { MAX_FAVORITES, toggleFavorite } from "@/lib/favorites";

export type ToggleFavoriteResult = { ok: true; favorite: boolean } | { ok: false; error: string };

// The user comes from the session cookie, never from the browser.
export async function toggleFavoriteAction(symbol: string): Promise<ToggleFavoriteResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in to save favorites." };
  if (!isDatabaseConfigured()) return { ok: false, error: "Favorites need a database. Set DATABASE_URL." };

  try {
    const result = await toggleFavorite(userId, symbol);
    if (!result.ok) {
      return {
        ok: false,
        error: result.reason === "limit" ? `You can keep up to ${MAX_FAVORITES} favorites. Remove one first.` : "That isn't a valid ticker.",
      };
    }
    refresh();
    return result;
  } catch {
    return { ok: false, error: "Favorites couldn't be saved. Check the database connection." };
  }
}

// Sends the user to Google and back to the page they were on.
export async function signInFromAction(redirectTo: string) {
  await signIn("google", { redirectTo: redirectTo.startsWith("/") ? redirectTo : "/" });
}
