import { getDailyCloses } from "./daily-closes";
import { getCompanyReports, type CompanyReport } from "./earnings-calendar";
import { numeric } from "./fmp";
import { fetchFinnhub, finnhubSymbol } from "./finnhub";
import { getRatingMonths, type RatingMonth } from "./analyst-ratings";
import { summarizeRatings, type AnalystRatings } from "./recommendation-signals";
import { getAnalystEstimates, nextEarningsDate, optionalRows, type AnalystEstimate } from "./stock-overview";
import type { PricePoint } from "./technicals";

// A company's Forecast tab: what analysts expect. Price targets, their trend, revenue and EPS estimates
// and rating changes come from FMP (for the companies its plan covers); ratings by month and, when FMP
// can't, earnings surprises come from Finnhub, which covers every US stock. Most requests are shared with
// the Overview, Financials and Recommendations, and all are cached for a day.

const DAILY_REVALIDATE_SECONDS = 60 * 60 * 24;
// Reported years shown before the estimates, and estimate years after them.
const REPORTED_YEARS = 2;
const ESTIMATE_YEARS = 4;
export const ACTIONS_SHOWN = 25;
// Rating changes are counted over this many days.
export const ACTION_WINDOW_DAYS = 90;
const PAST_REPORTS = 4;

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  return numeric(typeof value === "number" ? value : null);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type PriceTargets = { consensus: number; median: number | null; high: number | null; low: number | null };

export function parseTargets(rows: Row[]): PriceTargets | null {
  const consensus = num(rows[0]?.targetConsensus);
  if (consensus === null || consensus <= 0) return null;
  return { consensus, median: num(rows[0]?.targetMedian), high: num(rows[0]?.targetHigh), low: num(rows[0]?.targetLow) };
}

export type TargetPeriod = { label: string; count: number; average: number };

// The average target set in the last month, quarter and year, to see which way targets are moving.
export function parseTargetTrend(rows: Row[]): TargetPeriod[] {
  const row = rows[0] ?? {};
  return [
    { label: "Last month", count: num(row.lastMonthCount), average: num(row.lastMonthAvgPriceTarget) },
    { label: "Last quarter", count: num(row.lastQuarterCount), average: num(row.lastQuarterAvgPriceTarget) },
    { label: "Last year", count: num(row.lastYearCount), average: num(row.lastYearAvgPriceTarget) },
  ].flatMap((period): TargetPeriod[] => (period.count && period.average ? [{ label: period.label, count: period.count, average: period.average }] : []));
}

export type EstimateYear = {
  // The calendar year the fiscal year ends in.
  year: number;
  date: string;
  // Reported, or analysts' average estimate.
  reported: boolean;
  revenue: number | null;
  revenueLow: number | null;
  revenueHigh: number | null;
  eps: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  analysts: number | null;
};

// The last reported years from the annual income statements, then analysts' estimates for the years after.
export function buildEstimateYears(estimates: AnalystEstimate[], incomeRows: Row[]): EstimateYear[] {
  const reported = incomeRows
    .flatMap((row): EstimateYear[] => {
      const date = str(row.date);
      if (!date) return [];
      return [{
        year: Number(date.slice(0, 4)),
        date,
        reported: true,
        revenue: num(row.revenue),
        revenueLow: null,
        revenueHigh: null,
        eps: num(row.epsDiluted) ?? num(row.eps),
        epsLow: null,
        epsHigh: null,
        analysts: null,
      }];
    })
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-REPORTED_YEARS);
  const lastReported = reported.at(-1)?.year ?? 0;
  const ahead = estimates
    .filter((estimate) => Number(estimate.date.slice(0, 4)) > lastReported && (estimate.revenue.avg !== null || estimate.eps.avg !== null))
    .slice(0, ESTIMATE_YEARS)
    .map((estimate): EstimateYear => ({
      year: Number(estimate.date.slice(0, 4)),
      date: estimate.date,
      reported: false,
      revenue: estimate.revenue.avg,
      revenueLow: estimate.revenue.low,
      revenueHigh: estimate.revenue.high,
      eps: estimate.eps.avg,
      epsLow: estimate.eps.low,
      epsHigh: estimate.eps.high,
      analysts: estimate.analysts,
    }));
  return [...reported, ...ahead];
}

// Growth from one year to the next; null from a loss or a missing year.
export function yearGrowth(value: number | null, previous: number | null): number | null {
  return value === null || previous === null || previous <= 0 ? null : value / previous - 1;
}

export type GradeAction = {
  date: string;
  firm: string;
  action: "upgrade" | "downgrade" | "maintain" | "initiate" | "other";
  previous: string | null;
  grade: string;
};

