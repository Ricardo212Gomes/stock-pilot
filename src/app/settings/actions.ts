"use server";

import { refresh } from "next/cache";
import { currentUserId } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import {
  confirmTelegramLink,
  disconnectTelegram,
  getNotificationSettings,
  setNotificationPreferences,
  startTelegramLink,
  telegramStartLink,
} from "@/lib/notification-settings";
import { isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";

export type SettingsActionResult = { ok: true; message?: string; link?: string } | { ok: false; error: string };

// Every action works on the signed-in user from the session cookie, never on ids from the browser.
async function signedIn(): Promise<string | SettingsActionResult> {
  if (!isTelegramConfigured() || !isDatabaseConfigured()) return { ok: false, error: "Telegram notifications aren't set up on this server." };
  const userId = await currentUserId();
  return userId ?? { ok: false, error: "Sign in to change your notifications." };
}

export async function startTelegramLinkAction(): Promise<SettingsActionResult> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  const code = await startTelegramLink(userId);
  refresh();
  return { ok: true, link: telegramStartLink(code) };
}

export async function confirmTelegramLinkAction(): Promise<SettingsActionResult> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  const result = await confirmTelegramLink(userId);
  if (!result.ok) return result;
  refresh();
  return { ok: true, message: `Connected to ${result.name}.` };
}

export async function sendTestMessageAction(): Promise<SettingsActionResult> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  const settings = await getNotificationSettings(userId);
  if (!settings.telegramChatId) return { ok: false, error: "Connect Telegram first." };
  const sent = await sendTelegramMessage(settings.telegramChatId, "🔔 <b>Test from StockPilot</b>\n\nNotifications for your favorites will arrive here.");
  return sent.ok ? { ok: true, message: "Test message sent. Check Telegram." } : { ok: false, error: sent.error };
}

export async function disconnectTelegramAction(): Promise<SettingsActionResult> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  await disconnectTelegram(userId);
  refresh();
  return { ok: true, message: "Telegram disconnected." };
}

export async function savePreferencesAction(earningsAlerts: boolean, transcriptSummaries: boolean): Promise<SettingsActionResult> {
  const userId = await signedIn();
  if (typeof userId !== "string") return userId;
  await setNotificationPreferences(userId, { earningsAlerts: earningsAlerts === true, transcriptSummaries: transcriptSummaries === true });
  refresh();
  return { ok: true, message: "Saved." };
}
