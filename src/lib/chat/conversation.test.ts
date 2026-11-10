import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatInstructions, describePage, MAX_CALLS_PER_ROUND, MAX_TOOL_ROUNDS, parseChatRequest, runChat, withPlace } from "./conversation";
import { MAX_HISTORY, MAX_MESSAGE_LENGTH, type ChatEvent } from "./protocol";

const NOW = new Date("2026-11-10T15:00:00Z");

function sse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const text = (value: string, finishReason?: string) => ({
  candidates: [{ content: { role: "model", parts: [{ text: value }] }, ...(finishReason ? { finishReason } : {}) }],
});

const calls = (...items: { name: string; args: Record<string, unknown>; id?: string; signature?: string }[]) => ({
  candidates: [{
    content: {
      role: "model",
      parts: items.map(({ name, args, id, signature }) => ({ functionCall: { name, args, ...(id ? { id } : {}) }, ...(signature ? { thoughtSignature: signature } : {}) })),
    },
  }],
});

const NEWS = [{ id: 1, headline: "Apple ships the iPhone Duo", datetime: 1_794_300_000, source: "Reuters", summary: "Demand is strong.", url: "https://example.com/a", related: "AAPL" }];

type GeminiBody = {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: string; parts: Record<string, unknown>[] }[];
  tools?: { functionDeclarations: { name: string }[] }[];
  toolConfig?: { functionCallingConfig: { mode: string } };
};

