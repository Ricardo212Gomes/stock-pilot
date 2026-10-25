import postgres, { type Sql } from "postgres";

// One Postgres pool per server process, from DATABASE_URL (Neon, Supabase or any Postgres).
// Kept on globalThis so development reloads don't open a new pool each time.
const globalForDb = globalThis as typeof globalThis & { stockPilotSql?: Sql };

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getSql(): Sql {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  globalForDb.stockPilotSql ??= postgres(process.env.DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    // Supabase's and Neon's poolers run in transaction mode, which doesn't support prepared statements.
    prepare: false,
  });
  return globalForDb.stockPilotSql;
}
