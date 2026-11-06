import type { StatementTable } from "./financial-statements";
import type { AnalystEstimate } from "./stock-overview";

// Financial projections: the five fiscal years after the last reported one, in three or five
// scenarios, with each projected year's inputs set on their own as in a spreadsheet.
//
// Simple: revenue and net income each grow at their own rate, and EPS is net income over today's
// share count. Advanced: net income is built from revenue, cost of revenue, operating expenses and
// interest & other, keeping the last year's ratio of net income to pretax income, and the share
// count falls each year by the buyback yield (or rises, with dilution), starting from today's.
//
// In both, each year's price is EPS × a low (mid) and high P/E, and its CAGR is measured from
// today's price, counting the first projected year as one year away.

export const PROJECTION_YEARS = 5;
// Reported fiscal years shown before the projected ones.
export const HISTORY_YEARS = 4;

export const SCENARIOS = [
  { id: "ultraBearish", label: "Ultra bearish" },
  { id: "bearish", label: "Bearish" },
  { id: "base", label: "Base" },
  { id: "bullish", label: "Bullish" },
  { id: "ultraBullish", label: "Ultra bullish" },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]["id"];
export type ScenarioCount = 3 | 5;
export type ProjectionMode = "simple" | "advanced";

export function scenariosFor(count: ScenarioCount) {
  return count === 5 ? [...SCENARIOS] : SCENARIOS.filter(({ id }) => id !== "ultraBearish" && id !== "ultraBullish");
}

export const INPUT_FIELDS = [
  "revenueGrowth",
  "netIncomeGrowth",
  "costGrowth",
  "opexGrowth",
  "otherGrowth",
  "buybackYield",
  "peLow",
  "peMid",
  "peHigh",
] as const;

export type InputField = (typeof INPUT_FIELDS)[number];

// One value per projected year. Rates are decimals: 0.085 is 8.5%.
export type ScenarioInputs = Record<InputField, number[]>;

// The last reported fiscal year, which the projection grows from.
export type BaseYear = {
  year: number;
  periodEnding: string | null;
  revenue: number | null;
  // Null for companies that don't report one, such as banks: operating expenses are then
  // everything between revenue and operating income.
  costOfRevenue: number | null;
  operatingIncome: number | null;
  pretaxIncome: number | null;
  netIncome: number | null;
};

export type StartingPoint = {
  price: number | null;
  // Shares outstanding today, not the last fiscal year's average.
  shares: number | null;
};

export type ProjectedYear = {
  year: number;
  revenue: number;
  costOfRevenue: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  operatingExpenses: number | null;
  operatingIncome: number | null;
  operatingMargin: number | null;
  other: number | null;
  netIncome: number;
  netMargin: number;
  shares: number;
  eps: number;
  priceLow: number | null;
  // Advanced mode only.
  priceMid: number | null;
  priceHigh: number | null;
  marketCapMid: number | null;
  cagrLow: number | null;
  cagrMid: number | null;
  cagrHigh: number | null;
};

export type Projection =
  | { ok: true; years: ProjectedYear[] }
  | { ok: false; reason: string };

// Net income as a share of pretax income when the last year's figures can't give one: a 21% tax.
export const FALLBACK_NET_INCOME_RATIO = 0.79;

export function hasCostOfRevenue(base: BaseYear): boolean {
  return base.costOfRevenue !== null && base.costOfRevenue > 0;
}

// What's left of pretax income after taxes and minority interests, from the last fiscal year.
export function netIncomeRatio(base: BaseYear): { value: number; fromFilings: boolean } {
  const pretax = base.pretaxIncome ?? base.operatingIncome;
  const ratio = pretax !== null && pretax > 0 && base.netIncome !== null ? base.netIncome / pretax : null;
  return ratio !== null && ratio > 0 && ratio <= 1
    ? { value: ratio, fromFilings: true }
    : { value: FALLBACK_NET_INCOME_RATIO, fromFilings: false };
}

function cagr(price: number | null, today: number | null, years: number): number | null {
  if (price === null || price <= 0 || today === null || today <= 0) return null;
  return (price / today) ** (1 / years) - 1;
}

