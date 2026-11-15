import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: { text: string; values: unknown[] }[] = [];
let answers: unknown[][] = [];
vi.mock("./db", () => ({
  getSql: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(answers.shift() ?? []);
  },
}));
vi.mock("./telegram", () => ({ botUsername: () => "bot", escapeHtml: (text: string) => text, findStartMessage: vi.fn(), sendTelegramMessage: vi.fn() }));

const { notificationRecipients } = await import("./notification-settings");

beforeEach(() => {
  queries.length = 0;
  answers = [];
});

describe("notificationRecipients", () => {
  it("includes users without Telegram, and sends to Telegram only when linked and on", async () => {
    answers = [[
      { user_id: "linked", telegram_chat_id: "100", telegram_alerts: true },
      { user_id: "telegram-off", telegram_chat_id: "200", telegram_alerts: false },
      { user_id: "favorites-only", telegram_chat_id: null, telegram_alerts: null },
    ]];
    await expect(notificationRecipients("news")).resolves.toEqual([
      { userId: "linked", chatId: "100", telegramLinked: true },
      { userId: "telegram-off", chatId: null, telegramLinked: true },
      { userId: "favorites-only", chatId: null, telegramLinked: false },
    ]);
    // Everyone with favorites or settings; each switch at its default until changed (reviews off).
    expect(queries[0].text).toMatch(/from \(select user_id from favorites union select user_id from notification_settings\) users/);
    expect(queries[0].text).toMatch(/when 'news' then coalesce\(settings\.news_alerts, true\)/);
    expect(queries[0].text).toMatch(/when 'reviews' then coalesce\(settings\.review_summaries, false\)/);
    expect(queries[0].values).toEqual(["news"]);
  });
});
