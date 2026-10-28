import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EarningsEvent } from "./earnings-calendar";

const state = {
  recipients: [] as { userId: string; chatId: string }[],
  favorites: {} as Record<string, string[]>,
  sent: new Set<string>(),
  messages: [] as { chatId: string; text: string }[],
  events: [] as EarningsEvent[],
  report: { quarter: "2026Q4", date: "2026-10-20" as string | null },
  summary: { ok: true, summary: { overview: "Strong <quarter>.", highlights: ["ARR up 22%."], outlook: [], analystQuestions: [], tone: "positive", toneReason: "Raised guidance." } } as unknown,
  news: [] as { id: string; title: string; summary: string; source: string; url: string; publishedAt: string; tickers: string[]; category: null }[],
  filings: [] as { accession: string; form: string; filed: string; period: string | null; items: string[]; description: string; documentUrl: string; indexUrl: string }[],
  analyzed: 0,
};

vi.mock("./notification-settings", () => ({
  notificationRecipients: async () => state.recipients,
  wasSent: async (userId: string, kind: string, item: string) => state.sent.has(`${userId}|${kind}|${item}`),
  markSent: async (userId: string, kind: string, item: string) => void state.sent.add(`${userId}|${kind}|${item}`),
}));
vi.mock("./favorites", () => ({ listFavorites: async (userId: string) => (state.favorites[userId] ?? []).map((symbol) => ({ symbol, createdAt: "" })) }));
vi.mock("./telegram", async (original) => ({
  ...(await original<typeof import("./telegram")>()),
  sendTelegramMessage: async (chatId: string, text: string) => {
    state.messages.push({ chatId, text });
    return { ok: true, result: null };
  },
}));
vi.mock("./earnings-calendar", async (original) => ({
  ...(await original<typeof import("./earnings-calendar")>()),
  getEarningsWeek: async () => ({ ok: true, data: { days: [{ date: "", count: 0, groups: [{ time: "amc", events: state.events }] }] } }),
}));
vi.mock("./transcripts", async (original) => ({ ...(await original<typeof import("./transcripts")>()), latestReport: async () => state.report }));
vi.mock("./transcript-summary", () => ({ ensureTranscriptSummary: async () => state.summary }));
vi.mock("./finnhub-news", () => ({ getCompanyNews: async () => ({ ok: true, items: state.news }) }));
vi.mock("./news-digest", () => ({
  CANDIDATES_PER_SYMBOL: 6,
  selectNews: async (candidates: { id: string }[]) => ({ aiSelected: true, picks: candidates.slice(0, 1).map((item) => ({ ...item, why: "It matters." })) }),
}));
vi.mock("./sec-filings", () => ({
  getFilings: async () => ({ ok: true, data: { name: "CrowdStrike", cik: "1", filings: state.filings } }),
  isEarningsRelease: (filing: { form: string; items: string[] }) => filing.form === "8-K" && filing.items.includes("2.02"),
  pressReleaseUrl: async () => "https://www.sec.gov/a1-ex991.htm",
}));
vi.mock("./filing-analysis", async (original) => ({
  ...(await original<typeof import("./filing-analysis")>()),
  ensureFilingAnalysis: async () => {
    state.analyzed += 1;
    return { ok: true, analysis: { headline: "Q2 beat", summary: "Revenue rose 22%.", keyPoints: ["ARR $5.3B"], watch: [], sentiment: "positive" } };
  },
}));

const { earningsMessage, runEarningsAlerts, runFilingAlerts, runNewsDigest, runTranscriptSummaries } = await import("./notifications");

function event(symbol: string, date: string): EarningsEvent {
  return { symbol, name: null, date, time: "amc", quarter: 3, year: 2027, epsEstimate: 0.95, epsActual: null, epsSurprise: null, revenueEstimate: 1.55e9, revenueActual: null, revenueSurprise: null };
}

beforeEach(() => {
  state.recipients = [{ userId: "u1", chatId: "100" }, { userId: "u2", chatId: "200" }];
  state.favorites = { u1: ["CRWD", "AAPL"], u2: ["MSFT"] };
  state.sent.clear();
  state.messages = [];
  state.events = [event("CRWD", "2026-10-28"), event("MSFT", "2026-11-20"), event("NVDA", "2026-10-27")];
  state.report = { quarter: "2026Q4", date: "2026-10-20" };
});

