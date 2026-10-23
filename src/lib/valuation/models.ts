import { clampAssumption, type AssumptionKey, type Assumptions } from "./assumptions";

export type ModelId = "dcf" | "earnings" | "revenue" | "ddm" | "residualIncome" | "graham";

export type StepKind = "money" | "percent" | "multiple" | "years";

export type ModelStep = {
  label: string;
  value: number;
  kind: StepKind;
};

export type ModelResult =
  | { id: ModelId; ok: true; value: number; steps: ModelStep[] }
  | { id: ModelId; ok: false; reason: string };

export type ModelInfo = {
  id: ModelId;
  name: string;
  bestFor: string;
  idea: string;
  formula: string;
  caveat: string;
  inputs: AssumptionKey[];
};

export const MODEL_INFO: Record<ModelId, ModelInfo> = {
  dcf: {
    id: "dcf",
    name: "Discounted cash flow (DCF)",
    bestFor: "Established companies with steady, positive free cash flow.",
    idea: "A share is worth the cash the business will generate for it, brought back to today's money. Free cash flow grows for the projection years, then at the terminal rate forever.",
    formula: "Value = Σ FCFₜ ÷ (1 + r)ᵗ + [FCFₙ × (1 + g) ÷ (r − g)] ÷ (1 + r)ⁿ",
    caveat: "Very sensitive to the discount rate and terminal growth. Most of the value usually sits in the terminal value, so check the sensitivity table.",
    inputs: ["fcfPerShare", "growthRate", "growthYears", "terminalGrowth", "discountRate"],
  },
  earnings: {
    id: "earnings",
    name: "Earnings growth and exit multiple",
    bestFor: "Profitable growth companies, where earnings matter more than today's cash flow.",
    idea: "Grow earnings per share for the projection, value the stock at an exit P/E at the end, add the dividends collected along the way, and discount it all back to today.",
    formula: "Value = Σ (EPSₜ × payout) ÷ (1 + r)ᵗ + (EPSₙ × exit P/E) ÷ (1 + r)ⁿ",
    caveat: "The exit P/E carries much of the result. A high-growth company rarely keeps today's multiple once it matures.",
    inputs: ["epsPerShare", "growthRate", "growthYears", "exitPe", "payoutRatio", "discountRate"],
  },
  revenue: {
    id: "revenue",
    name: "Revenue and target margin",
    bestFor: "Young or unprofitable companies whose value depends on future scale.",
    idea: "Grow sales for the projection, assume the business reaches a mature profit margin, value those future earnings at an exit P/E and discount back to today.",
    formula: "Value = (Revenueₙ × target margin × exit P/E) ÷ (1 + r)ⁿ",
    caveat: "Assumes the company survives and reaches the target margin. Use a higher discount rate and margin of safety for unproven businesses.",
    inputs: ["revenuePerShare", "revenueGrowth", "growthYears", "targetNetMargin", "exitPe", "discountRate"],
  },
  ddm: {
    id: "ddm",
    name: "Dividend discount model (DDM)",
    bestFor: "Mature dividend payers, utilities and REITs.",
    idea: "For a long-term holder, a share is worth the dividends it will pay. Dividends grow for the projection years, then at the terminal rate forever.",
    formula: "Value = Σ Dₜ ÷ (1 + r)ᵗ + [Dₙ × (1 + g) ÷ (r − g)] ÷ (1 + r)ⁿ",
    caveat: "Ignores earnings the company keeps and reinvests, so it undervalues companies with low payouts and does not apply to non-payers.",
    inputs: ["dividendPerShare", "dividendGrowth", "growthYears", "terminalGrowth", "discountRate"],
  },
  residualIncome: {
    id: "residualIncome",
    name: "Residual income (excess return)",
    bestFor: "Banks, insurers and other financial companies.",
    idea: "Start from book value, then add the profit earned above what shareholders require (ROE minus the discount rate, times book value). Retained earnings grow book value each year.",
    formula: "Value = Book₀ + Σ (ROE − r) × Bookₜ₋₁ ÷ (1 + r)ᵗ + [(ROE − r) × Bookₙ ÷ (r − g)] ÷ (1 + r)ⁿ",
    caveat: "Only creates value when ROE beats the discount rate, and assumes that excess return lasts. If competition will erode it, lower ROE towards the discount rate.",
    inputs: ["bookValuePerShare", "returnOnEquity", "payoutRatio", "growthYears", "terminalGrowth", "discountRate"],
  },
  graham: {
    id: "graham",
    name: "Graham formula",
    bestFor: "A quick sanity check for stable, profitable companies.",
    idea: "Benjamin Graham's rule of thumb: a no-growth company is worth about 8.5 times earnings, plus two times the expected growth rate, scaled for today's bond yields.",
    formula: "Value = EPS × (8.5 + 2g) × 4.4 ÷ Y   (g and Y in percent)",
    caveat: "A rough heuristic, not a full model. It overstates value for fast growers, so growth above 15% is capped here.",
    inputs: ["epsPerShare", "growthRate", "bondYield"],
  },
};

