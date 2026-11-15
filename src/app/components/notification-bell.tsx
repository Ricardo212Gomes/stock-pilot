import { currentUserId, isAuthConfigured } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { loadBell } from "../notifications/inbox-actions";
import { NotificationBellPanel } from "./notification-bell-panel";

// The bell in the top bar, for signed-in users with a database: the unread count comes with the page.
export async function NotificationBell() {
  if (!isAuthConfigured() || !isDatabaseConfigured()) return null;
  const userId = await currentUserId();
  if (!userId) return null;
  const state = await loadBell(userId);
  // Before `npm run db:setup` adds the table, the bell stays away rather than breaking the top bar.
  if (!state.ok) return null;
  return <NotificationBellPanel initial={state} />;
}
