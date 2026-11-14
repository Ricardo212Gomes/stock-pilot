import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Review } from "./portfolio-reviews";

const state = {
  recipients: [] as { userId: string; chatId: string }[],
  sent: new Set<string>(),
  messages: [] as { chatId: string; text: string }[],
  enabled: {} as Record<string, boolean>,
  reviews: {} as Record<string, Review[]>,
};

vi.mock("./notification-settings", () => ({
  notificationRecipients: async () => state.recipients,
  wasSent: async (userId: string, kind: string, item: string) => state.sent.has(`${userId}:${kind}:${item}`),
  markSent: async (userId: string, kind: string, item: string) => void state.sent.add(`${userId}:${kind}:${item}`),
}));
vi.mock("./telegram", async (original) => ({
  ...(await original<typeof import("./telegram")>()),
  sendTelegramMessage: async (chatId: string, text: string) => {
    state.messages.push({ chatId, text });
    return { ok: true, result: null };
  },
}));
vi.mock("./portfolio-reviews", async (original) => ({
  ...(await original<typeof import("./portfolio-reviews")>()),
  getReviewsEnabled: async (userId: string) => state.enabled[userId] === true,
  listRecentReviews: async (userId: string) => state.reviews[userId] ?? [],
}));

const { reviewsMessage, runReviewSummaries } = await import("./notifications");
const { summarizeReviews } = await import("./portfolio-reviews");

function review(symbol: string, analysisDate: string, rating: Review["rating"], summary = `Plan for ${symbol}. More detail.`): Review {
  return { symbol, analysisDate, rating, summary, priceTarget: symbol === "NVDA" ? 150 : null, horizon: null, shares: 1, averageCost: 1, model: null };
}

const REVIEWS = [
  review("NVDA", "2026-11-03", "Hold"),
  review("NVDA", "2026-11-14", "Underweight", "Trim into rallies <b>now</b>. Then wait."),
  review("MSFT", "2026-11-13", "Buy"),
  review("AAPL", "2026-10-01", "Hold"),
  review("AAPL", "2026-09-10", "Buy"),
];

beforeEach(() => {
  vi.unstubAllEnvs();
  state.recipients = [{ userId: "u1", chatId: "c1" }];
  state.sent = new Set();
  state.messages = [];
  state.enabled = { u1: true };
  state.reviews = { u1: REVIEWS };
});

describe("reviewsMessage", () => {
  it("leads with what changed this week, then the holdings worst first, with the plan for the ones to look at", () => {
    vi.stubEnv("APP_URL", "https://stockpilot.example/");
    const message = reviewsMessage(summarizeReviews(REVIEWS, "2026-11-15"), "2026-11-15");
    expect(message).toBe([
      "<b>AI reviews of your portfolio</b> · Sun, Nov 15",
      "",
      "<b>Changed this week</b>",
      '• <a href="https://stockpilot.example/portfolio/review?symbol=NVDA"><b>NVDA</b></a>: Hold → <b>Underweight</b>',
      "",
      "<b>Underweight or Sell</b>",
      '• <a href="https://stockpilot.example/portfolio/review?symbol=NVDA"><b>NVDA</b></a> Underweight · target $150 · Sat, Nov 14',
      "  Trim into rallies &lt;b&gt;now&lt;/b&gt;.",
      "",
      "<b>Hold</b>",
      '• <a href="https://stockpilot.example/portfolio/review?symbol=AAPL"><b>AAPL</b></a> Hold · Thu, Oct 1 (old)',
      "",
      "<b>Overweight or Buy</b>",
      '• <a href="https://stockpilot.example/portfolio/review?symbol=MSFT"><b>MSFT</b></a> Buy · Fri, Nov 13',
      "",
      "<i>3 holdings reviewed by TradingAgents' AI agents. Not investment advice.</i>",
    ].join("\n"));
  });

  it("is null without reviews", () => {
    expect(reviewsMessage([], "2026-11-15")).toBeNull();
  });
});

describe("runReviewSummaries", () => {
  it("sends once a week, and only with the Portfolio's reviews on", async () => {
    state.recipients.push({ userId: "u2", chatId: "c2" }, { userId: "u3", chatId: "c3" });
    state.enabled.u3 = true;
    const first = await runReviewSummaries("2026-11-15");
    expect(first.sent).toBe(1);
    expect(state.messages.map((message) => message.chatId)).toEqual(["c1"]);
    expect(first.lines).toEqual(["u1: sent.", "u2: the Portfolio's AI reviews are off.", "u3: no reviews yet."]);
    expect(state.sent.has("u1:reviews:2026-11-09")).toBe(true);

    const again = await runReviewSummaries("2026-11-15");
    expect(again.sent).toBe(0);
    expect(again.lines[0]).toBe("u1: already sent for the week of 2026-11-09.");
  });
});
