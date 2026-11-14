import {
  AlpacaError,
  getAccount,
  getPortfolioHistory,
  getPositions,
  isAlpacaConfigured,
  type AlpacaAccount,
  type AlpacaFailureReason,
  type AlpacaPosition,
  type EquityPoint,
} from "../alpaca";
import { isDatabaseConfigured } from "../db";
import { listedName } from "../listed-companies";
import { easternToday } from "../market-events";
import { BENCHMARK, type HistoryPoint } from "../portfolio";
import { getTiingoDays, tiingoStartDate, type TiingoDay } from "../tiingo";
import { nextRebalance } from "./rules";
import { listRuns, type StoredRun } from "./store";

// The /ai-portfolio page's data: the paper account live from Alpaca, its daily equity against the S&P 500, and the
// weekly runs with their moves from Postgres.

// Live figures are a minute old at most; the daily history changes once a day.
const LIVE_SECONDS = 60;
const HISTORY_SECONDS = 60 * 30;

export type AiPosition = AlpacaPosition & { name: string | null; weight: number };

export type AiPortfolioView = {
  account: AlpacaAccount;
  positions: AiPosition[];
  history: HistoryPoint[];
  // Why there's no chart, when there isn't one.
  historyNote: string | null;
  runs: StoredRun[];
  // Null without a database.
  runsNote: string | null;
  nextRebalance: string;
};

export type AiPortfolioResult = { ok: true; view: AiPortfolioView } | { ok: false; reason: AlpacaFailureReason };

// The account's growth against SPY's over the same days, dividends included, in the Portfolio chart's shape. The
// paper account takes no deposits, so its growth is its equity against the first day's, and the cost line is
// that first day's equity. Days SPY didn't trade take its last close.
export function buildHistory(points: EquityPoint[], benchmark: TiingoDay[] | null): HistoryPoint[] {
  if (points.length === 0) return [];
  const start = points[0].equity;
  const spy = new Map((benchmark ?? []).map((day) => [day.date, day.adjClose]));
  const spyDates = [...spy.keys()].sort();
  let base: number | null = null;
  let last: number | null = null;
  let cursor = 0;
  return points.map((point) => {
    while (cursor < spyDates.length && spyDates[cursor] <= point.date) last = spy.get(spyDates[cursor++]) ?? last;
    if (base === null && last !== null) base = last;
    return {
      date: point.date,
      value: point.equity,
      cost: start,
      growth: point.equity / start,
      benchmark: base !== null && last !== null ? last / base : null,
    };
  });
}

export async function getAiPortfolio(now = new Date()): Promise<AiPortfolioResult> {
  if (!isAlpacaConfigured()) return { ok: false, reason: "not-configured" };
  let account: AlpacaAccount;
  let positions: AlpacaPosition[];
  let equity: EquityPoint[];
  try {
    [account, positions, equity] = await Promise.all([getAccount(LIVE_SECONDS), getPositions(LIVE_SECONDS), getPortfolioHistory(HISTORY_SECONDS)]);
  } catch (error) {
    return { ok: false, reason: error instanceof AlpacaError ? error.reason : "unavailable" };
  }

  const benchmark = equity.length > 1 ? await getTiingoDays(BENCHMARK, tiingoStartDate(now)) : null;
  const history = equity.length > 1 ? buildHistory(equity, benchmark) : [];
  const historyNote = equity.length <= 1
    ? "The chart starts after the account's first full day with positions."
    : !benchmark
      ? "The S&P 500 line needs Tiingo's daily prices (TIINGO_API_KEY)."
      : null;

  let runs: StoredRun[] = [];
  let runsNote: string | null = null;
  if (!isDatabaseConfigured()) runsNote = "The weekly moves are kept in Postgres: set DATABASE_URL and run npm run db:setup.";
  else runs = await listRuns().catch(() => {
    runsNote = "The weekly moves couldn't load. Run npm run db:setup if the AI portfolio's tables are missing.";
    return [];
  });

  const invested = account.equity > 0 ? account.equity : 1;
  return {
    ok: true,
    view: {
      account,
      positions: positions
        .map((position) => ({ ...position, name: listedName(position.symbol), weight: position.marketValue / invested }))
        .sort((left, right) => right.marketValue - left.marketValue),
      history,
      historyNote,
      runs,
      runsNote,
      nextRebalance: nextRebalance(easternToday(now)),
    },
  };
}
