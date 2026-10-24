import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Google sign-in through Auth.js, with the session in an encrypted cookie (no database).
// Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    // Expose the Google account id, which keys the user's favorites.
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

// Without these the sign-in button is hidden, so the app still runs before Google is set up.
export function isAuthConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

// The signed-in user's id, or null when signed out or sign-in isn't configured.
export async function currentUserId(): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  const session = await auth();
  return session?.user?.id ?? null;
}
