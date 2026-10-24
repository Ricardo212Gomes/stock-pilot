import type { StatementTable } from "./financial-statements";

// Jeremy Lefebvre's (1000xStocks) projection template: from the last fiscal year, revenue and net
// income each grow at their own rate, EPS is net income over today's share count, and the price is
// EPS × a low and a high P/E. Five scenarios, from ultra bearish to ultra bullish, sit side by side.
// It shows an expected annual return, not an intrinsic value.

export const SCENARIOS = [
  { id: "ultraBearish", label: "Ultra Bearish" },
  { id: "bearish", label: "Bearish" },
  { id: "neutral", label: "Neutral" },
  { id: "bullish", label: "Bullish" },
  { id: "ultraBullish", label: "Ultra Bullish" },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]["id"];

export type ScenarioInputs = {
  revenueGrowth: number;
  netIncomeGrowth: number;
  peLow: number;
  peHigh: number;
};

export type ProjectionInputs = {
  price: number | null;
  // Last fiscal year's figures, the column the template projects from.
  revenue: number | null;
  netIncome: number | null;
  shares: number | null;
  scenarios: Record<ScenarioId, ScenarioInputs>;
};

// The template projects five years past the last fiscal year.
export const PROJECTION_YEARS = 5;

export type YearRow = {
  year: number;
  // Years from today to the end of this fiscal year; returns need at least one.
  yearsAhead: number;
  revenue: number;
  netIncome: number;
  netMargin: number;
  eps: number;
  priceLow: number | null;
  priceHigh: number | null;
  annualReturnLow: number | null;
  annualReturnHigh: number | null;
};

export type ScenarioProjection =
  | { ok: true; rows: YearRow[] }
  | { ok: false; reason: string };

function returnTo(price: number | null, today: number | null, years: number): number | null {
  if (price === null || today === null || today <= 0 || years < 1) return null;
  return (price / today) ** (1 / years) - 1;
}

export function projectScenario(
  inputs: ProjectionInputs,
  scenario: ScenarioInputs,
  baseYear: number,
  currentYear: number,
): ScenarioProjection {
  if (inputs.revenue === null || inputs.revenue <= 0) return { ok: false, reason: "Needs revenue above zero." };
  if (inputs.netIncome === null || inputs.netIncome <= 0) {
    return { ok: false, reason: "Needs positive net income: a growth rate can't be applied to a loss." };
  }
  if (inputs.shares === null || inputs.shares <= 0) return { ok: false, reason: "Needs the number of shares outstanding." };

  return {
    ok: true,
    rows: Array.from({ length: PROJECTION_YEARS }, (_, index) => {
      const step = index + 1;
      const year = baseYear + step;
      const revenue = inputs.revenue! * (1 + scenario.revenueGrowth) ** step;
      const netIncome = inputs.netIncome! * (1 + scenario.netIncomeGrowth) ** step;
      // The template keeps today's share count in every year.
      const eps = netIncome / inputs.shares!;
      const priceLow = eps * scenario.peLow;
      const priceHigh = eps * scenario.peHigh;
      const yearsAhead = year - currentYear;
      return {
        year,
        yearsAhead,
        revenue,
        netIncome,
        netMargin: netIncome / revenue,
        eps,
        priceLow,
        priceHigh,
        annualReturnLow: returnTo(priceLow, inputs.price, yearsAhead),
        annualReturnHigh: returnTo(priceHigh, inputs.price, yearsAhead),
      };
    }),
  };
}

export type HistoryRow = {
  year: string;
  revenueGrowth: number | null;
  netIncomeGrowth: number | null;
  netMargin: number | null;
};

export type ProjectionHistory = {
  rows: HistoryRow[];
  average: Omit<HistoryRow, "year">;
};

export type ProjectionNotes = Partial<Record<
  "price" | "revenue" | "netIncome" | "shares" | `${ScenarioId}.${keyof ScenarioInputs}`,
  string
>>;

