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

const { earningsMessage, runEarningsAlerts, runTranscriptSummaries } = await import("./notifications");

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
