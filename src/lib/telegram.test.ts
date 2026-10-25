import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, findStartMessage, sendTelegramMessage, splitMessage } from "./telegram";

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "@StockPilotBot");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("splitMessage", () => {
  it("keeps short messages whole and splits long ones at paragraph breaks", () => {
    expect(splitMessage("a\n\nb")).toEqual(["a\n\nb"]);
    expect(splitMessage("aaaa\n\nbbbb\n\ncc", 10)).toEqual(["aaaa\n\nbbbb", "cc"]);
    expect(splitMessage("x".repeat(15), 10)).toEqual(["xxxxxxxxx…"]);
  });

  it("escapes HTML", () => {
    expect(escapeHtml("P&G <up>")).toBe("P&amp;G &lt;up&gt;");
  });
});

describe("Telegram API", () => {
  it("sends HTML messages to the chat", async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({ ok: true, result: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendTelegramMessage("42", "<b>Hi</b>")).resolves.toEqual({ ok: true, result: null });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ chat_id: "42", text: "<b>Hi</b>", parse_mode: "HTML" });
  });

  it("finds the chat that sent /start with the code, and reports Telegram errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, result: [
      { message: { text: "/start other", chat: { id: 1, first_name: "Someone" } } },
      { message: { text: "/start abc123", chat: { id: 77, first_name: "Ricardo", username: "ricardo" } } },
    ] })));
    await expect(findStartMessage("abc123")).resolves.toEqual({ ok: true, result: { chatId: "77", name: "@ricardo" } });
    await expect(findStartMessage("nope")).resolves.toEqual({ ok: true, result: null });

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, description: "Unauthorized" }, { status: 401 })));
    await expect(sendTelegramMessage("42", "hi")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/rejected the bot token/) });
  });
});
