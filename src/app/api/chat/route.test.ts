import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@/lib/chat/protocol";

const session = vi.hoisted(() => ({ userId: null as string | null }));
const chat = vi.hoisted(() => ({
  calls: [] as { userId: string | null; symbol?: string | null; page?: string | null; signal?: AbortSignal }[],
  events: [] as ChatEvent[],
  // Holds the answer open until released, to test stopping mid-answer.
  hold: null as Promise<void> | null,
}));

vi.mock("@/auth", () => ({ currentUserId: async () => session.userId, isAuthConfigured: () => true }));
vi.mock("@/lib/chat/conversation", async (original) => ({
  ...(await original<typeof import("@/lib/chat/conversation")>()),
  runChat: async function* (options: (typeof chat.calls)[number]) {
    chat.calls.push(options);
    for (const event of chat.events) {
      yield event;
      if (chat.hold) await chat.hold;
    }
  },
}));

const { POST } = await import("./route");

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "localhost:3000", Origin: "http://localhost:3000", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const question = { messages: [{ role: "user", text: "How is Apple doing?" }], symbol: "aapl", page: "/stock/financials" };

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "gemini-key");
  session.userId = null;
  chat.calls = [];
  chat.events = [];
  chat.hold = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/chat", () => {
  it("only answers StockPilot's own pages, in JSON", async () => {
    expect((await POST(post(question, { Origin: "https://elsewhere.example" }))).status).toBe(403);
    expect((await POST(post(question, { "Content-Type": "text/plain" }))).status).toBe(403);
    expect(chat.calls).toHaveLength(0);
  });

  it("refuses without a Gemini key, a readable body or a question", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await POST(post(question))).status).toBe(503);
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    expect((await POST(post("{not json"))).status).toBe(400);
    const empty = await POST(post({ messages: [] }));
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toEqual({ error: "Ask a question first." });
    expect((await POST(post({ messages: [{ role: "user", text: "x".repeat(300_000) }] }))).status).toBe(413);
  });

  it("streams the answer as a JSON event a line, for the user and page that asked", async () => {
    session.userId = "user-1";
    chat.events = [
      { type: "tool", id: "0-0", label: "AAPL overview", href: "/stock?symbol=AAPL", status: "running" },
      { type: "text", text: "Apple is up 2%." },
    ];
    const response = await POST(post(question));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual(chat.events);
    expect(chat.calls[0]).toMatchObject({ userId: "user-1", symbol: "AAPL", page: "/stock/financials" });
  });

  it("stops the answer when the browser goes away", async () => {
    let release = () => {};
    chat.hold = new Promise((resolve) => {
      release = resolve;
    });
    chat.events = [{ type: "text", text: "First" }, { type: "text", text: "Second" }];
    const response = await POST(post(question));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(chat.calls[0].signal?.aborted).toBe(true);
    release();
  });
});
