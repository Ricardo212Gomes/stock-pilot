import type { StatementTable } from "./financial-statements";
import type { ProjectionInputs, ScenarioId, ScenarioInputs } from "./three-year-projection";

export type ThreeYearKey = `${ScenarioId}.${keyof ScenarioInputs}` | "sharesChange";

export const THREE_YEAR_KEYS: ThreeYearKey[] = [
  "low.revenueGrowth", "low.netMargin", "low.peRatio",
  "high.revenueGrowth", "high.netMargin", "high.peRatio",
  "sharesChange",
];

// Allowed ranges, with percentages as decimals.
export const THREE_YEAR_RANGES: Record<ThreeYearKey, [number, number]> = {
  "low.revenueGrowth": [-0.3, 1],
  "high.revenueGrowth": [-0.3, 1],
  "low.netMargin": [-0.5, 0.6],
  "high.netMargin": [-0.5, 0.6],
  "low.peRatio": [1, 150],
  "high.peRatio": [1, 150],
  sharesChange: [-0.1, 0.1],
};

const PERCENT_KEYS = new Set<ThreeYearKey>(THREE_YEAR_KEYS.filter((key) => !key.endsWith("peRatio")));

export type ThreeYearSuggestions = {
  summary: string;
  suggestions: Partial<Record<ThreeYearKey, { value: number; rationale: string }>>;
};

export const THREE_YEAR_INSTRUCTIONS = [
  "You are a careful equity analyst setting assumptions for a revenue × net margin × P/E projection of a stock's price.",
  "Give a low case and a high case that a reasonable investor could defend; the low case must not be above the high case.",
  "Use only the supplied company data and widely accepted practice. Do not invent news or guidance.",
  "Growth fades for large companies, margins rarely jump without a reason in the data, and P/E multiples usually shrink as growth slows.",
  "Give percentages as decimals (0.08 means 8%) and P/E as a plain number.",
  "Explain each value in one plain sentence that refers to the data. Do not recommend buying or selling.",
].join(" ");

export const THREE_YEAR_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    assumptions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          key: { type: "STRING", enum: THREE_YEAR_KEYS },
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

export function buildThreeYearPrompt({
  symbol,
  income,
  ratios,
  defaults,
}: {
  symbol: string;
  income: StatementTable;
  ratios: StatementTable | null;
  defaults: ProjectionInputs;
}): string {
  const history = {
    revenue: series(income, "revenue"),
    revenueGrowth: series(income, "revenueGrowth"),
    netMargin: series(income, "profitMargin"),
    dilutedShares: series(income, "shares"),
    peRatio: series(ratios, "pe"),
  };
  const fields = THREE_YEAR_KEYS.map((key) => {
    const [min, max] = THREE_YEAR_RANGES[key];
    const [scenario, field] = key.includes(".") ? key.split(".") as [ScenarioId, keyof ScenarioInputs] : [null, null];
    const dataDefault = scenario && field ? defaults[scenario][field] : defaults.sharesChange;
    return { key, min, max, dataDefault: Number(dataDefault.toFixed(4)) };
  });

  return [
    `Suggest ${defaults.years}-year projection assumptions for ${symbol}, currently priced at ${defaults.price ?? "unknown"} ${income.currency}.`,
    `Fields (the "dataDefault" values come mechanically from the filings; improve on them where the data supports it, for example when recent growth or margins differ from the long-run average): ${JSON.stringify(fields)}`,
    `Company history, newest first: ${JSON.stringify(history)}`,
    "Also return a two-sentence summary of the outlook your assumptions describe.",
  ].join("\n\n");
}

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

export function parseThreeYearResponse(text: string): ThreeYearSuggestions | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const record = payload as { summary?: unknown; assumptions?: unknown } | null;
  if (!record || !Array.isArray(record.assumptions)) return null;

  const suggestions: ThreeYearSuggestions["suggestions"] = {};
  for (const item of record.assumptions) {
    const { key, value, rationale } = (item ?? {}) as { key?: unknown; value?: unknown; rationale?: unknown };
    if (typeof key !== "string" || !(THREE_YEAR_KEYS as string[]).includes(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const typedKey = key as ThreeYearKey;
    const [min, max] = THREE_YEAR_RANGES[typedKey];
    // "8" for 8%: only numbers above 1 can be whole-number percentages; 0.9 already means 90%.
    const scaled = PERCENT_KEYS.has(typedKey) && value > 1 && value > max && value / 100 <= max ? value / 100 : value;
    suggestions[typedKey] = { value: Math.min(max, Math.max(min, scaled)), rationale: cleanText(rationale, 320) };
  }

  // Keep each low case at or below its high case.
  for (const field of ["revenueGrowth", "netMargin", "peRatio"] as const) {
    const low = suggestions[`low.${field}`];
    const high = suggestions[`high.${field}`];
    if (low && high && low.value > high.value) {
      [suggestions[`low.${field}`], suggestions[`high.${field}`]] = [
        { ...low, value: high.value },
        { ...high, value: low.value },
      ];
    }
  }

  if (Object.keys(suggestions).length === 0) return null;
  return { summary: cleanText(record.summary, 600), suggestions };
}
