// Telegram Bot API: sending messages and finding the /start message that links a chat.
// Linking reads the bot's pending updates (getUpdates), so it works without a public webhook.

const API_URL = "https://api.telegram.org";
// Telegram's limit is 4,096 characters; leave room for the HTML tags.
const MESSAGE_LIMIT = 3900;

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME);
}

export function botUsername(): string {
  return (process.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Telegram's own wording, explained where it points at the setup.
export function friendlyError(description: string): string {
  if (/unauthorized|not found/i.test(description)) return "Telegram rejected the bot token. Check TELEGRAM_BOT_TOKEN (from @BotFather) and restart the server.";
  if (/webhook is active/i.test(description)) return "The bot has a webhook set, which blocks linking. Remove it with Telegram's deleteWebhook method and try again.";
  if (/chat not found|bot was blocked/i.test(description)) return "Telegram can't reach this chat: it was deleted or the bot was blocked. Connect Telegram again.";
  return `Telegram: ${description}`;
}

type TelegramResult<T> = { ok: true; result: T } | { ok: false; error: string };

async function call<T>(method: string, body: Record<string, unknown>): Promise<TelegramResult<T>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not set." };
  try {
    // The token is part of Telegram's URL scheme; it never reaches logs or the browser.
    const response = await fetch(`${API_URL}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json()) as { ok?: boolean; result?: T; description?: string };
    if (!payload.ok) return { ok: false, error: friendlyError(payload.description ?? `Telegram returned ${response.status}.`) };
    return { ok: true, result: payload.result as T };
  } catch {
    return { ok: false, error: "Telegram didn't respond. Try again in a moment." };
  }
}

// Splits a long message at paragraph breaks so each part stays under Telegram's limit.
export function splitMessage(html: string, limit = MESSAGE_LIMIT): string[] {
  const parts: string[] = [];
  let current = "";
  for (const paragraph of html.split("\n\n")) {
    const piece = paragraph.length > limit ? paragraph.slice(0, limit - 1) + "…" : paragraph;
    if (current && current.length + 2 + piece.length > limit) {
      parts.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export async function sendTelegramMessage(chatId: string, html: string): Promise<TelegramResult<null>> {
  for (const text of splitMessage(html)) {
    const result = await call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    if (!result.ok) return result;
  }
  return { ok: true, result: null };
}

type Update = { message?: { text?: string; chat?: { id?: number; first_name?: string; username?: string } } };

// The chat that sent "/start <code>" to the bot, if it's among the pending updates.
export async function findStartMessage(code: string): Promise<TelegramResult<{ chatId: string; name: string } | null>> {
  const updates = await call<Update[]>("getUpdates", { allowed_updates: ["message"], timeout: 0 });
  if (!updates.ok) return updates;
  const match = [...updates.result].reverse().find((update) => update.message?.text?.trim() === `/start ${code}`);
  const chat = match?.message?.chat;
  if (!chat?.id) return { ok: true, result: null };
  return { ok: true, result: { chatId: String(chat.id), name: chat.username ? `@${chat.username}` : chat.first_name ?? "Telegram" } };
}
