import { getSql } from "./db";
import type { Holding } from "./portfolio";

// TradingAgents' reviews of a user's holdings (see docs/portfolio-reviews.md). The Python job in agents/ writes
// them; the Portfolio page reads them. Everything here is keyed by the signed-in user, never by ids from the browser.

export const RATINGS = ["Buy", "Overweight", "Hold", "Underweight", "Sell"] as const;
// "Review": TradingAgents couldn't read a rating from its own decision.
export type Rating = (typeof RATINGS)[number] | "Review";

// A review older than this is shown as stale: the daily job should have reached the holding again by then.
export const STALE_DAYS = 21;

// One agent's report. `tone` names its colour on the page; `group` is where it sits in the debate; `open` sections
// start unfolded; `preview` is its first sentence, shown while it's folded.
export type SectionGroup = "Decision" | "Research" | "Risk" | "Analysts";
export type ReviewSection = { id: string; title: string; group: SectionGroup; tone: string; open: boolean; preview: string; text: string };

export type Review = {
  symbol: string;
  analysisDate: string;
  rating: Rating;
  summary: string;
  priceTarget: number | null;
  horizon: string | null;
  shares: number;
  averageCost: number;
  model: string | null;
};

export type ReviewWithReport = Review & { sections: ReviewSection[] };

// A holding's latest review, the rating before it, and whether it's old.
export type ReviewSummary = Review & { previousRating: Rating | null; stale: boolean };

// The report's sections in reading order, as TradingAgents saves them (agents/review.py stores them by these ids):
// the decision and how it was reached first, then the debates and the analysts' reports they started from.
export const REPORT_SECTIONS: Omit<ReviewSection, "preview" | "text">[] = [
  { id: "decision", title: "Portfolio manager's decision", group: "Decision", tone: "decision", open: true },
  { id: "trader", title: "Trader's plan", group: "Decision", tone: "trader", open: true },
  { id: "manager", title: "Research manager", group: "Research", tone: "manager", open: true },
  { id: "bull", title: "Bull case", group: "Research", tone: "bull", open: false },
  { id: "bear", title: "Bear case", group: "Research", tone: "bear", open: false },
  { id: "aggressive", title: "Aggressive risk view", group: "Risk", tone: "aggressive", open: false },
  { id: "conservative", title: "Conservative risk view", group: "Risk", tone: "conservative", open: false },
  { id: "neutral", title: "Neutral risk view", group: "Risk", tone: "neutral", open: false },
  { id: "market", title: "Market analyst", group: "Analysts", tone: "market", open: false },
  { id: "news", title: "News analyst", group: "Analysts", tone: "news", open: false },
];

// A short "**Analysis Date:** November 14, 2026" line: a report's header fields, not its first sentence.
const FIELD_LINE = /^(?:[-*+]\s+)?(?:\*\*|__)[^*_]{1,40}(?::(?:\*\*|__)|(?:\*\*|__):)/;

