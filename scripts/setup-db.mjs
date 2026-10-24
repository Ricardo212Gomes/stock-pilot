// Creates the tables in db/schema.sql in the database at DATABASE_URL.
import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env or .env.local first.");
  process.exit(1);
}

// "Already exists" notices on a second run are expected, so they are not printed.
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.unsafe(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  console.log("Database ready: favorites table created or already present.");
} finally {
  await sql.end();
}
