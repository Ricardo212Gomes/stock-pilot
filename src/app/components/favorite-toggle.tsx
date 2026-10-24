import { currentUserId, isAuthConfigured } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { isFavorite } from "@/lib/favorites";
import { FavoriteButton } from "./favorite-button";

// The favorite star for a company header; hidden until sign-in and the database are set up.
export async function FavoriteToggle({ symbol }: { symbol: string }) {
  if (!isAuthConfigured() || !isDatabaseConfigured()) return null;
  const userId = await currentUserId();
  let favorite = false;
  if (userId) {
    try {
      favorite = await isFavorite(userId, symbol);
    } catch {
      // A database outage shouldn't break the company page; the star starts empty.
    }
  }
  // The key gives each company (and each saved state) its own button: navigating between
  // companies reuses this spot in the page, which would otherwise keep the last company's star.
  return <FavoriteButton key={`${symbol}:${favorite}`} symbol={symbol} initial={favorite} signedIn={userId !== null} />;
}