export const MODEL_ORDER: ModelId[] = ["dcf", "earnings", "revenue", "ddm", "residualIncome", "graham"];

const GRAHAM_MAX_GROWTH = 0.15;

function presentValue(amount: number, rate: number, years: number): number {
  return amount / (1 + rate) ** years;
}

function years(assumptions: Assumptions): number {
  return clampAssumption("growthYears", assumptions.growthYears ?? 5);
}

function rate(assumptions: Assumptions, key: AssumptionKey): number {
  return assumptions[key] ?? 0;
}

function missing(id: ModelId, reason: string): ModelResult {
  return { id, ok: false, reason };
}

function growingPerpetuity(
  id: ModelId,
  base: number,
  growth: number,
  terminalGrowth: number,
  discountRate: number,
  n: number,
  label: string,
): ModelResult {
  if (discountRate <= terminalGrowth) {
    return missing(id, "The discount rate must be higher than terminal growth, or the value would be infinite.");
  }

  let amount = base;
  let presentValueOfStage = 0;
  for (let year = 1; year <= n; year++) {
    amount *= 1 + growth;
    presentValueOfStage += presentValue(amount, discountRate, year);
  }
  const terminalValue = (amount * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const presentTerminal = presentValue(terminalValue, discountRate, n);

  return {
    id,
    ok: true,
    value: presentValueOfStage + presentTerminal,
    steps: [
      { label: `${label} in year ${n}`, value: amount, kind: "money" },
      { label: `Present value of years 1–${n}`, value: presentValueOfStage, kind: "money" },
      { label: `Terminal value in year ${n}`, value: terminalValue, kind: "money" },
      { label: "Present value of terminal value", value: presentTerminal, kind: "money" },
      { label: "Terminal value share of total", value: presentTerminal / (presentValueOfStage + presentTerminal), kind: "percent" },
    ],
  };
}

export function discountedCashFlow(assumptions: Assumptions): ModelResult {
  const fcf = assumptions.fcfPerShare;
  if (fcf === null || fcf <= 0) {
    return missing("dcf", "Needs positive free cash flow per share.");
  }
  return growingPerpetuity(
    "dcf",
    fcf,
    rate(assumptions, "growthRate"),
    rate(assumptions, "terminalGrowth"),
    rate(assumptions, "discountRate"),
    years(assumptions),
    "Free cash flow per share",
  );
}

export function dividendDiscount(assumptions: Assumptions): ModelResult {
  const dividend = assumptions.dividendPerShare;
  if (dividend === null || dividend <= 0) {
    return missing("ddm", "Needs a dividend above zero.");
  }
  return growingPerpetuity(
    "ddm",
    dividend,
    rate(assumptions, "dividendGrowth"),
    rate(assumptions, "terminalGrowth"),
    rate(assumptions, "discountRate"),
    years(assumptions),
    "Dividend per share",
  );
}

export function earningsMultiple(assumptions: Assumptions): ModelResult {
  const eps = assumptions.epsPerShare;
  if (eps === null || eps <= 0) {
    return missing("earnings", "Needs positive earnings per share.");
  }

  const n = years(assumptions);
  const r = rate(assumptions, "discountRate");
  const growth = rate(assumptions, "growthRate");
  const payout = rate(assumptions, "payoutRatio");
  const exitPe = rate(assumptions, "exitPe");

  let earnings = eps;
  let presentDividends = 0;
  for (let year = 1; year <= n; year++) {
    earnings *= 1 + growth;
    presentDividends += presentValue(earnings * payout, r, year);
  }
  const exitPrice = earnings * exitPe;
  const presentExit = presentValue(exitPrice, r, n);

  return {
    id: "earnings",
    ok: true,
    value: presentDividends + presentExit,
    steps: [
      { label: `EPS in year ${n}`, value: earnings, kind: "money" },
      { label: `Share price in year ${n} (EPS × exit P/E)`, value: exitPrice, kind: "money" },
      { label: "Present value of that price", value: presentExit, kind: "money" },
      { label: "Present value of dividends collected", value: presentDividends, kind: "money" },
    ],
  };
}

export function revenueMargin(assumptions: Assumptions): ModelResult {
  const revenue = assumptions.revenuePerShare;
  if (revenue === null || revenue <= 0) {
    return missing("revenue", "Needs revenue per share above zero.");
  }
  const margin = rate(assumptions, "targetNetMargin");
  if (margin <= 0) {
    return missing("revenue", "Needs a target net margin above zero.");
  }

  const n = years(assumptions);
  const futureRevenue = revenue * (1 + rate(assumptions, "revenueGrowth")) ** n;
  const futureEarnings = futureRevenue * margin;
  const exitPrice = futureEarnings * rate(assumptions, "exitPe");
  const value = presentValue(exitPrice, rate(assumptions, "discountRate"), n);

  return {
    id: "revenue",
    ok: true,
    value,
    steps: [
      { label: `Revenue per share in year ${n}`, value: futureRevenue, kind: "money" },
      { label: `EPS in year ${n} (revenue × target margin)`, value: futureEarnings, kind: "money" },
      { label: `Share price in year ${n} (EPS × exit P/E)`, value: exitPrice, kind: "money" },
      { label: "Present value of that price", value, kind: "money" },
    ],
  };
}

export function residualIncome(assumptions: Assumptions): ModelResult {
  const book = assumptions.bookValuePerShare;
  if (book === null || book <= 0) {
    return missing("residualIncome", "Needs positive book value per share.");
  }

  const n = years(assumptions);
  const r = rate(assumptions, "discountRate");
  const terminalGrowth = rate(assumptions, "terminalGrowth");
  if (r <= terminalGrowth) {
    return missing("residualIncome", "The discount rate must be higher than terminal growth, or the value would be infinite.");
  }
  const roe = rate(assumptions, "returnOnEquity");
  const retention = 1 - rate(assumptions, "payoutRatio");

  let bookValue = book;
  let presentExcess = 0;
  for (let year = 1; year <= n; year++) {
    const excess = (roe - r) * bookValue;
    presentExcess += presentValue(excess, r, year);
    bookValue += roe * bookValue * retention;
  }
  const nextExcess = (roe - r) * bookValue;
  const terminal = nextExcess / (r - terminalGrowth);
  const presentTerminal = presentValue(terminal, r, n);

  return {
    id: "residualIncome",
    ok: true,
    value: book + presentExcess + presentTerminal,
    steps: [
      { label: "Book value per share today", value: book, kind: "money" },
      { label: "Excess return (ROE − discount rate)", value: roe - r, kind: "percent" },
      { label: `Present value of excess returns, years 1–${n}`, value: presentExcess, kind: "money" },
      { label: `Book value per share in year ${n}`, value: bookValue, kind: "money" },
      { label: `Present value of excess returns after year ${n}`, value: presentTerminal, kind: "money" },
    ],
  };
}

export function grahamFormula(assumptions: Assumptions): ModelResult {
  const eps = assumptions.epsPerShare;
  if (eps === null || eps <= 0) {
    return missing("graham", "Needs positive earnings per share.");
  }
  const bondYield = rate(assumptions, "bondYield");
  if (bondYield <= 0) {
    return missing("graham", "Needs a bond yield above zero.");
  }

  const growth = Math.min(Math.max(rate(assumptions, "growthRate"), 0), GRAHAM_MAX_GROWTH);
  const multiple = (8.5 + 2 * growth * 100) * (4.4 / (bondYield * 100));

  return {
    id: "graham",
    ok: true,
    value: eps * multiple,
    steps: [
      { label: "Growth used (0–15%)", value: growth, kind: "percent" },
      { label: "Implied P/E (8.5 + 2g, rate-adjusted)", value: multiple, kind: "multiple" },
      { label: "Earnings per share", value: eps, kind: "money" },
    ],
  };
}

const MODEL_FUNCTIONS: Record<ModelId, (assumptions: Assumptions) => ModelResult> = {
  dcf: discountedCashFlow,
  earnings: earningsMultiple,
  revenue: revenueMargin,
  ddm: dividendDiscount,
  residualIncome,
  graham: grahamFormula,
};

export function runModel(id: ModelId, assumptions: Assumptions): ModelResult {
  return MODEL_FUNCTIONS[id](assumptions);
}

export function runAllModels(assumptions: Assumptions): Record<ModelId, ModelResult> {
  return Object.fromEntries(
    MODEL_ORDER.map((id) => [id, runModel(id, assumptions)]),
  ) as Record<ModelId, ModelResult>;
}

export type Scenario = "bear" | "base" | "bull";

const GROWTH_KEYS: AssumptionKey[] = ["growthRate", "revenueGrowth", "dividendGrowth"];

// Bear and bull cases move every forward-looking assumption against or in favour of the stock.
export function applyScenario(assumptions: Assumptions, scenario: Scenario): Assumptions {
  if (scenario === "base") return assumptions;
  const direction = scenario === "bull" ? 1 : -1;
  const next = { ...assumptions };
  const adjust = (key: AssumptionKey, change: (value: number) => number) => {
    const value = assumptions[key];
    if (value !== null) next[key] = clampAssumption(key, change(value));
  };

  for (const key of GROWTH_KEYS) {
    adjust(key, (value) => value + direction * Math.max(0.02, Math.abs(value) * 0.3));
  }
  adjust("discountRate", (value) => value - direction * 0.01);
  adjust("exitPe", (value) => value * (1 + direction * 0.2));
  adjust("targetNetMargin", (value) => value * (1 + direction * 0.2));
  adjust("returnOnEquity", (value) => value * (1 + direction * 0.15));
  return next;
}

export type ScenarioRange = Record<Scenario, number | null>;

export function scenarioRange(id: ModelId, assumptions: Assumptions): ScenarioRange {
  const valueFor = (scenario: Scenario) => {
    const result = runModel(id, applyScenario(assumptions, scenario));
    return result.ok ? result.value : null;
  };
  return { bear: valueFor("bear"), base: valueFor("base"), bull: valueFor("bull") };
}

// The FCF growth rate that makes the DCF equal today's price, found by bisection.
export function impliedGrowth(assumptions: Assumptions): number | null {
  const price = assumptions.currentPrice;
  if (price === null || price <= 0) return null;

  const valueAt = (growthRate: number) => {
    const result = discountedCashFlow({ ...assumptions, growthRate });
    return result.ok ? result.value : null;
  };

  let low = -0.5;
  let high = 1;
  const lowValue = valueAt(low);
  const highValue = valueAt(high);
  if (lowValue === null || highValue === null || price < lowValue || price > highValue) return null;

  for (let iteration = 0; iteration < 80; iteration++) {
    const middle = (low + high) / 2;
    const value = valueAt(middle);
    if (value === null) return null;
    if (value < price) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export type SensitivityGrid = {
  discountRates: number[];
  terminalGrowths: number[];
  values: (number | null)[][];
};

export function dcfSensitivity(assumptions: Assumptions): SensitivityGrid {
  const r = rate(assumptions, "discountRate");
  const g = rate(assumptions, "terminalGrowth");
  const discountRates = [-0.02, -0.01, 0, 0.01, 0.02].map((step) => r + step);
  const terminalGrowths = [-0.01, -0.005, 0, 0.005, 0.01].map((step) => g + step);

  return {
    discountRates,
    terminalGrowths,
    values: discountRates.map((discountRate) =>
      terminalGrowths.map((terminalGrowth) => {
        const result = discountedCashFlow({ ...assumptions, discountRate, terminalGrowth });
        return result.ok ? result.value : null;
      }),
    ),
  };
}

export type ProjectionRow = {
  year: number;
  revenuePerShare: number | null;
  epsPerShare: number | null;
  fcfPerShare: number | null;
  dividendPerShare: number | null;
};

export function projectionRows(assumptions: Assumptions): ProjectionRow[] {
  const n = years(assumptions);
  const grow = (base: number | null, growth: number, year: number) =>
    base === null ? null : base * (1 + growth) ** year;

  return Array.from({ length: n + 1 }, (_, year) => ({
    year,
    revenuePerShare: grow(assumptions.revenuePerShare, rate(assumptions, "revenueGrowth"), year),
    epsPerShare: grow(assumptions.epsPerShare, rate(assumptions, "growthRate"), year),
    fcfPerShare: grow(assumptions.fcfPerShare, rate(assumptions, "growthRate"), year),
    dividendPerShare: grow(assumptions.dividendPerShare, rate(assumptions, "dividendGrowth"), year),
  }));
}

export type Verdict = {
  upside: number;
  buyBelow: number;
  label: "Below buy price" | "Undervalued, thin margin" | "Above estimate";
};

export function verdict(value: number, assumptions: Assumptions): Verdict | null {
  const price = assumptions.currentPrice;
  if (price === null || price <= 0) return null;

  const buyBelow = value * (1 - rate(assumptions, "marginOfSafety"));
  return {
    upside: value / price - 1,
    buyBelow,
    label: price <= buyBelow ? "Below buy price" : price <= value ? "Undervalued, thin margin" : "Above estimate",
  };
}

// Recommended models count twice as much as secondary ones; unavailable models are skipped.
export function blendedValue(
  results: Record<ModelId, ModelResult>,
  primary: ModelId[],
  secondary: ModelId[],
): { value: number; used: ModelId[] } | null {
  let total = 0;
  let weight = 0;
  const used: ModelId[] = [];

  for (const [ids, modelWeight] of [[primary, 2], [secondary, 1]] as const) {
    for (const id of ids) {
      const result = results[id];
      if (!result.ok || result.value <= 0) continue;
      total += result.value * modelWeight;
      weight += modelWeight;
      used.push(id);
    }
  }
  return weight > 0 ? { value: total / weight, used } : null;
}
