import { randomBytes } from "node:crypto";
import { getSql } from "./db";
import { botUsername, escapeHtml, findStartMessage, sendTelegramMessage } from "./telegram";

// Each user's Telegram chat and notification preferences, plus a log of what was sent.

// Linking codes are short-lived: they only need to survive a trip to Telegram and back.
const LINK_CODE_MINUTES = 30;

export type NotificationSettings = {
  telegramChatId: string | null;
  telegramName: string | null;
  earningsAlerts: boolean;
  transcriptSummaries: boolean;
  newsAlerts: boolean;
  filingAlerts: boolean;
  linkCode: string | null;
};

export type NotificationKind = "earnings" | "transcripts" | "news" | "filings";
export type NotificationPreferences = Pick<NotificationSettings, "earningsAlerts" | "transcriptSummaries" | "newsAlerts" | "filingAlerts">;

type SettingsRow = {
  user_id: string;
  telegram_chat_id: string | null;
  telegram_name: string | null;
  earnings_alerts: boolean;
  transcript_summaries: boolean;
  news_alerts: boolean;
  filing_alerts: boolean;
  link_code: string | null;
  link_code_expires_at: Date | null;
};

const DEFAULTS: NotificationSettings = {
  telegramChatId: null,
  telegramName: null,
  earningsAlerts: true,
  transcriptSummaries: true,
  newsAlerts: true,
  filingAlerts: true,
  linkCode: null,
};

function toSettings(row: SettingsRow | undefined, now = Date.now()): NotificationSettings {
  if (!row) return DEFAULTS;
  const codeValid = row.link_code && row.link_code_expires_at && row.link_code_expires_at.getTime() > now;
  return {
    telegramChatId: row.telegram_chat_id,
    telegramName: row.telegram_name,
    earningsAlerts: row.earnings_alerts,
    transcriptSummaries: row.transcript_summaries,
    newsAlerts: row.news_alerts,
    filingAlerts: row.filing_alerts,
    linkCode: codeValid ? row.link_code : null,
  };
}

export async function getNotificationSettings(userId: string): Promise<NotificationSettings> {
  const [row] = await getSql()<SettingsRow[]>`select * from notification_settings where user_id = ${userId}`;
  return toSettings(row);
}

export function telegramStartLink(code: string): string {
  return `https://t.me/${botUsername()}?start=${code}`;
}

// A fresh one-time code; the user sends it to the bot by opening the start link.
export async function startTelegramLink(userId: string): Promise<string> {
  const code = randomBytes(6).toString("hex");
  await getSql()`
    insert into notification_settings (user_id, link_code, link_code_expires_at)
    values (${userId}, ${code}, now() + make_interval(mins => ${LINK_CODE_MINUTES}))
    on conflict (user_id) do update
      set link_code = excluded.link_code, link_code_expires_at = excluded.link_code_expires_at, updated_at = now()
  `;
  return code;
}

export type LinkResult = { ok: true; name: string } | { ok: false; error: string };

// Looks for the user's /start message, saves the chat and says hello there.
export async function confirmTelegramLink(userId: string): Promise<LinkResult> {
  const settings = await getNotificationSettings(userId);
  if (!settings.linkCode) return { ok: false, error: "The link expired. Start again with Connect Telegram." };

  const found = await findStartMessage(settings.linkCode);
  if (!found.ok) return { ok: false, error: found.error };
  if (!found.result) return { ok: false, error: "No Start message yet. Open the bot in Telegram, press Start, then try again." };

  const { chatId, name } = found.result;
  await getSql()`
    update notification_settings
    set telegram_chat_id = ${chatId}, telegram_name = ${name}, link_code = null, link_code_expires_at = null, updated_at = now()
    where user_id = ${userId}
  `;
  await sendTelegramMessage(chatId, `✅ <b>StockPilot is connected.</b>\n\nYou'll get alerts here for your favorites, ${escapeHtml(name)}. Change them any time in Settings.`);
  return { ok: true, name };
}

export async function disconnectTelegram(userId: string): Promise<void> {
  await getSql()`
    update notification_settings
    set telegram_chat_id = null, telegram_name = null, link_code = null, link_code_expires_at = null, updated_at = now()
    where user_id = ${userId}
  `;
}

export async function setNotificationPreferences(userId: string, preferences: NotificationPreferences): Promise<void> {
  await getSql()`
    insert into notification_settings (user_id, earnings_alerts, transcript_summaries, news_alerts, filing_alerts)
    values (${userId}, ${preferences.earningsAlerts}, ${preferences.transcriptSummaries}, ${preferences.newsAlerts}, ${preferences.filingAlerts})
    on conflict (user_id) do update
      set earnings_alerts = excluded.earnings_alerts,
          transcript_summaries = excluded.transcript_summaries,
          news_alerts = excluded.news_alerts,
          filing_alerts = excluded.filing_alerts,
          updated_at = now()
  `;
}

export type Recipient = { userId: string; chatId: string };

const PREFERENCE_COLUMN: Record<NotificationKind, string> = {
  earnings: "earnings_alerts",
  transcripts: "transcript_summaries",
  news: "news_alerts",
  filings: "filing_alerts",
};

// Users with a linked chat who want this kind of notification.
export async function notificationRecipients(kind: NotificationKind): Promise<Recipient[]> {
  const sql = getSql();
  const rows = await sql<{ user_id: string; telegram_chat_id: string }[]>`
    select user_id, telegram_chat_id from notification_settings
    where telegram_chat_id is not null and ${sql(PREFERENCE_COLUMN[kind])} = true
  `;
  return rows.map((row) => ({ userId: row.user_id, chatId: row.telegram_chat_id }));
}

export async function wasSent(userId: string, kind: string, item: string): Promise<boolean> {
  const rows = await getSql()`select 1 from notification_log where user_id = ${userId} and kind = ${kind} and item = ${item}`;
  return rows.length > 0;
}

export async function markSent(userId: string, kind: string, item: string): Promise<void> {
  await getSql()`insert into notification_log (user_id, kind, item) values (${userId}, ${kind}, ${item}) on conflict do nothing`;
}