export function projectScenario(
  mode: ProjectionMode,
  base: BaseYear,
  start: StartingPoint,
  inputs: ScenarioInputs,
): Projection {
  const { revenue, operatingIncome, netIncome } = base;
  if (revenue === null || revenue <= 0) return { ok: false, reason: `Needs fiscal ${base.year} revenue above zero.` };
  if (start.shares === null || start.shares <= 0) return { ok: false, reason: "Needs today's number of shares outstanding." };
  if (mode === "simple" && (netIncome === null || netIncome <= 0)) {
    return {
      ok: false,
      reason: `Simple mode grows net income from fiscal ${base.year}'s, which was a loss: a growth rate can't be applied to it. Advanced mode builds net income from revenue and costs instead.`,
    };
  }
  if (mode === "advanced" && operatingIncome === null) {
    return { ok: false, reason: "Advanced mode needs operating income, which this company's statements don't report. Use Simple mode." };
  }

  const ratio = netIncomeRatio(base).value;
  const withCost = hasCostOfRevenue(base);
  let currentRevenue = revenue;
  let currentNetIncome = netIncome ?? 0;
  let cost = withCost ? base.costOfRevenue! : null;
  let opex = operatingIncome === null ? 0 : revenue - (cost ?? 0) - operatingIncome;
  // Interest, investment income and other non-operating items: pretax income minus operating income.
  let other = operatingIncome !== null && base.pretaxIncome !== null ? base.pretaxIncome - operatingIncome : 0;
  let shares = start.shares;

  const years = Array.from({ length: PROJECTION_YEARS }, (_, index): ProjectedYear => {
    const advanced = mode === "advanced";
    currentRevenue *= 1 + inputs.revenueGrowth[index];
    let grossProfit: number | null = null;
    let yearOperatingIncome: number | null = null;
    if (advanced) {
      if (cost !== null) cost *= 1 + inputs.costGrowth[index];
      opex *= 1 + inputs.opexGrowth[index];
      other *= 1 + inputs.otherGrowth[index];
      shares *= 1 - inputs.buybackYield[index];
      grossProfit = cost === null ? null : currentRevenue - cost;
      yearOperatingIncome = (grossProfit ?? currentRevenue) - opex;
      currentNetIncome = (yearOperatingIncome + other) * ratio;
    } else {
      currentNetIncome *= 1 + inputs.netIncomeGrowth[index];
    }

    const eps = currentNetIncome / shares;
    // A P/E on a loss means nothing, so loss-making years have no price.
    const price = (pe: number) => (eps > 0 ? eps * pe : null);
    const priceLow = price(inputs.peLow[index]);
    const priceMid = advanced ? price(inputs.peMid[index]) : null;
    const priceHigh = price(inputs.peHigh[index]);
    return {
      year: base.year + index + 1,
      revenue: currentRevenue,
      costOfRevenue: advanced ? cost : null,
      grossProfit,
      grossMargin: grossProfit === null ? null : grossProfit / currentRevenue,
      operatingExpenses: advanced ? opex : null,
      operatingIncome: yearOperatingIncome,
      operatingMargin: yearOperatingIncome === null ? null : yearOperatingIncome / currentRevenue,
      other: advanced ? other : null,
      netIncome: currentNetIncome,
      netMargin: currentNetIncome / currentRevenue,
      shares,
      eps,
      priceLow,
      priceMid,
      priceHigh,
      marketCapMid: priceMid === null ? null : priceMid * shares,
      cagrLow: cagr(priceLow, start.price, index + 1),
      cagrMid: cagr(priceMid, start.price, index + 1),
      cagrHigh: cagr(priceHigh, start.price, index + 1),
    };
  });
  return { ok: true, years };
}

