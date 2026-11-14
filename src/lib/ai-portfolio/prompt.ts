import type { ScoredCandidate } from "../recommendation-signals";
import { RULES, type Exit, type Proposal, type Target } from "./rules";

// The weekly prompt: the candidates with the Recommendations screen's figures and recent headlines, the
// portfolio as it stands, and the rules. Gemini answers with target weights and a reason for each; the code
// checks them (rules.ts) before anything is traded.

export type PortfolioCandidate = ScoredCandidate & {
  // The holding's weight and gain since it was bought, when the portfolio owns it.
  held: { weight: number; gain: number | null } | null;
  // The latest few headlines from the last two weeks, newest first.
  headlines: string[];
};

const pct = (value: number) => Math.round(value * 1000) / 10;

export const PORTFOLIO_INSTRUCTIONS = [
  "You manage a long-only model portfolio of large US stocks, held for weeks to months and reviewed once a week.",
  `Hold ${RULES.minPositions} to ${RULES.maxPositions} positions, each between 1% and ${pct(RULES.maxWeight)}% of the portfolio, and keep at least ${pct(RULES.minCash)}% in cash.`,
  `Choose only tickers from the candidates. Sell or trim at most ${pct(RULES.maxSold)}% of the portfolio this week: keep a holding unless its case has clearly changed, since trading costs and noise hurt returns.`,
  "Spread the positions across different industries rather than one theme.",
  "Base every decision only on the figures and headlines given. Never invent numbers, events or news.",
  "For each position give its weight as a percentage (7.5 for 7.5%) and one or two plain sentences on why, citing the figures that matter. For each holding you drop, an exit with its reason.",
  "The summary is two or three sentences on what changes this week and why. No Markdown.",
].join(" ");

export const PORTFOLIO_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    positions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { symbol: { type: "STRING" }, weight: { type: "NUMBER" }, reason: { type: "STRING" } },
        required: ["symbol", "weight", "reason"],
      },
    },
    exits: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { symbol: { type: "STRING" }, reason: { type: "STRING" } }, required: ["symbol", "reason"] },
    },
  },
  required: ["summary", "positions", "exits"],
};

function round(value: number | null, digits = 1): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// Fractions as percentages, rounded: the model reads "12.3" more reliably than "0.12345".
function asPercent(value: number | null): number | null {
  return value === null ? null : round(value * 100);
}

function candidateRow(candidate: PortfolioCandidate) {
  const { trend, ratings, target } = candidate;
  return {
    ticker: candidate.symbol,
    name: candidate.name,
    marketCapBillions: candidate.marketCap === null ? null : round(candidate.marketCap / 1e9, 0),
    price: round(trend.close, 2),
    upsideToConsensusTargetPct: asPercent(candidate.upside),
    analysts: ratings
      ? {
          count: ratings.total,
          rating: ratings.label,
          buySharePct: asPercent(ratings.buyShare),
          buySharePctThreeMonthsAgo: asPercent(ratings.buyShareBefore),
        }
      : null,
    targetRange: target ? { low: round(target.low, 2), high: round(target.high, 2) } : null,
    vs12WeekAveragePct: asPercent(trend.sma60 ? trend.close / trend.sma60 - 1 : null),
    vs200DayAveragePct: asPercent(trend.sma200 ? trend.close / trend.sma200 - 1 : null),
    rsi14: round(trend.rsi14, 0),
    from52WeekHighPct: asPercent(trend.close / trend.high52 - 1),
    return3MonthsPct: asPercent(trend.return3m),
    screenSignalsMet: `${candidate.met} of 6`,
    held: candidate.held ? { weightPct: asPercent(candidate.held.weight), gainPct: asPercent(candidate.held.gain) } : null,
    headlines: candidate.headlines,
  };
}

export function buildPortfolioPrompt({
  date,
  equity,
  cash,
  candidates,
}: {
  date: string;
  equity: number;
  cash: number;
  candidates: PortfolioCandidate[];
}): string {
  const holdings = candidates.filter((candidate) => candidate.held);
  return [
    `Week of ${date}. The portfolio is worth $${Math.round(equity).toLocaleString("en-US")}, with ${asPercent(cash / equity)}% in cash and ${holdings.length} holdings.`,
    holdings.length === 0 ? "It holds nothing yet: build it from the candidates." : `Holdings: ${holdings.map((holding) => holding.symbol).join(", ")}.`,
    "Screen signals are the Recommendations screen's six: upside to the analysts' target, 75%+ Buy ratings, below the 12-week average, above the 200-day average, RSI under 40, and ratings improving.",
    `Candidates:\n${JSON.stringify(candidates.map(candidateRow))}`,
  ].join("\n\n");
}

function clean(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function symbolOf(value: unknown): string | null {
  const symbol = typeof value === "string" ? value.trim().toUpperCase().replace(".", "-") : "";
  return /^[A-Z][A-Z0-9-]{0,9}$/.test(symbol) ? symbol : null;
}

// The reply as a proposal, or null when it isn't one. Weights asked for in percent are read as fractions; a
// reply already in fractions (adding up to about 1) is kept as it is. The first of two entries for a ticker wins.
// Unknown tickers are kept, so the checks can say which.
export function parseProposal(text: string): Proposal | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const { summary, positions, exits } = (payload ?? {}) as { summary?: unknown; positions?: unknown; exits?: unknown };
  if (!Array.isArray(positions)) return null;

  const seen = new Set<string>();
  const raw = positions.flatMap((position): { symbol: string; weight: number; reason: string }[] => {
    const { symbol, weight, reason } = (position ?? {}) as { symbol?: unknown; weight?: unknown; reason?: unknown };
    const ticker = symbolOf(symbol);
    const value = typeof weight === "number" ? weight : typeof weight === "string" ? Number(weight.replace("%", "")) : NaN;
    if (!ticker || seen.has(ticker) || !Number.isFinite(value)) return [];
    seen.add(ticker);
    return [{ symbol: ticker, weight: value, reason: clean(reason, 400) }];
  });
  const total = raw.reduce((sum, position) => sum + position.weight, 0);
  const scale = total > 1.5 ? 0.01 : 1;
  const targets: Target[] = raw.map((position) => ({ ...position, weight: position.weight * scale }));

  const exitList: Exit[] = (Array.isArray(exits) ? exits : []).flatMap((exit): Exit[] => {
    const { symbol, reason } = (exit ?? {}) as { symbol?: unknown; reason?: unknown };
    const ticker = symbolOf(symbol);
    return ticker && !seen.has(ticker) ? [{ symbol: ticker, reason: clean(reason, 400) }] : [];
  });
  return { summary: clean(summary, 800), targets, exits: exitList };
}
