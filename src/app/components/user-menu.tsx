import Link from "next/link";
import { auth, isAuthConfigured, signIn, signOut } from "@/auth";

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.trim() || "?";
  return source.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

// Sign in with Google, or the signed-in user's avatar with a sign-out menu.
export async function UserMenu() {
  if (!isAuthConfigured()) return null;
  const session = await auth();
  const user = session?.user;

  if (!user) {
    return (
      <form
        action={async () => {
          "use server";
          await signIn("google");
        }}
      >
        <button className="theme-toggle user-sign-in" type="submit" title="Sign in with Google">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="7" r="3.25" />
            <path d="M3.75 16.5c.9-2.9 3.3-4.5 6.25-4.5s5.35 1.6 6.25 4.5" />
          </svg>
          <span>Sign in</span>
        </button>
      </form>
    );
  }

  return (
    <details className="user-menu">
      <summary aria-label={`Account: ${user.name ?? user.email ?? "signed in"}`} title={user.name ?? user.email ?? undefined}>
        {user.image ? (
          // Google's avatar URL; next/image would need its host configured for no real gain here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" width={36} height={36} referrerPolicy="no-referrer" />
        ) : (
          <span className="user-initials">{initials(user.name, user.email)}</span>
        )}
      </summary>
      <div className="user-menu-panel">
        {user.name && <strong>{user.name}</strong>}
        {user.email && <span>{user.email}</span>}
        <Link className="user-menu-link" href="/settings">Settings</Link>
        <form
          action={async () => {
            "use server";
            await signOut();
          }}
        >
          <button type="submit">Sign out</button>
        </form>
      </div>
    </details>
  );
}
