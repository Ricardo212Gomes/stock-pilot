import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finnhubSymbol,
  getCompanyNews,
  getMarketNews,
  isNewsCategory,
  newsFailureMessage,
  normalizeItem,
  paginate,
  parseTickers,
  plainTextSummary,
  safeUrl,
} from "./finnhub-news";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function story(overrides: Record<string, unknown> = {}) {
  return {
    category: "company",
    datetime: 1792710826,
    headline: "Will Apple (AAPL) Change Macs With Its First Touchscreen MacBook Pro?",
    id: 143104514,
    image: "https://s.yimg.com/placeholder.png",
    related: "AAPL",
    source: "Yahoo",
    summary: "Apple plans to unveil its first touchscreen MacBook Pro.",
    url: "https://finnhub.io/api/news?id=2eed7344",
    ...overrides,
  };
}

function mockFinnhub(handler: (url: URL) => Response) {
  const fetchMock = vi.fn(async (input: URL | string) => handler(new URL(input)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type FetchCall = [URL, RequestInit & { next?: { revalidate?: number } }];

beforeEach(() => {
  vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("plainTextSummary", () => {
  it("turns HTML summaries into readable plain text", () => {
    expect(plainTextSummary("<p>Japan CPI, September 2026:</p><ul><li>Headline 2.1% &amp; core 1.9%</li></ul>"))
      .toBe("Japan CPI, September 2026: Headline 2.1% & core 1.9%.");
  });

  it("drops scripts and styles and never returns markup", () => {
    const text = plainTextSummary("<script>alert(1)</script><style>p{}</style><p>Safe <img src=x onerror=alert(1)> text</p>");
    expect(text).toBe("Safe text.");
    expect(text).not.toMatch(/[<>]/);
  });

  it("truncates at a word boundary", () => {
    const text = plainTextSummary("word ".repeat(100), 50);
    expect(text.length).toBeLessThanOrEqual(51);
    expect(text.endsWith("word…")).toBe(true);
  });
});

describe("safeUrl", () => {
  it("allows only http and https links", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});

describe("tickers", () => {
  it("parses related tickers and removes duplicates", () => {
    expect(parseTickers("AAPL,msft, AAPL")).toEqual(["AAPL", "MSFT"]);
    expect(parseTickers("")).toEqual([]);
    expect(parseTickers("<bad>")).toEqual([]);
  });

  it("writes share classes the way Finnhub expects", () => {
    expect(finnhubSymbol("brk-b")).toBe("BRK.B");
    expect(finnhubSymbol("BRK.B")).toBe("BRK.B");
  });
});

describe("normalizeItem", () => {
  it("maps Finnhub fields and converts the Unix time to UTC ISO", () => {
    expect(normalizeItem(story())).toEqual({
      id: "143104514",
      title: "Will Apple (AAPL) Change Macs With Its First Touchscreen MacBook Pro?",
      publishedAt: new Date(1792710826 * 1000).toISOString(),
      summary: "Apple plans to unveil its first touchscreen MacBook Pro.",
      url: "https://finnhub.io/api/news?id=2eed7344",
      source: "Yahoo",
      category: "company",
      tickers: ["AAPL"],
    });
  });

  it("skips items without a headline or time, and translated copies", () => {
    expect(normalizeItem(story({ headline: " " }))).toBeNull();
    expect(normalizeItem(story({ datetime: "soon" }))).toBeNull();
    expect(normalizeItem(story({ headline: "Datavault AI签署不具约束力的意向书" }))).toBeNull();
    expect(normalizeItem(null)).toBeNull();
  });

  it("drops a trailing source from wire headlines and summaries that repeat the headline", () => {
    const item = normalizeItem(story({
      source: "Reuters",
      headline: "US regulator is probing oil trading, official says - Reuters",
      summary: "US regulator is probing oil trading, official says\u00a0\u00a0Reuters",
    }));
    expect(item?.title).toBe("US regulator is probing oil trading, official says");
    expect(item?.summary).toBe("");
    expect(normalizeItem(story({ headline: "Apple - the review", source: "Yahoo" }))?.title).toBe("Apple - the review");
  });

  it("keeps an item with an unsafe link, without the link", () => {
    expect(normalizeItem(story({ url: "javascript:alert(1)" }))?.url).toBeNull();
  });
});

describe("getMarketNews", () => {
  it("requests the category with the key in a header, newest first and de-duplicated", async () => {
    const fetchMock = mockFinnhub(() => json([
      story({ id: 1, datetime: 100, headline: "Older", url: "https://a.com/1" }),
      story({ id: 2, datetime: 300, headline: "Newest", url: "https://a.com/2" }),
      story({ id: 3, datetime: 200, headline: "Copy", url: "https://a.com/2" }),
    ]));

    const result = await getMarketNews("merger");
    expect(result.ok && result.items.map((item) => item.title)).toEqual(["Newest", "Older"]);

    const [input, init] = fetchMock.mock.calls[0] as unknown as FetchCall;
    const url = new URL(input);
    expect(url.pathname).toBe("/api/v1/news");
    expect(url.searchParams.get("category")).toBe("merger");
    expect(url.toString()).not.toContain("finnhub-key");
    expect((init.headers as Record<string, string>)["X-Finnhub-Token"]).toBe("finnhub-key");
    expect(init.next?.revalidate).toBe(60 * 15);
  });

  it.each([
    [429, "rate-limited"],
    [401, "invalid-key"],
    [403, "plan-restricted"],
    [500, "provider-error"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    mockFinnhub(() => json({ error: "nope" }, status));
    await expect(getMarketNews()).resolves.toEqual({ ok: false, reason });
  });

  it("reports missing keys, network failures and unexpected payloads", async () => {
    mockFinnhub(() => json({ error: "not a list" }));
    await expect(getMarketNews()).resolves.toEqual({ ok: false, reason: "provider-error" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(getMarketNews()).resolves.toEqual({ ok: false, reason: "provider-error" });

    vi.stubEnv("FINNHUB_API_KEY", "");
    await expect(getMarketNews()).resolves.toEqual({ ok: false, reason: "not-configured" });
  });
});

describe("getCompanyNews", () => {
  it("asks for the last 14 days using Finnhub's symbol format", async () => {
    const fetchMock = mockFinnhub(() => json([story({ related: "BRK.B" })]));

    const result = await getCompanyNews("BRK-B", new Date("2026-10-23T12:00:00Z"));
    expect(result.ok && result.items[0].tickers).toEqual(["BRK.B"]);

    const url = new URL((fetchMock.mock.calls[0] as unknown as FetchCall)[0]);
    expect(url.pathname).toBe("/api/v1/company-news");
    expect(Object.fromEntries(url.searchParams)).toEqual({ symbol: "BRK.B", from: "2026-10-09", to: "2026-10-23" });
  });
});

describe("helpers", () => {
  it("recognizes only supported categories", () => {
    expect(isNewsCategory("crypto")).toBe(true);
    expect(isNewsCategory("sports")).toBe(false);
    expect(isNewsCategory(undefined)).toBe(false);
  });

  it("pages through items and clamps out-of-range pages", () => {
    const items = Array.from({ length: 60 }, (_, index) => index);
    expect(paginate(items, 0)).toMatchObject({ page: 0, pageCount: 3, items: items.slice(0, 25) });
    expect(paginate(items, 9)).toMatchObject({ page: 2, items: items.slice(50) });
    expect(paginate([], 3)).toMatchObject({ page: 0, pageCount: 1, items: [] });
  });

  it("explains each failure with the right setting to check", () => {
    expect(newsFailureMessage("not-configured", "news")).toMatch(/FINNHUB_API_KEY/);
    expect(newsFailureMessage("rate-limited", "crypto news")).toMatch(/request limit.*crypto news/);
  });
});