describe("earningsMessage", () => {
  it("lists each day's reports with the time and estimates", () => {
    const message = earningsMessage([event("CRWD", "2026-10-28")], "2026-10-26", "2026-11-01")!;
    expect(message).toContain("📅 <b>Earnings from your favorites</b>");
    expect(message).toContain("<b>Wed, Oct 28</b>");
    expect(message).toContain("<b>CRWD</b> CrowdStrike Holdings, Inc.");
    expect(message).toContain("after the close · EPS est. $0.95 · revenue est. $1.6B");
    expect(earningsMessage([], "2026-10-26", "2026-11-01")).toBeNull();
  });
});

describe("runEarningsAlerts", () => {
  it("sends each user only their favorites reporting in the next week", async () => {
    const report = await runEarningsAlerts("2026-10-26");
    expect(report.sent).toBe(1);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].chatId).toBe("100");
    expect(state.messages[0].text).toContain("CRWD");
    expect(state.messages[0].text).not.toContain("NVDA");
    expect(report.lines).toContain("u2: no favorites report by 2026-11-01.");
  });
});

describe("runTranscriptSummaries", () => {
  it("sends a recent call's summary once to everyone who favorites it", async () => {
    state.favorites = { u1: ["CRWD"], u2: ["CRWD"] };
    const first = await runTranscriptSummaries("2026-10-26");
    expect(first.sent).toBe(2);
    expect(state.messages[0].text).toContain("<b>CRWD</b> <b>FY2026 Q4 earnings call</b>");
    expect(state.messages[0].text).toContain("Strong &lt;quarter&gt;.");
    expect(state.messages[0].text).toContain("🟢 Positive tone");

    const second = await runTranscriptSummaries("2026-10-26");
    expect(second.sent).toBe(0);
    expect(second.lines).toContain("CRWD 2026Q4: already sent.");
  });

  it("skips old calls and calls without a transcript yet", async () => {
    state.report = { quarter: "2026Q2", date: "2026-08-01" };
    expect((await runTranscriptSummaries("2026-10-26")).lines[0]).toMatch(/no call in the last 21 days/);

    state.report = { quarter: "2026Q4", date: "2026-10-20" };
    state.summary = { ok: false, error: "Alpha Vantage doesn't have the FY2026 Q4 call." };
    const report = await runTranscriptSummaries("2026-10-26");
    expect(report.sent).toBe(0);
    expect(report.lines.some((line) => line.includes("not ready"))).toBe(true);
  });
});

describe("runNewsDigest", () => {
  it("sends each user the picked headlines from the last day, once", async () => {
    state.favorites = { u1: ["CRWD"], u2: [] };
    const article = (id: string, publishedAt: string) => ({ id, title: `CrowdStrike <${id}>`, summary: "", source: "Reuters", url: `https://example.com/${id}`, publishedAt, tickers: ["CRWD"], category: null });
    state.news = [article("old", "2026-10-26T09:00:00.000Z"), article("new", "2026-10-28T09:00:00.000Z")];

    const first = await runNewsDigest(new Date("2026-10-28T21:30:00Z"));
    expect(first.sent).toBe(1);
    expect(state.messages[0].text).toContain("📰 <b>News on your favorites</b>");
    expect(state.messages[0].text).toContain('<a href="https://example.com/new">CrowdStrike &lt;new&gt;</a> · Reuters');
    expect(state.messages[0].text).toContain("It matters.");
    expect(state.messages[0].text).not.toContain("example.com/old");

    const second = await runNewsDigest(new Date("2026-10-28T22:00:00Z"));
    expect(second.sent).toBe(0);
  });
});

describe("runFilingAlerts", () => {
  it("analyzes each recent significant filing once and sends it to its followers", async () => {
    state.favorites = { u1: ["CRWD"], u2: ["CRWD"] };
    state.analyzed = 0;
    const filing = (accession: string, form: string, filed: string, items: string[] = []) => ({ accession, form, filed, period: null, items, description: "Earnings results", documentUrl: `https://www.sec.gov/${accession}.htm`, indexUrl: "" });
    state.filings = [filing("a1", "8-K", "2026-10-27", ["2.02"]), filing("a2", "4", "2026-10-27"), filing("a3", "10-Q", "2026-09-01")];

    const report = await runFilingAlerts("2026-10-28");
    expect(state.analyzed).toBe(1);
    expect(report.sent).toBe(2);
    expect(state.messages[0].text).toContain("<b>filed an 8-K</b> · Earnings results");
    expect(state.messages[0].text).toContain("🟢 Positive for shareholders");
    expect(state.messages[0].text).toContain('<a href="https://www.sec.gov/a1-ex991.htm">Read the press release on sec.gov</a>');

    await runFilingAlerts("2026-10-28");
    expect(state.analyzed).toBe(1);
  });
});
