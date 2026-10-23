import type { StatementTable } from "./financial-statements";
import type { DcfInputs } from "./simple-dcf";

export type DcfAiKey = "growthEarly" | "growthLate" | "discountRate" | "terminalGrowth" | "terminalMultiple";

export const DCF_AI_KEYS: DcfAiKey[] = ["growthEarly", "growthLate", "discountRate", "terminalGrowth", "terminalMultiple"];

// Allowed ranges, with percentages as decimals.
export const DCF_AI_RANGES: Record<DcfAiKey, [number, number]> = {
  growthEarly: [-0.2, 0.5],
  growthLate: [-0.1, 0.3],
  discountRate: [0.05, 0.2],
  terminalGrowth: [0, 0.04],
  terminalMultiple: [5, 40],
};

export type DcfSuggestions = {
  summary: string;
  suggestions: Partial<Record<DcfAiKey, { value: number; rationale: string }>>;
};

export const DCF_AI_INSTRUCTIONS = [
  "You are a careful equity analyst setting assumptions for a two-stage discounted cash flow model of a company's free cash flow.",
  "Free cash flow grows at one rate in years 1-5 and another in years 6-10, then a terminal value is added.",
  "Use only the supplied company data and widely accepted practice. Do not invent news or guidance.",
  "Growth usually fades in the second stage, terminal growth stays at or below long-run nominal GDP growth (2-3%),",
  "the discount rate reflects the company's risk (about 8-12% for most large companies) and must exceed terminal growth,",
  "and the terminal free cash flow multiple fits a mature version of the business.",
  "Give percentages as decimals (0.08 means 8%) and the multiple as a plain number.",
  "Explain each value in one plain sentence that refers to the data. Do not recommend buying or selling.",
].join(" ");

export const DCF_AI_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    assumptions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          key: { type: "STRING", enum: DCF_AI_KEYS },
          value: { type: "NUMBER" },
          rationale: { type: "STRING" },
        },
        required: ["key", "value", "rationale"],
      },
    },
  },
  required: ["summary", "assumptions"],
};

function series(table: StatementTable | null, id: string) {
  const row = table?.rows.find((candidate) => candidate.id === id);
  return row ? table!.columns.map((column, index) => [column.label, row.values[index]] as const) : [];
}

export function buildDcfPrompt({
  symbol,
  income,
  cashFlow,
  defaults,
}: {
  symbol: string;
  income: StatementTable;
  cashFlow: StatementTable | null;
  defaults: DcfInputs;
}): string {
  const history = {
    revenue: series(income, "revenue"),
    revenueGrowth: series(income, "revenueGrowth"),
    netMargin: series(income, "profitMargin"),
    freeCashFlow: series(cashFlow, "freeCashFlow"),
    freeCashFlowGrowth: series(cashFlow, "freeCashFlowGrowth"),
    freeCashFlowMargin: series(cashFlow, "freeCashFlowMargin"),
  };
  const fields = DCF_AI_KEYS.map((key) => {
    const [min, max] = DCF_AI_RANGES[key];
    return { key, min, max, dataDefault: Number(defaults[key].toFixed(4)) };
  });
  return [
    `Suggest DCF assumptions for ${symbol}, currently priced at ${defaults.price ?? "unknown"} ${income.currency}.`,
    `Fields (the "dataDefault" values are mechanical starting points; improve on them where the data supports it): ${JSON.stringify(fields)}`,
    `Company history, newest first: ${JSON.stringify(history)}`,
    "Also return a two-sentence summary of the outlook your assumptions describe.",
  ].join("\n\n");
}

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

export function parseDcfResponse(text: string): DcfSuggestions | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const record = payload as { summary?: unknown; assumptions?: unknown } | null;
  if (!record || !Array.isArray(record.assumptions)) return null;

  const suggestions: DcfSuggestions["suggestions"] = {};
  for (const item of record.assumptions) {
    const { key, value, rationale } = (item ?? {}) as { key?: unknown; value?: unknown; rationale?: unknown };
    if (typeof key !== "string" || !(DCF_AI_KEYS as string[]).includes(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const typedKey = key as DcfAiKey;
    const [min, max] = DCF_AI_RANGES[typedKey];
    // "10" for 10%: only numbers above 1 can be whole-number percentages; 0.9 already means 90%.
    const scaled = typedKey !== "terminalMultiple" && value > 1 && value > max && value / 100 <= max ? value / 100 : value;
    suggestions[typedKey] = { value: Math.min(max, Math.max(min, scaled)), rationale: cleanText(rationale, 320) };
  }

  // A terminal growth at or above the discount rate makes the perpetuity infinite.
  const discount = suggestions.discountRate?.value;
  const terminal = suggestions.terminalGrowth?.value;
  if (discount !== undefined && terminal !== undefined && terminal >= discount) delete suggestions.terminalGrowth;

  if (Object.keys(suggestions).length === 0) return null;
  return { summary: cleanText(record.summary, 600), suggestions };
}