// The scenario's inputs refitted so the years analysts cover match their consensus: revenue growth to
// their revenue, Simple mode's net income growth to their EPS on today's share count, and Advanced mode's
// operating expenses to their EPS on the scenario's share count (cost of revenue grows with revenue in
// those years, so the gross margin holds). Years without an estimate, and the P/E range, keep their values.
export function fitToEstimates(
  base: BaseYear,
  start: StartingPoint,
  inputs: ScenarioInputs,
  estimates: (AnalystEstimate | null)[],
): ScenarioInputs {
  const fitted: ScenarioInputs = { ...inputs, revenueGrowth: [...inputs.revenueGrowth], netIncomeGrowth: [...inputs.netIncomeGrowth], costGrowth: [...inputs.costGrowth], opexGrowth: [...inputs.opexGrowth] };
  // Their EPS where they give one, else their net income.
  const targetNetIncome = (index: number, shares: number | null) => {
    const estimate = estimates[index];
    const eps = estimate?.eps.avg ?? null;
    return eps !== null && shares !== null && shares > 0 ? eps * shares : estimate?.netIncome.avg ?? null;
  };

  let revenue = base.revenue;
  let netIncome = base.netIncome;
  for (let index = 0; index < PROJECTION_YEARS; index++) {
    const revenueTarget = estimates[index]?.revenue.avg ?? null;
    if (revenue !== null && revenue > 0 && revenueTarget !== null && revenueTarget > 0) fitted.revenueGrowth[index] = revenueTarget / revenue - 1;
    if (estimates[index] && hasCostOfRevenue(base)) fitted.costGrowth[index] = fitted.revenueGrowth[index];
    revenue = revenue === null ? null : revenue * (1 + fitted.revenueGrowth[index]);

    const incomeTarget = targetNetIncome(index, start.shares);
    if (netIncome !== null && netIncome > 0 && incomeTarget !== null && incomeTarget > 0) fitted.netIncomeGrowth[index] = incomeTarget / netIncome - 1;
    netIncome = netIncome === null ? null : netIncome * (1 + fitted.netIncomeGrowth[index]);
  }

  // Advanced: each year's operating expenses are what's left between gross profit and the operating
  // income the target needs, given that year's interest & other and the last year's net income ratio.
  // Gross profit, interest & other and the share count don't depend on operating expenses.
  const projection = projectScenario("advanced", base, start, fitted);
  if (projection.ok && base.operatingIncome !== null && base.revenue !== null) {
    const ratio = netIncomeRatio(base).value;
    let previousOpex = base.revenue - (hasCostOfRevenue(base) ? base.costOfRevenue! : 0) - base.operatingIncome;
    projection.years.forEach((year, index) => {
      const target = targetNetIncome(index, year.shares);
      if (target !== null && previousOpex > 0 && year.other !== null) {
        const opex = (year.grossProfit ?? year.revenue) - (target / ratio - year.other);
        if (opex > 0) fitted.opexGrowth[index] = opex / previousOpex - 1;
      }
      previousOpex *= 1 + fitted.opexGrowth[index];
    });
  }
  return fitted;
}

export type HistoryYear = {
  year: number;
  revenue: number | null;
  revenueGrowth: number | null;
  costOfRevenue: number | null;
  costGrowth: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  operatingExpenses: number | null;
  opexGrowth: number | null;
  operatingIncome: number | null;
  operatingMargin: number | null;
  other: number | null;
  otherGrowth: number | null;
  netIncome: number | null;
  netIncomeGrowth: number | null;
  netMargin: number | null;
  shares: number | null;
  buybackYield: number | null;
  eps: number | null;
  pe: number | null;
};

export type ProjectionNotes = {
  revenueGrowth: string;
  netIncomeGrowth: string;
  costs: string;
  other: string;
  buybackYield: string;
  pe: string;
  netIncome: string;
  scenarios: string;
  shares: string;
};

export type ProjectionDefaults = {
  currency: string;
  base: BaseYear;
  start: StartingPoint;
  // Today's share count, or the last fiscal year's diluted average when today's isn't available.
  sharesSource: "today" | "lastReport";
  // Trailing-twelve-month diluted EPS, for today's P/E.
  ttmEps: number | null;
  // Oldest first, ending with the base year.
  history: HistoryYear[];
  years: number[];
  // The part of the first projected year still ahead of today, from 0 to 1.
  firstYearAhead: number;
  // Analysts' consensus for each projected year, where they have one.
  estimates: (AnalystEstimate | null)[];
  mode: ProjectionMode;
  scenarios: Record<ScenarioId, ScenarioInputs>;
  notes: ProjectionNotes;
};

// Growth the base case fades toward, halfway by the last projected year.
const LONG_RUN_GROWTH = 0.03;

