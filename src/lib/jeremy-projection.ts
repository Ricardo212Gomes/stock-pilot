import type { ProjectionDefaults } from "./plumas-projection";
import type { AnalystEstimate } from "./stock-overview";

// Jeremy Lefebvre's (1000xStocks) projection: bull, base and bear cases over the fiscal year in progress
// and the four after it. The first year is the starting point (analysts' consensus for the year in
// progress, or the last report); from the second on, revenue and net income each grow at their own rate.
// EPS is net income over today's share count, the price is EPS × a low and a high P/E, and the CAGR from
// today's price counts the first year as year 0, so it starts in the third year, as on his sheet.

export const JEREMY_YEARS = 5;
// The first year with a CAGR: two years after the starting one.
export const CAGR_FROM_INDEX = 2;

export const CASES = [
  { id: "bull", label: "Bull case" },
  { id: "base", label: "Base case" },
  { id: "bear", label: "Bear case" },
] as const;

export type CaseId = (typeof CASES)[number]["id"];

export const CASE_FIELDS = ["revenueGrowth", "netIncomeGrowth", "peLow", "peHigh"] as const;
export type CaseField = (typeof CASE_FIELDS)[number];

// One value per year. The growth rates' first value is unused: the first year is the starting point.
export type CaseInputs = Record<CaseField, number[]>;

export type JeremyStart = {
  // The first column's fiscal year.
  year: number;
  revenue: number | null;
  netIncome: number | null;
  // Shares outstanding today, kept in every year.
  shares: number | null;
  price: number | null;
};

export type JeremyYear = {
  year: number;
  revenue: number;
  netIncome: number;
  netMargin: number;
  eps: number;
  priceLow: number | null;
  priceHigh: number | null;
  // From the third year on.
  cagrLow: number | null;
  cagrHigh: number | null;
};

export type CaseProjection =
  | { ok: true; years: JeremyYear[] }
  | { ok: false; reason: string };

function cagr(price: number | null, from: number | null, years: number): number | null {
  if (years < CAGR_FROM_INDEX || price === null || price <= 0 || from === null || from <= 0) return null;
  return (price / from) ** (1 / years) - 1;
}

// The CAGR runs from the entry price when one is set, else from today's price.
export function projectCase(start: JeremyStart, inputs: CaseInputs, entryPrice: number | null = null): CaseProjection {
  const { revenue, netIncome, shares } = start;
  if (revenue === null || revenue <= 0) return { ok: false, reason: `Needs fiscal ${start.year} revenue above zero.` };
  if (netIncome === null || netIncome <= 0) {
    return { ok: false, reason: `Needs fiscal ${start.year} net income above zero: a growth rate can't be applied to a loss.` };
  }
  if (shares === null || shares <= 0) return { ok: false, reason: "Needs today's number of shares outstanding." };

  const from = entryPrice !== null && entryPrice > 0 ? entryPrice : start.price;
  let currentRevenue = revenue;
  let currentNetIncome = netIncome;
  return {
    ok: true,
    years: Array.from({ length: JEREMY_YEARS }, (_, index): JeremyYear => {
      // Each year is rounded to whole currency units before the next grows from it, as on his sheet.
      if (index > 0) {
        currentRevenue = Math.round(currentRevenue * (1 + inputs.revenueGrowth[index]));
        currentNetIncome = Math.round(currentNetIncome * (1 + inputs.netIncomeGrowth[index]));
      }
      const eps = currentNetIncome / shares;
      // A P/E on a loss means nothing, so loss-making years have no price.
      const priceLow = eps > 0 ? eps * inputs.peLow[index] : null;
      const priceHigh = eps > 0 ? eps * inputs.peHigh[index] : null;
      return {
        year: start.year + index,
        revenue: currentRevenue,
        netIncome: currentNetIncome,
        netMargin: currentNetIncome / currentRevenue,
        eps,
        priceLow,
        priceHigh,
        cagrLow: cagr(priceLow, from, index),
        cagrHigh: cagr(priceHigh, from, index),
      };
    }),
  };
}

