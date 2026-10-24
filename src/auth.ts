import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Google sign-in through Auth.js, with the session in an encrypted cookie (no database).
// Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
});

// Without these the sign-in button is hidden, so the app still runs before Google is set up.
export function isAuthConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}
