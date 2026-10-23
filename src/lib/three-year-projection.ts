import type { StatementTable } from "./financial-statements";

// A revenue × margin × P/E projection, the style used by quote sites' "what could this stock be
// worth in 3 years" calculators. It shows an expected annual return, not an intrinsic value.

export type ScenarioId = "low" | "high";

export type ScenarioInputs = {
  revenueGrowth: number;
  netMargin: number;
  peRatio: number;
};

export type ProjectionInputs = {
  price: number | null;
  revenue: number | null;
  shares: number | null;
  years: number;
  sharesChange: number;
  targetReturn: number;
  low: ScenarioInputs;
  high: ScenarioInputs;
};

export type ScenarioResult = {
  revenue: number;
  netIncome: number;
  shares: number;
  eps: number;
  price: number | null;
  totalReturn: number | null;
  annualReturn: number | null;
  buyBelow: number | null;
};

export type YearRow = {
  year: number;
  low: { revenue: number; netIncome: number; eps: number; price: number | null };
  high: { revenue: number; netIncome: number; eps: number; price: number | null };
};

export type ProjectionResult =
  | { ok: true; low: ScenarioResult; high: ScenarioResult; years: YearRow[] }
  | { ok: false; reason: string };

export const YEARS_RANGE = { min: 1, max: 10 };

function scenarioYear(inputs: ProjectionInputs, scenario: ScenarioInputs, year: number) {
  const revenue = inputs.revenue! * (1 + scenario.revenueGrowth) ** year;
  // The scenario's net margin applies to every projected year.
  const netIncome = revenue * scenario.netMargin;
  const shares = inputs.shares! * (1 + inputs.sharesChange) ** year;
  const eps = netIncome / shares;
  // A price only makes sense on positive earnings.
  const price = eps > 0 ? eps * scenario.peRatio : null;
  return { revenue, netIncome, shares, eps, price };
}

export function projectScenario(inputs: ProjectionInputs, scenario: ScenarioInputs): ScenarioResult {
  const end = scenarioYear(inputs, scenario, inputs.years);
  const totalReturn = end.price !== null && inputs.price ? end.price / inputs.price - 1 : null;
  const annualReturn = end.price !== null && inputs.price
    ? (end.price / inputs.price) ** (1 / inputs.years) - 1
    : null;
  return {
    ...end,
    totalReturn,
    annualReturn,
    // The most you could pay today and still earn the target return to that price.
    buyBelow: end.price !== null ? end.price / (1 + inputs.targetReturn) ** inputs.years : null,
  };
}

export function projectThreeYear(inputs: ProjectionInputs): ProjectionResult {
  if (inputs.revenue === null || inputs.revenue <= 0) {
    return { ok: false, reason: "Needs revenue above zero." };
  }
  if (inputs.shares === null || inputs.shares <= 0) {
    return { ok: false, reason: "Needs the number of shares outstanding." };
  }
  const years = Math.round(Math.min(Math.max(inputs.years, YEARS_RANGE.min), YEARS_RANGE.max));
  const bounded = { ...inputs, years };

  return {
    ok: true,
    low: projectScenario(bounded, inputs.low),
    high: projectScenario(bounded, inputs.high),
    years: Array.from({ length: years }, (_, index) => {
      const year = index + 1;
      const pick = (scenario: ScenarioInputs) => {
        const { revenue, netIncome, eps, price } = scenarioYear(bounded, scenario, year);
        return { revenue, netIncome, eps, price };
      };
      return { year, low: pick(inputs.low), high: pick(inputs.high) };
    }),
  };
}

export type ProjectionNotes = Partial<Record<
  "price" | "revenue" | "shares" | "sharesChange" | "years" | "targetReturn" | `${ScenarioId}.${keyof ScenarioInputs}`,
  string
>>;

export type ProjectionDefaults = { inputs: ProjectionInputs; notes: ProjectionNotes; currency: string };

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rowValues(table: StatementTable | null, id: string): (number | null)[] {
  return table?.rows.find((row) => row.id === id)?.values ?? [];
}

// Compound growth between the oldest and newest fiscal-year values (columns newest first).
function cagr(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null && value > 0);
  if (present.length < 2) return null;
  return (present[0] / present[present.length - 1]) ** (1 / (present.length - 1)) - 1;
}

