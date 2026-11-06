import type { AnnualFinancialSummary, CompanyProfile } from "@/lib/fmp";
import type { ModelId } from "./models";

export type StockType =
  | "financial"
  | "reit"
  | "unprofitable"
  | "cyclical"
  | "highGrowth"
  | "dividend"
  | "stable";

export type StockTypeInfo = {
  label: string;
  description: string;
  primary: ModelId[];
  secondary: ModelId[];
  whyModels: string;
};

export const STOCK_TYPES: Record<StockType, StockTypeInfo> = {
  financial: {
    label: "Bank or financial",
    description: "Banks, insurers and lenders. Debt is their raw material rather than a financing choice, so free cash flow says little about their value.",
    primary: ["residualIncome"],
    secondary: ["ddm", "earnings"],
    whyModels: "Residual income values financials on book value and the return they earn on it, which is how analysts value banks. Dividends and earnings are cross-checks.",
  },
  reit: {
    label: "Real estate (REIT)",
    description: "REITs must pay out most of their income, so dividends are the main return. Heavy depreciation makes reported earnings look smaller than the cash they produce.",
    primary: ["ddm"],
    secondary: ["dcf"],
    whyModels: "The dividend discount model fits companies that pay out most of what they earn. Analysts also use FFO (earnings plus real estate depreciation) multiples, which this page does not calculate yet.",
  },
  unprofitable: {
    label: "Unprofitable or early-stage",
    description: "Losing money today, so earnings-based models cannot work yet. The value depends on how large the company becomes and what margin it eventually earns.",
    primary: ["revenue"],
    secondary: ["dcf"],
    whyModels: "The revenue model projects sales and a mature margin. Check the reverse DCF to see what growth today's price already assumes.",
  },
  cyclical: {
    label: "Cyclical",
    description: "Profits swing with the economy or commodity prices. Valuing a single peak or trough year gives misleading results.",
    primary: ["dcf"],
    secondary: ["earnings", "graham"],
    whyModels: "The DCF here starts from average free cash flow across the cycle rather than the latest year. Keep growth and exit multiples conservative.",
  },
  highGrowth: {
    label: "High growth",
    description: "Revenue growing quickly. Most of the value lies years ahead, so growth and the multiple at maturity drive the answer.",
    primary: ["earnings", "dcf"],
    secondary: ["revenue"],
    whyModels: "The earnings model captures growth and an exit multiple once growth slows; the DCF checks it against cash flow. Use the reverse DCF to test whether the price assumes too much.",
  },
  dividend: {
    label: "Dividend payer",
    description: "A mature company returning a meaningful share of profit as dividends, with modest growth.",
    primary: ["ddm", "dcf"],
    secondary: ["graham"],
    whyModels: "The dividend discount model values the income stream directly; the DCF covers the cash the company keeps. Graham's formula is a quick sanity check.",
  },
  stable: {
    label: "Stable compounder",
    description: "A profitable, established business with steady growth and positive cash flow.",
    primary: ["dcf"],
    secondary: ["earnings", "graham"],
    whyModels: "The DCF is the most complete model for predictable cash generators. The earnings model and Graham's formula are cross-checks.",
  },
};

export type Classification = {
  type: StockType;
  reasons: string[];
};

// The yearly figures the classifier reads, newest first.
export type ClassifierYear = Pick<AnnualFinancialSummary, "fiscalYear" | "revenue" | "netIncome" | "eps" | "dividendYield">;

const FINANCIAL_INDUSTRY = /bank|insurance|credit|capital markets|asset management|mortgage|financial/i;
const REIT_INDUSTRY = /reit|real estate/i;
const CYCLICAL_SECTORS = new Set(["Energy", "Basic Materials"]);
const CYCLICAL_INDUSTRY = /oil|gas|steel|mining|chemical|auto|airline|semiconductor equipment|homebuilding|shipping/i;

const HIGH_GROWTH_THRESHOLD = 0.15;
const DIVIDEND_YIELD_THRESHOLD = 0.025;
const CYCLICAL_VARIATION_THRESHOLD = 0.5;

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// Compound annual growth between the oldest and newest positive values (rows newest first).
export function compoundGrowth(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length < 2) return null;
  const latest = present[0];
  const oldest = present[present.length - 1];
  if (latest <= 0 || oldest <= 0) return null;
  return (latest / oldest) ** (1 / (present.length - 1)) - 1;
}

// Coefficient of variation: how much a series swings relative to its average.
function variation(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length < 3) return null;
  const mean = present.reduce((sum, value) => sum + value, 0) / present.length;
  if (mean <= 0) return null;
  const variance = present.reduce((sum, value) => sum + (value - mean) ** 2, 0) / present.length;
  return Math.sqrt(variance) / mean;
}

export function classifyStock(
  financials: ClassifierYear[],
  profile: Pick<CompanyProfile, "sector" | "industry"> | null,
): Classification {
  const latest = financials[0];
  const sector = profile?.sector ?? "";
  const industry = profile?.industry ?? "";

  if (sector === "Financial Services" && FINANCIAL_INDUSTRY.test(industry)) {
    return { type: "financial", reasons: [`Industry: ${industry}.`] };
  }
  if (sector === "Real Estate" && REIT_INDUSTRY.test(industry)) {
    return { type: "reit", reasons: [`Industry: ${industry}.`] };
  }

  if (latest && ((latest.netIncome !== null && latest.netIncome <= 0) || (latest.eps !== null && latest.eps <= 0))) {
    return { type: "unprofitable", reasons: [`Net income was not positive in fiscal ${latest.fiscalYear}.`] };
  }

  if (CYCLICAL_SECTORS.has(sector) || CYCLICAL_INDUSTRY.test(industry)) {
    return { type: "cyclical", reasons: [`${sector || industry} businesses move with the economic or commodity cycle.`] };
  }

  // Checked before earnings swings: fast growth also makes earnings vary a lot, but not cyclically.
  const revenueGrowth = compoundGrowth(financials.map((row) => row.revenue));
  if (revenueGrowth !== null && revenueGrowth >= HIGH_GROWTH_THRESHOLD) {
    return { type: "highGrowth", reasons: [`Revenue grew about ${percent(revenueGrowth)} a year across the years shown.`] };
  }

  const incomeSwing = variation(financials.map((row) => row.netIncome));
  if (incomeSwing !== null && incomeSwing > CYCLICAL_VARIATION_THRESHOLD) {
    return { type: "cyclical", reasons: [`Net income swung by about ${percent(incomeSwing)} of its average across the years shown.`] };
  }

  const dividendYield = latest?.dividendYield ?? null;
  if (dividendYield !== null && dividendYield >= DIVIDEND_YIELD_THRESHOLD) {
    return { type: "dividend", reasons: [`Dividend yield of ${percent(dividendYield)} in fiscal ${latest.fiscalYear}.`] };
  }

  const reasons = ["Profitable, without unusual swings in earnings."];
  if (revenueGrowth !== null) reasons.push(`Revenue grew about ${percent(revenueGrowth)} a year.`);
  return { type: "stable", reasons };
}
