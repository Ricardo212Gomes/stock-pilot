"use server";

import { refresh } from "next/cache";
import { currentUserId } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { latestNotifications, markRead, unreadCount, type InboxNotification } from "@/lib/notification-inbox";

// The bell's and the Notifications page's actions. The user always comes from the session cookie; ids from the
// browser only ever match that user's own notifications.

export type BellItem = Omit<InboxNotification, "body">;
export type BellState = { ok: true; unread: number; items: BellItem[] } | { ok: false };

async function user(): Promise<string | null> {
  return isDatabaseConfigured() ? currentUserId() : null;
}

export async function loadBell(userId: string): Promise<BellState> {
  try {
    const [unread, items] = await Promise.all([unreadCount(userId), latestNotifications(userId)]);
    // The bell only shows titles; the messages stay on the Notifications page.
    return {
      ok: true,
      unread,
      items: items.map((item) => ({ id: item.id, kind: item.kind, title: item.title, symbols: item.symbols, telegramStatus: item.telegramStatus, createdAt: item.createdAt, read: item.read })),
    };
  } catch {
    return { ok: false };
  }
}

// Called when the bell opens, so it's current without polling.
export async function refreshBellAction(): Promise<BellState> {
  const userId = await user();
  return userId ? loadBell(userId) : { ok: false };
}

export async function markReadAction(ids: string[]): Promise<{ ok: boolean }> {
  const userId = await user();
  if (!userId || !Array.isArray(ids)) return { ok: false };
  try {
    await markRead(userId, ids);
    refresh();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function markAllReadAction(): Promise<{ ok: boolean }> {
  const userId = await user();
  if (!userId) return { ok: false };
  try {
    await markRead(userId, "all");
    refresh();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
