# Google sign-in

StockPilot signs users in with Google through [Auth.js](https://authjs.dev) (`next-auth` v5). Any Google account can sign in. Signing in lets users save favorites and keep a portfolio (see [`favorites.md`](./favorites.md) and [`portfolio.md`](./portfolio.md)).

There is no database. After Google confirms the account, Auth.js stores the user's name, email and picture in an encrypted, HTTP-only cookie (`authjs.session-token`) that lasts 30 days.

## Files

- `src/auth.ts`: the Auth.js configuration with the Google provider, and `isAuthConfigured()`.
- `src/app/api/auth/[...nextauth]/route.ts`: the Auth.js endpoints (`/api/auth/signin/google`, `/api/auth/callback/google`, `/api/auth/signout`, `/api/auth/session`).
- `src/app/components/user-menu.tsx`: the top bar control. It shows **Sign in** when signed out, and the Google avatar (or initials) when signed in, which opens a menu with the name, email, a **Settings** link (notifications and data sources) and **Sign out**. Both buttons are server actions, so the menu needs no client JavaScript.

## Set up

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**. Configure the OAuth consent screen first if asked; the default scopes (email, profile, openid) are enough.
2. Add the authorized redirect URI `http://localhost:3000/api/auth/callback/google`, plus `https://<your-domain>/api/auth/callback/google` for each deployment.
3. Put the client ID and secret in your environment file, with a random secret that encrypts the cookie. Don't use `npx auth secret`: the `auth` package on npm is now Better Auth's CLI and prints a `BETTER_AUTH_SECRET`, which Auth.js ignores.

   ```
   AUTH_SECRET=        # openssl rand -base64 33
   AUTH_GOOGLE_ID=
   AUTH_GOOGLE_SECRET=
   AUTH_TRUST_HOST=true
   ```

   `AUTH_TRUST_HOST` lets Auth.js trust the request's host with `next start`; on Vercel it isn't needed. Alternatively set `AUTH_URL` to the public URL.
4. Restart the server.

Until `AUTH_SECRET`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are all set, the Sign in button is hidden and the rest of the app works as before. While the consent screen is in **Testing** mode, Google only lets the test users you list sign in; publish it to allow any account.

## Using the session

In server components and server actions, `await auth()` from `@/auth` returns the session (`session.user.name`, `email`, `image`) or `null`. Reading it makes the page render per request, which every page already does.