export function parseGrades(rows: Row[]): GradeAction[] {
  return rows
    .flatMap((row): GradeAction[] => {
      const date = str(row.date);
      const firm = str(row.gradingCompany);
      const grade = str(row.newGrade);
      if (!date || !firm || !grade) return [];
      const raw = str(row.action)?.toLowerCase() ?? "";
      const action = raw === "upgrade" || raw === "downgrade" || raw === "maintain" ? raw : raw.startsWith("init") ? "initiate" : "other";
      return [{ date: date.slice(0, 10), firm, action, previous: str(row.previousGrade), grade }];
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

export type ActionCounts = { upgrades: number; downgrades: number; maintains: number };

export function countActions(actions: GradeAction[], since: string): ActionCounts {
  const recent = actions.filter((action) => action.date >= since);
  return {
    upgrades: recent.filter((action) => action.action === "upgrade").length,
    downgrades: recent.filter((action) => action.action === "downgrade").length,
    maintains: recent.filter((action) => action.action === "maintain").length,
  };
}

export type EarningsReport = {
  // When the results came out (FMP), or the quarter's end (Finnhub, which doesn't give the day).
  date: string;
  dateIsQuarterEnd: boolean;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
};

export type EarningsSummary = { upcoming: EarningsReport | null; past: EarningsReport[]; source: "fmp" | "finnhub" };

// FMP's earnings rows: the next report (no actual EPS yet) and the latest reported ones.
export function parseFmpEarnings(rows: Row[], today: string): EarningsSummary | null {
  const reports = rows.flatMap((row): EarningsReport[] => {
    const date = str(row.date);
    return date ? [{
      date,
      dateIsQuarterEnd: false,
      epsEstimate: num(row.epsEstimated),
      epsActual: num(row.epsActual),
      revenueEstimate: num(row.revenueEstimated),
      revenueActual: num(row.revenueActual),
    }] : [];
  });
  if (reports.length === 0) return null;
  const next = nextEarningsDate(rows, today);
  return {
    upcoming: reports.find((report) => report.date === next) ?? null,
    past: reports.filter((report) => report.epsActual !== null).sort((left, right) => right.date.localeCompare(left.date)).slice(0, PAST_REPORTS),
    source: "fmp",
  };
}

// Finnhub's free earnings: EPS against the estimate for the last four quarters, by quarter end.
export function parseFinnhubEarnings(payload: unknown): EarningsSummary | null {
  const rows = Array.isArray(payload) ? (payload as Row[]) : [];
  const past = rows.flatMap((row): EarningsReport[] => {
    const date = str(row.period);
    return date ? [{ date, dateIsQuarterEnd: true, epsEstimate: num(row.estimate), epsActual: num(row.actual), revenueEstimate: null, revenueActual: null }] : [];
  }).sort((left, right) => right.date.localeCompare(left.date)).slice(0, PAST_REPORTS);
  return past.length > 0 ? { upcoming: null, past, source: "finnhub" } : null;
}

// The next report's date from Finnhub's calendar, so the Forecast tab and the Overview agree; FMP's estimates for
// that report stay. Providers guess unannounced dates differently, so one source sets it everywhere.
export function withCalendarDate(earnings: EarningsSummary | null, reports: CompanyReport[] | null, today: string): EarningsSummary | null {
  const next = reports?.find((report) => report.date >= today);
  if (!next) return earnings;
  const upcoming: EarningsReport = earnings?.upcoming
    ? { ...earnings.upcoming, date: next.date }
    : { date: next.date, dateIsQuarterEnd: false, epsEstimate: null, epsActual: null, revenueEstimate: null, revenueActual: null };
  return earnings ? { ...earnings, upcoming } : { upcoming, past: [], source: "finnhub" };
}

export function surprise(actual: number | null, estimate: number | null): number | null {
  return actual === null || estimate === null || estimate === 0 ? null : (actual - estimate) / Math.abs(estimate);
}

export type AnalystForecast = {
  targets: PriceTargets | null;
  targetTrend: TargetPeriod[];
  // The last year of daily closes, for the price target chart.
  closes: PricePoint[];
  ratings: AnalystRatings | null;
  // Rating counts by month, newest first.
  ratingMonths: RatingMonth[];
  estimates: EstimateYear[];
  actions: GradeAction[];
  actionCounts: ActionCounts;
  earnings: EarningsSummary | null;
  // Whether FMP had any of its forecasts for the company (its free plan covers a few dozen large ones).
  fmpCovered: boolean;
};

export async function getAnalystForecast(symbol: string, now = new Date()): Promise<AnalystForecast> {
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - ACTION_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const yearAgo = new Date(now.getTime() - 366 * 86_400_000).toISOString().slice(0, 10);
  const [targetRows, trendRows, estimates, incomeRows, gradeRows, earningsRows, history, ratingMonths, reports] = await Promise.all([
    // The same requests as the Overview, Financials and Compare pages make, so they share cached responses.
    optionalRows("price-target-consensus", { symbol }),
    optionalRows("price-target-summary", { symbol }),
    getAnalystEstimates(symbol),
    optionalRows("income-statement", { symbol, limit: "5", period: "annual" }),
    optionalRows("grades", { symbol }),
    optionalRows("earnings", { symbol, limit: "5" }),
    // The same year of closes Recommendations loads, so the two share a cached response.
    getDailyCloses(symbol, now).catch((): PricePoint[] => []),
    getRatingMonths(symbol),
    // The next report's date as on the Overview: Finnhub's calendar, the same cached request.
    getCompanyReports(symbol, today),
  ]);

  let earnings = parseFmpEarnings(earningsRows, today);
  if (!earnings) {
    const finnhub = await fetchFinnhub("stock/earnings", { symbol: finnhubSymbol(symbol) }, DAILY_REVALIDATE_SECONDS);
    earnings = finnhub.ok ? parseFinnhubEarnings(finnhub.payload) : null;
  }
  earnings = withCalendarDate(earnings, reports, today);

  const actions = parseGrades(gradeRows);
  return {
    targets: parseTargets(targetRows),
    targetTrend: parseTargetTrend(trendRows),
    closes: history.filter((point) => point.date >= yearAgo).sort((left, right) => left.date.localeCompare(right.date)),
    ratings: summarizeRatings(ratingMonths),
    ratingMonths,
    estimates: buildEstimateYears(estimates, incomeRows),
    actions: actions.slice(0, ACTIONS_SHOWN),
    actionCounts: countActions(actions, since),
    earnings,
    fmpCovered: targetRows.length > 0 || estimates.length > 0 || gradeRows.length > 0,
  };
}