export type ProjectionDefaults = {
  inputs: ProjectionInputs;
  notes: ProjectionNotes;
  currency: string;
  baseYear: number;
  currentYear: number;
  history: ProjectionHistory;
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mean(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

// Growth added to the neutral case, and the factor on its P/E range, for each scenario.
const SCENARIO_SPREAD: Record<ScenarioId, { growth: number; pe: number }> = {
  ultraBearish: { growth: -0.1, pe: 0.6 },
  bearish: { growth: -0.05, pe: 0.8 },
  neutral: { growth: 0, pe: 1 },
  bullish: { growth: 0.05, pe: 1.2 },
  ultraBullish: { growth: 0.1, pe: 1.4 },
};

export function buildProjectionDefaults({
  income,
  ratios,
  price,
  currentYear,
}: {
  income: StatementTable;
  ratios: StatementTable | null;
  price: number | null;
  currentYear: number;
}): ProjectionDefaults {
  const notes: ProjectionNotes = {};
  // Fiscal-year columns only, newest first: the template starts from a full year.
  const fiscalIndexes = income.columns.flatMap((column, index) => (column.id === "ttm" ? [] : [index]));
  const values = (table: StatementTable | null, id: string) => {
    const row = table?.rows.find((candidate) => candidate.id === id);
    return fiscalIndexes.map((index) => row?.values[index] ?? null);
  };
  const latest = income.columns[fiscalIndexes[0]];
  const latestLabel = latest?.label ?? "the latest fiscal year";
  const baseYear = Number(latest?.label.match(/\d{4}/)?.[0] ?? currentYear - 1);

  const revenue = values(income, "revenue")[0] ?? null;
  const netIncome = values(income, "netIncome")[0] ?? null;
  const shares = values(income, "shares")[0] ?? null;
  notes.price = price !== null ? "Latest quote." : "No quote available. Type the current price.";
  notes.revenue = `${latestLabel} revenue.`;
  notes.netIncome = `${latestLabel} net income.`;
  notes.shares = `Diluted shares in ${latestLabel}, kept the same in every year.`;

  // The template's reference table: each fiscal year's growth and margin, oldest first, and averages.
  const revenueGrowth = values(income, "revenueGrowth");
  const netIncomeGrowth = values(income, "netIncomeGrowth");
  const netMargin = values(income, "profitMargin");
  const rows: HistoryRow[] = fiscalIndexes
    .map((index, position) => ({
      year: income.columns[index].label.replace(/^FY\s*/, ""),
      revenueGrowth: revenueGrowth[position],
      netIncomeGrowth: netIncomeGrowth[position],
      netMargin: netMargin[position],
    }))
    .reverse();
  const average = { revenueGrowth: mean(revenueGrowth), netIncomeGrowth: mean(netIncomeGrowth), netMargin: mean(netMargin) };

  const baseRevenueGrowth = clamp(average.revenueGrowth ?? 0.05, -0.2, 0.5);
  const baseIncomeGrowth = clamp(average.netIncomeGrowth ?? baseRevenueGrowth, -0.3, 0.6);
  const revenueNote = average.revenueGrowth !== null
    ? `average revenue growth (${pct(average.revenueGrowth)} a year)`
    : "a 5% placeholder (not enough revenue history)";
  const incomeNote = average.netIncomeGrowth !== null
    ? `average net income growth (${pct(average.netIncomeGrowth)} a year)`
    : "revenue growth (not enough net income history)";

  // P/E range: the lowest and highest fiscal-year P/E, or today's P/E ± 20%.
  const peHistory = values(ratios, "pe").filter((value): value is number => value !== null && value > 0);
  const currentPe = price !== null && netIncome && shares && netIncome > 0 ? price / (netIncome / shares) : null;
  let peLow = 15;
  let peHigh = 25;
  let peNote = "15× to 25×: the company isn't profitable today, so this is a market-average guess";
  if (peHistory.length >= 2) {
    peLow = Math.min(...peHistory);
    peHigh = Math.max(...peHistory);
    peNote = `the lowest and highest P/E of the last ${peHistory.length} fiscal years`;
  } else if (currentPe !== null) {
    peLow = currentPe * 0.8;
    peHigh = currentPe * 1.2;
    peNote = "today's P/E minus and plus 20%";
  }

  const scenarios = Object.fromEntries(SCENARIOS.map(({ id, label }) => {
    const spread = SCENARIO_SPREAD[id];
    const shift = spread.growth === 0 ? "" : ` ${spread.growth > 0 ? "plus" : "minus"} ${Math.abs(spread.growth * 100)} points`;
    const factor = spread.pe === 1 ? "" : ` × ${spread.pe}`;
    notes[`${id}.revenueGrowth`] = `${label}: ${revenueNote}${shift}.`;
    notes[`${id}.netIncomeGrowth`] = `${label}: ${incomeNote}${shift}.`;
    notes[`${id}.peLow`] = `${label}: ${peNote}${factor}.`;
    notes[`${id}.peHigh`] = notes[`${id}.peLow`];
    return [id, {
      revenueGrowth: clamp(baseRevenueGrowth + spread.growth, -0.5, 1),
      netIncomeGrowth: clamp(baseIncomeGrowth + spread.growth, -0.6, 1.5),
      peLow: clamp(peLow * spread.pe, 1, 150),
      peHigh: clamp(peHigh * spread.pe, 1, 150),
    }];
  })) as Record<ScenarioId, ScenarioInputs>;

  return {
    currency: income.currency,
    notes,
    baseYear,
    currentYear,
    history: { rows, average },
    inputs: { price, revenue, netIncome, shares, scenarios },
  };
}