export type JeremyNotes = { start: string; growth: string; pe: string; cases: string; shares: string };

export type JeremyDefaults = {
  currency: string;
  start: JeremyStart;
  // Where the first year's revenue and net income come from.
  startSource: "consensus" | "reported";
  cases: Record<CaseId, CaseInputs>;
  notes: JeremyNotes;
};

// Revenue growth added to the base case, and the factor on its P/E range, for the other two cases.
const CASE_SPREAD: Record<CaseId, { growth: number; pe: number }> = {
  bull: { growth: 0.05, pe: 1.2 },
  base: { growth: 0, pe: 1 },
  bear: { growth: -0.05, pe: 0.8 },
};

// Far-off years with fewer analysts are too thin to start from.
const MIN_ANALYSTS = 3;

// The P/E range a multiple above 25× fades to by the last year.
const FADE_ABOVE_PE = 25;
const FADED_PE = { low: 20, high: 30 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function yearOf(estimate: AnalystEstimate): number {
  return Number(estimate.date.slice(0, 4));
}

// Built on the Plumas defaults, so both tools share the history, today's price and share count, and the
// P/E history.
export function buildJeremyDefaults({
  plumas,
  estimates,
  today,
}: {
  plumas: ProjectionDefaults;
  // Oldest first, as getAnalystEstimates returns them.
  estimates: AnalystEstimate[];
  today: Date;
}): JeremyDefaults {
  const { base } = plumas;
  const { price, shares } = plumas.start;
  const consensusIncome = (estimate: AnalystEstimate) =>
    estimate.netIncome.avg ?? (estimate.eps.avg !== null && shares !== null ? estimate.eps.avg * shares : null);

  // The fiscal year in progress: the first one whose end is still ahead, if it hasn't been reported.
  const isoToday = today.toISOString().slice(0, 10);
  const current = estimates.find((estimate) => estimate.date >= isoToday);
  const usable = current && yearOf(current) > base.year && (current.revenue.avg ?? 0) > 0 && (consensusIncome(current) ?? 0) > 0;
  const start: JeremyStart = usable
    ? { year: yearOf(current), revenue: current.revenue.avg, netIncome: consensusIncome(current), shares, price }
    : { year: base.year, revenue: base.revenue, netIncome: base.netIncome, shares, price };

  // Base growth: analysts' consensus where enough of them cover the year, else the Plumas base case
  // for that fiscal year (the company's compound growth fading toward 3%), with net income tracking revenue.
  const plumasGrowth = (year: number) => {
    const values = plumas.scenarios.base.revenueGrowth;
    return values[clamp(year - base.year - 1, 0, values.length - 1)];
  };
  const revenueGrowth = [0];
  const netIncomeGrowth = [0];
  const consensusYears: number[] = [];
  let revenue = start.revenue;
  let netIncome = start.netIncome;
  for (let index = 1; index < JEREMY_YEARS; index++) {
    const year = start.year + index;
    const estimate = estimates.find((candidate) => yearOf(candidate) === year && (candidate.analysts === null || candidate.analysts >= MIN_ANALYSTS));
    const revenueTarget = estimate?.revenue.avg ?? null;
    const incomeTarget = estimate ? consensusIncome(estimate) : null;
    const consensusGrowth = revenue !== null && revenue > 0 && revenueTarget !== null && revenueTarget > 0
      ? clamp(roundRate(revenueTarget / revenue - 1), -0.5, 2)
      : null;
    const growth = consensusGrowth ?? plumasGrowth(year);
    const incomeGrowth = consensusGrowth !== null && netIncome !== null && netIncome > 0 && incomeTarget !== null && incomeTarget > 0
      ? clamp(roundRate(incomeTarget / netIncome - 1), -0.8, 3)
      : growth;
    if (consensusGrowth !== null) consensusYears.push(year);
    revenueGrowth.push(growth);
    netIncomeGrowth.push(incomeGrowth);
    revenue = revenue === null ? null : revenue * (1 + growth);
    netIncome = netIncome === null ? null : netIncome * (1 + incomeGrowth);
  }

  // P/E range: today's price over this year's consensus EPS, minus and plus 20%; else the Plumas range.
  const forwardEps = usable && current.eps.avg !== null && current.eps.avg > 0 ? current.eps.avg : null;
  const forwardPe = forwardEps !== null && price !== null ? price / forwardEps : null;
  const peLow = forwardPe !== null ? forwardPe * 0.8 : plumas.scenarios.base.peLow[0];
  const peHigh = forwardPe !== null ? forwardPe * 1.2 : plumas.scenarios.base.peHigh[0];
  // A range centred above 25× fades to 20–30× by the last year, as on Jeremy's own sheets: a fast
  // grower's P/E usually shrinks as its growth slows.
  const fades = (peLow + peHigh) / 2 > FADE_ABOVE_PE;
  const yearly = (from: number, to: number) =>
    Array.from({ length: JEREMY_YEARS }, (_, index) => (fades ? from + ((to - from) * index) / (JEREMY_YEARS - 1) : from));

  const cases = Object.fromEntries((Object.keys(CASE_SPREAD) as CaseId[]).map((id) => {
    const spread = CASE_SPREAD[id];
    const shift = (values: number[]) => values.map((value, index) => (index === 0 ? 0 : roundRate(value + spread.growth)));
    const multiple = (values: number[]) => values.map((value) => Math.max(1, Math.round(clamp(value, 5, 100) * spread.pe)));
    return [id, {
      revenueGrowth: shift(revenueGrowth),
      netIncomeGrowth: shift(netIncomeGrowth),
      peLow: multiple(yearly(peLow, FADED_PE.low)),
      peHigh: multiple(yearly(peHigh, FADED_PE.high)),
    }];
  })) as Record<CaseId, CaseInputs>;

  const span = (years: number[]) => (years.length === 1 ? `fiscal ${years[0]}` : `fiscal ${years[0]}–${years[years.length - 1]}`);
  return {
    currency: plumas.currency,
    start,
    startSource: usable ? "consensus" : "reported",
    cases,
    notes: {
      start: usable
        ? `Analysts' consensus for fiscal ${start.year}, the year in progress${current.analysts ? ` (${current.analysts} analysts)` : ""}: their average revenue and net income.`
        : `Fiscal ${start.year} as reported: there's no analysts' consensus for the year in progress.`,
      growth: consensusYears.length
        ? `The base case follows analysts' consensus for ${span(consensusYears)}${consensusYears.length < JEREMY_YEARS - 1 ? ", then the company's compound revenue growth fading toward 3%, with net income growing as fast as revenue" : ""}.`
        : `The base case uses the company's compound revenue growth fading toward 3% (${pct(revenueGrowth[1])} in ${start.year + 1}), with net income growing as fast as revenue.`,
      pe: `${forwardPe !== null
        ? `Today's price over this year's consensus EPS, a forward P/E of ${forwardPe.toFixed(1)}, minus and plus 20%.`
        : plumas.notes.pe}${fades ? ` It fades to ${FADED_PE.low}× and ${FADED_PE.high}× by ${start.year + JEREMY_YEARS - 1}: a fast grower's P/E usually shrinks as its growth slows.` : ""}`,
      cases: "The bull and bear cases add and take 5 points of revenue and net income growth, and raise and lower the P/E range by 20%.",
      shares: plumas.sharesSource === "today"
        ? "Shares outstanding today, the same in every year."
        : `Today's share count isn't available, so this is fiscal ${base.year}'s diluted average. Type the current count if you have it.`,
    },
  };
}
