# Favorites

Signed-in users can star companies and see them on `/favorites`, with the latest price, the day's change, market cap and links to Financials, the Intrinsic Value tool and News. Favorites belong to the Google account (see [`auth.md`](./auth.md)) and are stored in Postgres.

## Database

Favorites use any Postgres database through `DATABASE_URL`. [Neon](https://neon.tech) is the suggested host: it's plain Postgres with a free tier that resumes on the first request, while Supabase's free projects pause after a week without activity and bring auth and storage the app doesn't use. A Supabase connection string works the same way.

1. Create a database and copy its connection string (with `sslmode=require` for hosted databases). For Neon or Supabase, the pooled connection string is fine.
2. Add it to the environment file:

   ```
   DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
   ```

3. Create the table:

   ```bash
   npm run db:setup
   ```

   It runs `db/schema.sql`, which also creates the `transcripts` table (see [`transcripts.md`](./transcripts.md)), and is safe to run again.

The favorites table:

| Column | Type | Meaning |
| --- | --- | --- |
| `user_id` | text | The Google account id (the Auth.js token subject, exposed as `session.user.id`) |
| `symbol` | text | The ticker, upper case |
| `created_at` | timestamptz | When it was starred; the list shows newest first |

`(user_id, symbol)` is the primary key, so a ticker can only be saved once per user.

## Files

- `src/lib/db.ts`: the shared `postgres` pool (5 connections, no prepared statements so transaction poolers work).
- `src/lib/favorites.ts`: list, check and toggle favorites, with the 30-favorite limit.
- `src/app/favorites/actions.ts`: the `toggleFavoriteAction` server action, which takes the user from the session cookie, never from the browser, and a sign-in action that returns to the current page.
- `src/app/components/favorite-toggle.tsx` and `favorite-button.tsx`: the star beside the company name on the Overview and Financials headers. It updates straight away and reverts with a message if saving fails.
- `src/app/favorites/page.tsx`: the Favorites page.
- `db/schema.sql` and `scripts/setup-db.mjs`: the schema and `npm run db:setup`.

## Behavior

- Without the Google sign-in keys or `DATABASE_URL`, the star is hidden and the Favorites page explains what to set up.
- Signed out, the star and the Favorites page offer Google sign-in.
- The list is capped at 30 favorites, because each one costs an FMP quote request on the Favorites page (quotes are cached, so revisits are free).
- If the database is unreachable, company pages still load with an empty star, and the Favorites page says so.