export function buildProjectionDefaults({
  income,
  ratios,
  price,
}: {
  income: StatementTable;
  ratios: StatementTable | null;
  price: number | null;
}): ProjectionDefaults {
  const notes: ProjectionNotes = {};
  const hasTtm = income.columns[0]?.id === "ttm";
  const latestLabel = income.columns[0]?.label ?? "the latest year";
  // Fiscal-year columns only, for growth rates.
  const fiscal = (values: (number | null)[]) => (hasTtm ? values.slice(1) : values);

  const revenue = rowValues(income, "revenue")[0] ?? null;
  const netIncome = rowValues(income, "netIncome")[0] ?? null;
  const shares = rowValues(income, "shares")[0] ?? null;
  notes.price = price !== null ? "Latest quote." : "No quote available. Type the current price.";
  notes.revenue = `${latestLabel} revenue.`;
  notes.shares = `Diluted shares in ${latestLabel}.`;

  const revenueGrowth = cagr(fiscal(rowValues(income, "revenue")));
  const highGrowth = clamp(revenueGrowth ?? 0.05, -0.1, 0.4);
  const lowGrowth = clamp(highGrowth - 0.04, -0.15, 0.4);
  notes["high.revenueGrowth"] = revenueGrowth !== null
    ? `Historical revenue growth (${pct(revenueGrowth)} a year), capped at 40%.`
    : "5% placeholder: not enough revenue history.";
  notes["low.revenueGrowth"] = "4 points below the high case.";

  const margin = revenue && netIncome !== null ? netIncome / revenue : null;
  const highMargin = clamp(margin ?? 0.1, -0.5, 0.6);
  const lowMargin = clamp(highMargin - 0.02, -0.5, 0.6);
  notes["high.netMargin"] = margin !== null ? `${latestLabel} net margin.` : "10% placeholder: margin unavailable.";
  notes["low.netMargin"] = "2 points below the high case.";

  const sharesGrowth = cagr(fiscal(rowValues(income, "shares")));
  const sharesChange = clamp(sharesGrowth ?? 0, -0.05, 0.05);
  notes.sharesChange = sharesGrowth !== null
    ? `Historical change in diluted shares (${pct(sharesGrowth)} a year). Negative means buybacks.`
    : "0%: share history unavailable.";

  // P/E range: the lowest and highest fiscal-year P/E, or today's P/E ± 20%.
  const peHistory = fiscal(rowValues(ratios, "pe")).filter((value): value is number => value !== null && value > 0);
  const currentPe = price !== null && netIncome && shares && netIncome > 0 ? price / (netIncome / shares) : null;
  let lowPe: number;
  let highPe: number;
  if (peHistory.length >= 2) {
    lowPe = Math.min(...peHistory);
    highPe = Math.max(...peHistory);
    notes["low.peRatio"] = `Lowest P/E of the last ${peHistory.length} fiscal years.`;
    notes["high.peRatio"] = `Highest P/E of the last ${peHistory.length} fiscal years.`;
  } else if (currentPe !== null) {
    lowPe = currentPe * 0.8;
    highPe = currentPe * 1.2;
    notes["low.peRatio"] = "Today's P/E minus 20%.";
    notes["high.peRatio"] = "Today's P/E plus 20%.";
  } else {
    lowPe = 15;
    highPe = 25;
    notes["low.peRatio"] = "15×: the company isn't profitable today, so this is a market-average guess.";
    notes["high.peRatio"] = "25×: a growth-company multiple, as a placeholder.";
  }

  notes.years = "3 years, the usual horizon for this kind of projection.";
  notes.targetReturn = "15% a year: a common goal for individual stock picks, above the market's long-run ~10%.";

  return {
    currency: income.currency,
    notes,
    inputs: {
      price,
      revenue,
      shares,
      years: 3,
      sharesChange,
      targetReturn: 0.15,
      low: { revenueGrowth: lowGrowth, netMargin: lowMargin, peRatio: clamp(lowPe, 1, 150) },
      high: { revenueGrowth: highGrowth, netMargin: highMargin, peRatio: clamp(highPe, 1, 150) },
    },
  };
}
