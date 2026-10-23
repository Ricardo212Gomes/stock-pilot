import type { AnnualFinancialSummary, CompanyProfile } from "@/lib/fmp";
import {
  AI_FILLABLE_KEYS,
  ASSUMPTION_SPEC_BY_KEY,
  clampAssumption,
  type AssumptionKey,
  type Assumptions,
} from "./assumptions";
import { STOCK_TYPES, type Classification } from "./classify";

export type AutofillSuggestion = {
  value: number;
  rationale: string;
};

export type AutofillSuggestions = {
  summary: string;
  suggestions: Partial<Record<AssumptionKey, AutofillSuggestion>>;
};

const MAX_RATIONALE_LENGTH = 320;
const MAX_SUMMARY_LENGTH = 600;

export const AUTOFILL_INSTRUCTIONS = [
  "You are a careful equity valuation analyst helping a retail investor set assumptions for an intrinsic value calculator.",
  "Use only the supplied company data and widely accepted valuation practice. Do not invent news, guidance or facts that are not in the data.",
  "Be conservative: growth fades as companies mature, terminal growth stays at or below long-run nominal GDP growth (about 2-3%), and the discount rate must exceed terminal growth.",
  "Give every percentage as a decimal (0.08 means 8%). Years are whole numbers. Multiples are plain numbers.",
  "Keep every value inside its allowed range. Explain each choice in one or two plain sentences a beginner understands, referring to the data you used.",
  "Do not recommend buying or selling.",
].join(" ");

export const AUTOFILL_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    assumptions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          key: { type: "STRING", enum: AI_FILLABLE_KEYS },
          value: { type: "NUMBER" },
          rationale: { type: "STRING" },
        },
        required: ["key", "value", "rationale"],
      },
    },
  },
  required: ["summary", "assumptions"],
};

function rounded(value: number | null, digits = 4): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

export function buildAutofillPrompt({
  symbol,
  profile,
  financials,
  classification,
  defaults,
}: {
  symbol: string;
  profile: CompanyProfile | null;
  financials: AnnualFinancialSummary[];
  classification: Classification;
  defaults: Assumptions;
}): string {
  const history = financials.map((row) => ({
    fiscalYear: row.fiscalYear,
    currency: row.currency,
    revenue: row.revenue,
    revenueGrowth: rounded(row.revenueGrowth),
    netMargin: rounded(row.netMargin),
    eps: row.eps,
    freeCashFlow: row.freeCashFlow,
    dividendPerShare: row.dividendPerShare,
    returnOnEquity: row.netIncome !== null && row.equity ? rounded(row.netIncome / row.equity) : null,
    debtToEquity: rounded(row.debtToEquity),
    peRatio: rounded(row.peRatio, 2),
  }));

  const fields = AI_FILLABLE_KEYS.map((key) => {
    const spec = ASSUMPTION_SPEC_BY_KEY[key];
    return { key, label: spec.label, unit: spec.unit, min: spec.min, max: spec.max, meaning: spec.short, dataDefault: rounded(defaults[key]) };
  });

  const context = {
    symbol,
    company: profile?.companyName ?? null,
    sector: profile?.sector ?? null,
    industry: profile?.industry ?? null,
    beta: profile?.beta ?? null,
    stockType: STOCK_TYPES[classification.type].label,
    stockTypeReasons: classification.reasons,
    startingValuesPerShare: {
      price: rounded(defaults.currentPrice, 2),
      freeCashFlow: rounded(defaults.fcfPerShare, 2),
      eps: rounded(defaults.epsPerShare, 2),
      dividend: rounded(defaults.dividendPerShare, 2),
      bookValue: rounded(defaults.bookValuePerShare, 2),
      revenue: rounded(defaults.revenuePerShare, 2),
    },
    annualHistoryNewestFirst: history,
  };

  return [
    `Suggest valuation assumptions for ${symbol}. The "dataDefault" values were derived mechanically from the filings; improve on them where the data supports it.`,
    `Return one entry for each of these fields: ${JSON.stringify(fields)}`,
    `Company data: ${JSON.stringify(context)}`,
    "Also return a two or three sentence summary of the overall outlook your assumptions describe.",
  ].join("\n\n");
}

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

// Models sometimes answer "8" for 8%; rescale when only the decimal reading fits the range.
// Only numbers above 1 can be whole-number percentages: 0.6 already means 60%.
function normalizePercent(key: AssumptionKey, value: number): number {
  const spec = ASSUMPTION_SPEC_BY_KEY[key];
  if (spec.unit === "percent" && value > 1 && value > spec.max && value / 100 <= spec.max && value / 100 >= spec.min) {
    return value / 100;
  }
  return value;
}

export function parseAutofillResponse(text: string): AutofillSuggestions | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const record = payload as { summary?: unknown; assumptions?: unknown };
  if (!Array.isArray(record.assumptions)) return null;

  const suggestions: AutofillSuggestions["suggestions"] = {};
  for (const item of record.assumptions) {
    if (!item || typeof item !== "object") continue;
    const { key, value, rationale } = item as { key?: unknown; value?: unknown; rationale?: unknown };
    if (typeof key !== "string" || !(AI_FILLABLE_KEYS as string[]).includes(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    const assumptionKey = key as AssumptionKey;
    suggestions[assumptionKey] = {
      value: clampAssumption(assumptionKey, normalizePercent(assumptionKey, value)),
      rationale: cleanText(rationale, MAX_RATIONALE_LENGTH),
    };
  }

  // A terminal growth at or above the discount rate makes the perpetuity models undefined.
  const discount = suggestions.discountRate?.value;
  const terminal = suggestions.terminalGrowth?.value;
  if (discount !== undefined && terminal !== undefined && terminal >= discount) {
    delete suggestions.terminalGrowth;
  }

  if (Object.keys(suggestions).length === 0) return null;
  return { summary: cleanText(record.summary, MAX_SUMMARY_LENGTH), suggestions };
}
