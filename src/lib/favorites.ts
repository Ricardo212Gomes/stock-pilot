import { getSql } from "./db";
import { normalizeTicker } from "./fmp";

// Each favorite costs an FMP quote request on the Favorites page, so the list stays short.
export const MAX_FAVORITES = 30;

export type Favorite = { symbol: string; createdAt: string };

export async function listFavorites(userId: string): Promise<Favorite[]> {
  const rows = await getSql()<{ symbol: string; created_at: Date }[]>`
    select symbol, created_at from favorites where user_id = ${userId} order by created_at desc
  `;
  return rows.map((row) => ({ symbol: row.symbol, createdAt: row.created_at.toISOString() }));
}

export async function isFavorite(userId: string, symbol: string): Promise<boolean> {
  const rows = await getSql()`select 1 from favorites where user_id = ${userId} and symbol = ${symbol} limit 1`;
  return rows.length > 0;
}

export type ToggleResult =
  | { ok: true; favorite: boolean }
  | { ok: false; reason: "invalid-symbol" | "limit" };

// Adds the ticker if it isn't a favorite yet, otherwise removes it.
export async function toggleFavorite(userId: string, rawSymbol: unknown): Promise<ToggleResult> {
  const symbol = normalizeTicker(rawSymbol);
  if (!symbol) return { ok: false, reason: "invalid-symbol" };

  const sql = getSql();
  const removed = await sql`delete from favorites where user_id = ${userId} and symbol = ${symbol} returning symbol`;
  if (removed.length > 0) return { ok: true, favorite: false };

  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from favorites where user_id = ${userId}`;
  if (count >= MAX_FAVORITES) return { ok: false, reason: "limit" };
  await sql`insert into favorites (user_id, symbol) values (${userId}, ${symbol}) on conflict do nothing`;
  return { ok: true, favorite: true };
}