// Gemini answers with the given replies in turn; Finnhub with a headline.
function mockServices(replies: (() => Response | Promise<Response>)[]) {
  const geminiBodies: GeminiBody[] = [];
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "generativelanguage.googleapis.com") {
      geminiBodies.push(JSON.parse(String(init?.body)) as GeminiBody);
      const reply = replies.shift();
      if (!reply) throw new Error("Gemini was asked more often than expected");
      return reply();
    }
    if (url.hostname === "finnhub.io") return Response.json(NEWS);
    throw new Error(`Unexpected request to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, geminiBodies };
}

async function collect(events: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const all: ChatEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

const answerOf = (events: ChatEvent[]) => events.flatMap((event) => (event.type === "text" ? [event.text] : [])).join("");
const ask = (question: string) => [{ role: "user" as const, text: question }];

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "gemini-key");
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseChatRequest", () => {
  it("refuses what isn't a question", () => {
    expect(parseChatRequest(null)).toMatchObject({ ok: false });
    expect(parseChatRequest({ messages: [] })).toEqual({ ok: false, error: "Ask a question first." });
    expect(parseChatRequest({ messages: [{ role: "system", text: "Hi" }] })).toMatchObject({ ok: false });
    expect(parseChatRequest({ messages: [{ role: "user", text: "Hi" }, { role: "model", text: "Hello" }] })).toEqual({ ok: false, error: "Ask a question first." });
    expect(parseChatRequest({ messages: [{ role: "user", text: "x".repeat(MAX_MESSAGE_LENGTH + 1) }] })).toMatchObject({ ok: false, error: expect.stringMatching(/up to 4,000/) });
  });

  it("joins turns in a row, drops empty ones and keeps the latest, starting with a question", () => {
    const parsed = parseChatRequest({
      messages: [
        { role: "user", text: " First " },
        { role: "user", text: "Second" },
        { role: "model", text: "   " },
        { role: "model", text: "Answer" },
        { role: "user", text: "Third" },
      ],
    });
    expect(parsed).toEqual({
      ok: true,
      messages: [{ role: "user", text: "First\n\nSecond" }, { role: "model", text: "Answer" }, { role: "user", text: "Third" }],
      symbol: null,
      page: null,
    });

    const long = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "model" : "user", text: `turn ${index}` }));
    const trimmed = parseChatRequest({ messages: [...long, { role: "model", text: "last answer" }, { role: "user", text: "new" }] });
    expect(trimmed.ok && trimmed.messages.length).toBeLessThanOrEqual(MAX_HISTORY);
    expect(trimmed.ok && trimmed.messages[0].role).toBe("user");
  });

  it("reads where the question was asked", () => {
    expect(parseChatRequest({ messages: ask("Hi"), symbol: "brk.b", page: "/stock/financials?symbol=BRK-B" })).toMatchObject({ symbol: "BRK-B", page: "/stock/financials" });
    expect(parseChatRequest({ messages: ask("Hi"), symbol: "<script>", page: "https://evil.com" })).toMatchObject({ symbol: null, page: null });
  });
});

describe("where the user asked", () => {
  it("names a company's tab or one of StockPilot's pages", () => {
    expect(describePage("/stock/financials", "AAPL")).toBe("the Financials tab of Apple Inc. (AAPL)");
    expect(describePage("/valuation/dcf-calculator", "AAPL")).toBe("the Valuation tab of Apple Inc. (AAPL)");
    expect(describePage("/somewhere", "AAPL")).toBe("Apple Inc. (AAPL)");
    expect(describePage("/portfolio", null)).toBe("StockPilot's Portfolio page, which shows their own portfolio");
    expect(describePage("/unknown", null)).toBeNull();
    expect(withPlace("What's the P/E?", "Apple Inc. (AAPL)")).toBe("(Asked while looking at Apple Inc. (AAPL).)\nWhat's the P/E?");
    expect(withPlace("Hi", null)).toBe("Hi");
  });

  it("tells the model what it can say about the user's account", () => {
    const base = { today: "2026-11-10", personal: false, signedIn: false, canSignIn: true, located: false };
    expect(chatInstructions(base)).toMatch(/Tuesday, November 10, 2026/);
    expect(chatInstructions(base)).toMatch(/sign in with Google/);
    expect(chatInstructions({ ...base, canSignIn: false })).toMatch(/Sign-in isn't set up/);
    expect(chatInstructions({ ...base, personal: true, signedIn: true })).toMatch(/get_my_portfolio/);
    expect(chatInstructions(base)).not.toMatch(/note, in parentheses/);
    expect(chatInstructions({ ...base, located: true })).toMatch(/note, in parentheses/);
  });
});

describe("runChat", () => {
  it("streams an answer that needs no look-ups", async () => {
    const { geminiBodies } = mockServices([() => sse([text("A P/E ratio compares "), text("price with earnings.", "STOP")])]);
    const events = await collect(runChat({ messages: ask("What is a P/E ratio?"), userId: null, now: NOW }));
    expect(events).toEqual([{ type: "text", text: "A P/E ratio compares " }, { type: "text", text: "price with earnings." }]);
    expect(geminiBodies[0].contents).toEqual([{ role: "user", parts: [{ text: "What is a P/E ratio?" }] }]);
    const offered = geminiBodies[0].tools![0].functionDeclarations.map((declaration) => declaration.name);
    expect(offered).toContain("get_stock_overview");
    expect(offered).not.toContain("get_my_portfolio");
  });

  it("looks data up, shows it as a chip and answers from it, returning Gemini's signature", async () => {
    const { geminiBodies } = mockServices([
      () => sse([calls({ name: "get_company_news", args: { symbol: "aapl" }, id: "call-1", signature: "sig-1" }), text("", "STOP")]),
      () => sse([text("Apple shipped the iPhone Duo.", "STOP")]),
    ]);
    const events = await collect(runChat({ messages: ask("Any Apple news?"), userId: null, now: NOW }));

    expect(events).toEqual([
      { type: "tool", id: "0-0", label: "AAPL news", href: "/news?symbol=AAPL", status: "running" },
      { type: "tool", id: "0-0", label: "AAPL news", href: "/news?symbol=AAPL", status: "done" },
      { type: "text", text: "Apple shipped the iPhone Duo." },
    ]);
    const [, model, results] = geminiBodies[1].contents;
    expect(model).toEqual({ role: "model", parts: [{ functionCall: { name: "get_company_news", args: { symbol: "aapl" }, id: "call-1" }, thoughtSignature: "sig-1" }] });
    expect(results.role).toBe("user");
    expect(results.parts[0]).toMatchObject({
      functionResponse: { id: "call-1", name: "get_company_news", response: { output: { symbol: "AAPL", headlines: [{ title: "Apple ships the iPhone Duo", source: "Reuters" }] } } },
    });
  });

  it("runs a look-up asked for twice in one answer once", async () => {
    const { fetchMock } = mockServices([
      () => sse([calls({ name: "get_company_news", args: { symbol: "AAPL" } }, { name: "get_company_news", args: { symbol: "AAPL" } })]),
      () => sse([text("Done.", "STOP")]),
    ]);
    await collect(runChat({ messages: ask("News?"), userId: null, now: NOW }));
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("finnhub.io"))).toHaveLength(1);
  });

  it("makes the model answer after its rounds of look-ups, and refuses too many at once", async () => {
    const lookUp = (count: number) => () => sse([calls(...Array.from({ length: count }, (_, index) => ({ name: "find_stock", args: { query: `company ${index}` } })))]);
    const { geminiBodies } = mockServices([
      lookUp(MAX_CALLS_PER_ROUND + 2),
      ...Array.from({ length: MAX_TOOL_ROUNDS - 1 }, () => lookUp(1)),
      () => sse([text("Here is what I found.", "STOP")]),
    ]);
    const events = await collect(runChat({ messages: ask("Find them"), userId: null, now: NOW }));

    expect(answerOf(events)).toBe("Here is what I found.");
    expect(geminiBodies).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(geminiBodies.slice(0, -1).every((body) => body.toolConfig?.functionCallingConfig.mode === "AUTO")).toBe(true);
    expect(geminiBodies.at(-1)?.toolConfig?.functionCallingConfig.mode).toBe("NONE");
    const firstResults = geminiBodies[1].contents[2].parts as { functionResponse: { response: Record<string, unknown> } }[];
    expect(firstResults).toHaveLength(MAX_CALLS_PER_ROUND + 2);
    expect(firstResults.slice(0, MAX_CALLS_PER_ROUND).every((part) => "output" in part.functionResponse.response)).toBe(true);
    expect(firstResults.slice(MAX_CALLS_PER_ROUND).every((part) => /Too many look-ups/.test(String(part.functionResponse.response.error)))).toBe(true);
  });

  it("tries again once when Gemini is overloaded before writing anything", async () => {
    const { geminiBodies } = mockServices([() => new Response("{}", { status: 503 }), () => sse([text("Hello.", "STOP")])]);
    const events = await collect(runChat({ messages: ask("Hi"), userId: null, now: NOW }));
    expect(events).toEqual([{ type: "text", text: "Hello." }]);
    expect(geminiBodies).toHaveLength(2);
  });

  it("reports a failure after part of the answer instead of repeating it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { geminiBodies } = mockServices([() => sse([text("Apple's P/E is"), { error: { code: 503, status: "UNAVAILABLE" } }])]);
    const events = await collect(runChat({ messages: ask("P/E?"), userId: null, now: NOW }));
    expect(events).toEqual([{ type: "text", text: "Apple's P/E is" }, { type: "error", error: "Gemini is busy right now. Please try again in a moment." }]);
    expect(geminiBodies).toHaveLength(1);
  });

  it("explains an empty answer and notes a cut-off one", async () => {
    mockServices([() => sse([{ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }])]);
    expect(await collect(runChat({ messages: ask("Hmm"), userId: null, now: NOW }))).toEqual([{ type: "error", error: expect.stringMatching(/declined/) }]);

    mockServices([() => sse([text("A long answer", "MAX_TOKENS")])]);
    const events = await collect(runChat({ messages: ask("Tell me everything"), userId: null, now: NOW }));
    expect(events.at(-1)).toEqual({ type: "notice", text: expect.stringMatching(/cut off/) });
  });

  it("stops without an error when the user stops the answer", async () => {
    const controller = new AbortController();
    mockServices([() => {
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    }]);
    expect(await collect(runChat({ messages: ask("Hi"), userId: null, signal: controller.signal, now: NOW }))).toEqual([]);
  });

  it("puts the page beside the question, and offers the portfolio to a signed-in user with a database", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test");
    const { geminiBodies } = mockServices([() => sse([text("Its P/E is 39.1.", "STOP")])]);
    await collect(runChat({ messages: ask("What's the P/E?"), userId: "user-1", symbol: "AAPL", page: "/stock/financials", now: NOW }));
    const body = geminiBodies[0];
    expect(body.contents[0].parts[0].text).toBe("(Asked while looking at the Financials tab of Apple Inc. (AAPL).)\nWhat's the P/E?");
    expect(body.systemInstruction.parts[0].text).toMatch(/note, in parentheses/);
    expect(body.tools![0].functionDeclarations.map((declaration) => declaration.name)).toEqual(expect.arrayContaining(["get_my_portfolio", "get_my_favorites"]));
  });
});