// A report's first sentence as plain text: Markdown's markers, a speaker's "Bull Analyst:", headings and header
// fields left out.
export function previewOf(text: string, limit = 200): string {
  const plain = text
    .split("\n")
    .map((line) => line.trim())
    // A field line has no sentence in it ("$162.85" isn't one); "**Rationale**: The debate …." is prose.
    .filter((line) => line && !(FIELD_LINE.test(line) && !/[a-z)"'][.!?](?:\s|$)/.test(line)) && !/^#{1,6}\s/.test(line) && !/^\$\$/.test(line) && !/^[-*_]{3,}$/.test(line) && !/^\|/.test(line))
    .join(" ")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)[*_](\S)/g, "$1$2")
    .replace(/(\S)[*_](?=\s|[.,;:!?]|$)/g, "$1")
    .replace(/^(?:[-*+]\s+)/, "")
    .replace(/^[A-Z][A-Za-z ]{2,30} Analyst:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = plain.match(/^.{20,}?[.!?](?=\s|$)/)?.[0] ?? plain;
  return sentence.length > limit ? `${sentence.slice(0, limit - 1).trimEnd()}…` : sentence;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

// Worst first, so the holdings to look at lead the list.
const ORDER: Record<Rating, number> = { Sell: 0, Underweight: 1, Review: 2, Hold: 3, Overweight: 4, Buy: 5 };

// Every reviewed symbol's latest review with the rating before it, newest reviews in `reviews` in any order.
export function summarizeReviews(reviews: Review[], today: string): ReviewSummary[] {
  const bySymbol = new Map<string, Review[]>();
  for (const review of reviews) bySymbol.set(review.symbol, [...(bySymbol.get(review.symbol) ?? []), review]);
  return [...bySymbol.values()]
    .map((list) => {
      const [latest, previous] = [...list].sort((left, right) => right.analysisDate.localeCompare(left.analysisDate));
      return { ...latest, previousRating: previous?.rating ?? null, stale: daysBetween(latest.analysisDate, today) > STALE_DAYS };
    })
    .sort((left, right) => ORDER[left.rating] - ORDER[right.rating] || left.symbol.localeCompare(right.symbol));
}

// TradingAgents' portfolio for a user: each priced holding's ticker, shares and average cost, in the page's base
// currency (dollars for the job). Instruments without prices aren't followed and are left out; cash isn't recorded
// by StockPilot, so it stays unset.
export type TradingAgentsBook = {
  currency: string;
  positions: { ticker: string; quantity: number; average_price: number }[];
};

export function tradingAgentsBook(holdings: Holding[], currency: string): TradingAgentsBook {
  return {
    currency,
    positions: holdings
      .filter((holding) => holding.priced && holding.shares > 0)
      .map((holding) => ({ ticker: holding.symbol, quantity: holding.shares, average_price: Math.round(holding.averageCost * 10_000) / 10_000 })),
  };
}

export function isRating(value: unknown): value is Rating {
  return value === "Review" || (RATINGS as readonly unknown[]).includes(value);
}

type ReviewRow = {
  symbol: string;
  analysis_date: Date;
  rating: string;
  summary: string;
  price_target: string | null;
  horizon: string | null;
  shares: string;
  average_cost: string;
  model: string | null;
  report?: Record<string, unknown> | null;
};

function fromRow(row: ReviewRow): Review {
  return {
    symbol: row.symbol,
    analysisDate: row.analysis_date.toISOString().slice(0, 10),
    rating: isRating(row.rating) ? row.rating : "Review",
    summary: row.summary,
    priceTarget: row.price_target === null ? null : Number(row.price_target),
    horizon: row.horizon,
    shares: Number(row.shares),
    averageCost: Number(row.average_cost),
    model: row.model,
  };
}

export async function getReviewsEnabled(userId: string): Promise<boolean> {
  const rows = await getSql()<{ ai_reviews: boolean }[]>`select ai_reviews from portfolio_settings where user_id = ${userId}`;
  return rows[0]?.ai_reviews === true;
}

export async function setReviewsEnabled(userId: string, enabled: boolean): Promise<void> {
  await getSql()`
    insert into portfolio_settings (user_id, ai_reviews) values (${userId}, ${enabled})
    on conflict (user_id) do update set ai_reviews = excluded.ai_reviews, updated_at = now()
  `;
}

// The users who turned the reviews on, for the daily job.
export async function listReviewUsers(): Promise<string[]> {
  const rows = await getSql()<{ user_id: string }[]>`select user_id from portfolio_settings where ai_reviews order by user_id`;
  return rows.map((row) => row.user_id);
}

// The latest two reviews of each symbol, enough for the summary and what changed.
export async function listRecentReviews(userId: string): Promise<Review[]> {
  const rows = await getSql()<ReviewRow[]>`
    select symbol, analysis_date, rating, summary, price_target, horizon, shares, average_cost, model from (
      select *, row_number() over (partition by symbol order by analysis_date desc) as recency
      from portfolio_reviews where user_id = ${userId}
    ) ranked where recency <= 2
  `;
  return rows.map(fromRow);
}

// A symbol's latest review with its report.
export async function getLatestReview(userId: string, symbol: string): Promise<ReviewWithReport | null> {
  const [row] = await getSql()<ReviewRow[]>`
    select symbol, analysis_date, rating, summary, price_target, horizon, shares, average_cost, model, report
    from portfolio_reviews where user_id = ${userId} and symbol = ${symbol}
    order by analysis_date desc limit 1
  `;
  if (!row) return null;
  const report = row.report ?? {};
  const sections = REPORT_SECTIONS.flatMap((section) => {
    const text = report[section.id];
    return typeof text === "string" && text.trim() ? [{ ...section, preview: previewOf(text), text }] : [];
  });
  return { ...fromRow(row), sections };
}