// Revenue growth added to the base case, and the factor on its P/E range, for each scenario.
const SCENARIO_SPREAD: Record<ScenarioId, { growth: number; pe: number }> = {
  ultraBearish: { growth: -0.1, pe: 0.6 },
  bearish: { growth: -0.05, pe: 0.8 },
  base: { growth: 0, pe: 1 },
  bullish: { growth: 0.05, pe: 1.2 },
  ultraBullish: { growth: 0.1, pe: 1.4 },
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Rates to a tenth of a point, so inputs read 8.5 rather than 8.4731.
function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Growth is only meaningful from a positive base.
function growth(current: number | null, previous: number | null): number | null {
  return current === null || previous === null || previous <= 0 ? null : current / previous - 1;
}

function divide(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
}

function filled(value: number): number[] {
  return Array.from({ length: PROJECTION_YEARS }, () => value);
}

// Fiscal years from the annual income statement (and the ratios table for P/E), newest first.
function fiscalYears(income: StatementTable, ratios: StatementTable | null) {
  const rowValue = (table: StatementTable | null, id: string, columnId: string) => {
    const columnIndex = table?.columns.findIndex((column) => column.id === columnId) ?? -1;
    const row = table?.rows.find((candidate) => candidate.id === id);
    return columnIndex >= 0 ? row?.values[columnIndex] ?? null : null;
  };
  const years = income.columns
    .filter((column) => column.id !== "ttm")
    .map((column) => {
      const value = (id: string) => rowValue(income, id, column.id);
      const revenue = value("revenue");
      // Cost of revenue, from gross profit when only that is reported.
      const costOfRevenue = value("costOfRevenue") ?? (revenue !== null && value("grossProfit") !== null ? revenue - value("grossProfit")! : null);
      // Banks and insurers often report no operating income: pretax income stands in for it.
      const operatingIncome = value("operatingIncome");
      return {
        year: Number(column.label.match(/\d{4}/)?.[0]),
        periodEnding: column.periodEnding,
        revenue,
        costOfRevenue: costOfRevenue !== null && costOfRevenue > 0 ? costOfRevenue : null,
        operatingIncome: operatingIncome ?? value("pretaxIncome"),
        operatingFromPretax: operatingIncome === null && value("pretaxIncome") !== null,
        pretaxIncome: value("pretaxIncome"),
        netIncome: value("netIncome"),
        shares: value("shares"),
        eps: value("eps"),
        pe: rowValue(ratios, "pe", column.id),
      };
    })
    .filter((year) => Number.isFinite(year.year) && year.revenue !== null);
  const ttmIndex = income.columns.findIndex((column) => column.id === "ttm");
  const ttmEps = ttmIndex >= 0 ? income.rows.find((row) => row.id === "eps")?.values[ttmIndex] ?? null : null;
  return { years, ttmEps };
}

type FiscalYear = ReturnType<typeof fiscalYears>["years"][number];

function historyYear(year: FiscalYear, previous: FiscalYear | undefined, withCost: boolean): HistoryYear {
  const operatingExpenses = (current: FiscalYear | undefined) => {
    if (!current || current.revenue === null || current.operatingIncome === null) return null;
    if (withCost && current.costOfRevenue === null) return null;
    return current.revenue - (withCost ? current.costOfRevenue! : 0) - current.operatingIncome;
  };
  const other = (current: FiscalYear | undefined) =>
    current && current.pretaxIncome !== null && current.operatingIncome !== null ? current.pretaxIncome - current.operatingIncome : null;
  const grossProfit = withCost && year.revenue !== null && year.costOfRevenue !== null ? year.revenue - year.costOfRevenue : null;
  return {
    year: year.year,
    revenue: year.revenue,
    revenueGrowth: growth(year.revenue, previous?.revenue ?? null),
    costOfRevenue: withCost ? year.costOfRevenue : null,
    costGrowth: withCost ? growth(year.costOfRevenue, previous?.costOfRevenue ?? null) : null,
    grossProfit,
    grossMargin: divide(grossProfit, year.revenue),
    operatingExpenses: operatingExpenses(year),
    opexGrowth: growth(operatingExpenses(year), operatingExpenses(previous)),
    operatingIncome: year.operatingIncome,
    operatingMargin: divide(year.operatingIncome, year.revenue),
    other: other(year),
    otherGrowth: growth(other(year), other(previous)),
    netIncome: year.netIncome,
    netIncomeGrowth: growth(year.netIncome, previous?.netIncome ?? null),
    netMargin: divide(year.netIncome, year.revenue),
    shares: year.shares,
    // Positive when the share count fell: buybacks. Negative is dilution.
    buybackYield: year.shares !== null && previous?.shares ? 1 - year.shares / previous.shares : null,
    eps: year.eps,
    pe: year.pe !== null && year.pe > 0 ? year.pe : null,
  };
}

// The part of the first projected fiscal year still ahead of today, from 0 to 1.
function firstYearAhead(periodEnding: string | null, today: Date): number {
  const end = periodEnding ? new Date(`${periodEnding}T00:00:00Z`) : null;
  if (!end || Number.isNaN(end.getTime())) return 1;
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return clamp((end.getTime() - today.getTime()) / (365.25 * 24 * 60 * 60 * 1000), 0, 1);
}

// Estimates are dated by the fiscal year's end, which can move a few days between years (52- and
// 53-week years), so each projected year takes the estimate within two months of its expected end.
function estimatesByYear(base: BaseYear, years: number[], estimates: AnalystEstimate[]): (AnalystEstimate | null)[] {
  const baseEnd = base.periodEnding ? Date.parse(`${base.periodEnding}T00:00:00Z`) : NaN;
  const yearLength = 365.25 * 24 * 60 * 60 * 1000;
  return years.map((year, index) => estimates.find((estimate) => {
    const end = Date.parse(`${estimate.date}T00:00:00Z`);
    return Number.isNaN(baseEnd)
      ? Number(estimate.date.slice(0, 4)) === year
      : Math.abs(end - (baseEnd + (index + 1) * yearLength)) <= 61 * 24 * 60 * 60 * 1000;
  }) ?? null);
}

export function buildProjectionDefaults({
  income,
  ratios,
  price,
  shares,
  estimates = [],
  today,
}: {
  income: StatementTable;
  ratios: StatementTable | null;
  price: number | null;
  // Shares outstanding today, from the quote data.
  shares: number | null;
  estimates?: AnalystEstimate[];
  today: Date;
}): ProjectionDefaults {
  const { years: fiscal, ttmEps } = fiscalYears(income, ratios);
  const latest = fiscal[0];
  const fallbackYear = today.getUTCFullYear() - 1;
  const base: BaseYear = {
    year: latest?.year ?? fallbackYear,
    periodEnding: latest?.periodEnding ?? null,
    revenue: latest?.revenue ?? null,
    costOfRevenue: latest?.costOfRevenue ?? null,
    operatingIncome: latest?.operatingIncome ?? null,
    pretaxIncome: latest?.pretaxIncome ?? null,
    netIncome: latest?.netIncome ?? null,
  };
  const withCost = hasCostOfRevenue(base);
  const history = fiscal
    .slice(0, HISTORY_YEARS)
    .map((year, index) => historyYear(year, fiscal[index + 1], withCost))
    .reverse();
  const projectedYears = Array.from({ length: PROJECTION_YEARS }, (_, index) => base.year + index + 1);
  const [firstYear, lastYear] = [projectedYears[0], projectedYears[PROJECTION_YEARS - 1]];
  const span = (from: number, to: number) => (from === to ? `fiscal ${to}` : `fiscal ${from}–${to}`);
  // Today's share count, or the last fiscal year's when there's no quote data.
  const start: StartingPoint = { price, shares: shares ?? latest?.shares ?? null };
  const sharesNote = shares !== null
    ? "Shares outstanding today. Simple mode keeps this count in every year; Advanced mode changes it by the buyback yield."
    : `Today's share count isn't available, so this is fiscal ${base.year}'s diluted average. Type the current count if you have it.`;

  // Revenue growth: the compound rate across the fiscal years available, fading toward 3%.
  const revenues = fiscal.map((year) => year.revenue);
  const oldest = revenues.findLastIndex((value) => value !== null && value > 0);
  const compound = oldest > 0 && base.revenue !== null && base.revenue > 0 ? (base.revenue / revenues[oldest]!) ** (1 / oldest) - 1 : null;
  const firstGrowth = roundRate(clamp(compound ?? 0.05, -0.1, 0.3));
  const lastGrowth = (firstGrowth + LONG_RUN_GROWTH) / 2;
  const baseGrowth = projectedYears.map((_, index) => roundRate(firstGrowth + ((lastGrowth - firstGrowth) * index) / (PROJECTION_YEARS - 1)));
  const growthSource = compound === null
    ? "5% (there isn't enough revenue history)"
    : `${pct(firstGrowth)}, the ${span(fiscal[oldest].year, base.year)} compound revenue growth${firstGrowth !== roundRate(compound) ? ` of ${pct(compound)}, capped` : ""},`;

  // Buyback yield: the average yearly fall in diluted shares. Today's count already includes the
  // part of the first projected year that has passed, so that year only gets the rest.
  const yields = history.flatMap((year) => (year.buybackYield === null ? [] : [year.buybackYield]));
  const averageYield = mean(yields);
  const yearlyBuyback = averageYield === null ? 0 : roundRate(clamp(averageYield, -0.05, 0.05));
  const ahead = firstYearAhead(base.periodEnding, today);
  const buyback = projectedYears.map((_, index) => (index === 0 ? roundRate(yearlyBuyback * ahead) : yearlyBuyback));
  const monthsAhead = Math.round(ahead * 12);

  // P/E range: the lowest, median and highest fiscal-year P/E; else today's ± 20%; else a guess.
  const peHistory = fiscal.flatMap((year) => (year.pe !== null && year.pe > 0 ? [year.pe] : []));
  const peTtm = price !== null && ttmEps !== null && ttmEps > 0 ? price / ttmEps : null;
  let pe = { low: 15, mid: 20, high: 25 };
  let peNote = "15×, 20× and 25×, a market-average guess: there's no P/E history to start from.";
  if (peHistory.length >= 2) {
    pe = { low: Math.min(...peHistory), mid: median(peHistory), high: Math.max(...peHistory) };
    const peYears = fiscal.filter((year) => year.pe !== null && year.pe > 0).map((year) => year.year);
    peNote = `The lowest, median and highest P/E of ${span(Math.min(...peYears), Math.max(...peYears))}.`;
  } else if (peTtm !== null) {
    pe = { low: peTtm * 0.8, mid: peTtm, high: peTtm * 1.2 };
    peNote = `Today's P/E of ${peTtm.toFixed(1)}, minus and plus 20%.`;
  }
  const multiple = (value: number, factor: number) => Math.round(clamp(value, 5, 100) * factor);

  const scenarios = Object.fromEntries(SCENARIOS.map(({ id }) => {
    const spread = SCENARIO_SPREAD[id];
    const revenueGrowth = baseGrowth.map((value) => roundRate(value + spread.growth));
    return [id, {
      revenueGrowth,
      // Costs and net income grow with revenue, so the last year's margins hold.
      netIncomeGrowth: [...revenueGrowth],
      costGrowth: [...revenueGrowth],
      opexGrowth: [...revenueGrowth],
      otherGrowth: filled(0),
      buybackYield: [...buyback],
      peLow: filled(multiple(pe.low, spread.pe)),
      peMid: filled(multiple(pe.mid, spread.pe)),
      peHigh: filled(multiple(pe.high, spread.pe)),
    }];
  })) as Record<ScenarioId, ScenarioInputs>;

  const ratio = netIncomeRatio(base);
  const margin = divide(base.netIncome, base.revenue);
  return {
    currency: income.currency,
    base,
    start,
    sharesSource: shares !== null ? "today" : "lastReport",
    ttmEps,
    history,
    years: projectedYears,
    firstYearAhead: ahead,
    estimates: estimatesByYear(base, projectedYears, estimates),
    // Simple is the quicker read; it needs a profit to grow, so losses start in Advanced.
    mode: base.netIncome !== null && base.netIncome > 0 ? "simple" : "advanced",
    scenarios,
    notes: {
      revenueGrowth: `The base case starts at ${growthSource} and fades halfway to ${pct(LONG_RUN_GROWTH)} by ${lastYear}.`,
      netIncomeGrowth: `Same as revenue growth, so the net margin stays at fiscal ${base.year}'s${margin === null ? "" : ` ${pct(margin)}`}.`,
      costs: withCost
        ? `Cost of revenue and operating expenses grow with revenue, so fiscal ${base.year}'s gross and operating margins hold.`
        : `Operating expenses grow with revenue, so fiscal ${base.year}'s operating margin holds. No cost of revenue is reported, so operating expenses are everything between revenue and operating income.`,
      other: latest?.operatingFromPretax
        ? "No operating income is reported, as is usual for banks and insurers, so pretax income stands in for it and interest & other is zero."
        : "Interest & other is pretax income minus operating income: interest paid and earned, investment gains and other non-operating items. It stays at the last year's level.",
      buybackYield: averageYield === null
        ? "0%: there isn't enough share count history."
        : `${pct(yearlyBuyback)} a year, the average fall in diluted shares over ${span(history[0].year, base.year)} (negative means dilution).${ahead < 1 ? ` ${firstYear} only counts the ${monthsAhead === 1 ? "month" : `${monthsAhead} months`} still ahead, since today's share count already includes the rest.` : ""}`,
      pe: peNote,
      netIncome: ratio.fromFilings
        ? `Net income is ${pct(ratio.value)} of pretax income, fiscal ${base.year}'s ratio after taxes and minority interests.`
        : `Net income is ${pct(FALLBACK_NET_INCOME_RATIO)} of pretax income, a 21% tax rate: fiscal ${base.year}'s pretax income doesn't give a usable ratio.`,
      scenarios: "Bearish and bullish start from the base case with revenue growth 5 points lower or higher and the P/E range 20% lower or higher; the ultra cases move 10 points and 40%.",
      shares: sharesNote,
    },
  };
}
