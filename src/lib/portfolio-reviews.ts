import { getSql } from "./db";
import type { Holding } from "./portfolio";

// TradingAgents' reviews of a user's holdings (see docs/portfolio-reviews.md). The Python job in agents/ writes
// them; the Portfolio page reads them. Everything here is keyed by the signed-in user, never by ids from the browser.

export const RATINGS = ["Buy", "Overweight", "Hold", "Underweight", "Sell"] as const;
// "Review": TradingAgents couldn't read a rating from its own decision.
export type Rating = (typeof RATINGS)[number] | "Review";

// A review older than this is shown as stale: the daily job should have reached the holding again by then.
export const STALE_DAYS = 21;

export type ReviewSection = { id: string; title: string; text: string };

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

// The report's sections in reading order, as TradingAgents saves them (agents/review.py stores them by these ids).
export const REPORT_SECTIONS: { id: string; title: string }[] = [
  { id: "decision", title: "Final decision" },
  { id: "trader", title: "Trader's plan" },
  { id: "bull", title: "Bull case" },
  { id: "bear", title: "Bear case" },
  { id: "manager", title: "Research manager" },
  { id: "aggressive", title: "Aggressive risk view" },
  { id: "conservative", title: "Conservative risk view" },
  { id: "neutral", title: "Neutral risk view" },
  { id: "market", title: "Market analyst" },
  { id: "news", title: "News analyst" },
];

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
  const sections = REPORT_SECTIONS.flatMap(({ id, title }) => {
    const text = report[id];
    return typeof text === "string" && text.trim() ? [{ id, title, text }] : [];
  });
  return { ...fromRow(row), sections };
}
