import type { StatementTable } from "./financial-statements";
import { SCENARIOS, type ProjectionDefaults, type ScenarioId, type ScenarioInputs } from "./three-year-projection";

export type ThreeYearKey = `${ScenarioId}.${keyof ScenarioInputs}`;

const FIELDS: (keyof ScenarioInputs)[] = ["revenueGrowth", "netIncomeGrowth", "peLow", "peHigh"];

export const THREE_YEAR_KEYS: ThreeYearKey[] = SCENARIOS.flatMap(({ id }) => FIELDS.map((field) => `${id}.${field}` as ThreeYearKey));

// Allowed ranges per field, with percentages as decimals.
const FIELD_RANGES: Record<keyof ScenarioInputs, [number, number]> = {
  revenueGrowth: [-0.5, 1],
  netIncomeGrowth: [-0.6, 1.5],
  peLow: [1, 150],
  peHigh: [1, 150],
};

export function threeYearRange(key: ThreeYearKey): [number, number] {
  return FIELD_RANGES[key.split(".")[1] as keyof ScenarioInputs];
}

export type ThreeYearSuggestions = {
  summary: string;
  suggestions: Partial<Record<ThreeYearKey, { value: number; rationale: string }>>;
};

export const THREE_YEAR_INSTRUCTIONS = [
  "You are a careful equity analyst filling in a five-scenario stock projection template.",
  "From the last fiscal year, revenue and net income each grow at a yearly rate for five years, and the price is EPS times a low and a high P/E.",
  "Give ultra bearish, bearish, neutral, bullish and ultra bullish cases that a reasonable investor could defend. Each case must be at least as optimistic as the one before, and each low P/E must not be above its high P/E.",
  "Use only the supplied company data and widely accepted practice. Do not invent news or guidance.",
  "Growth fades for large companies, net income growing much faster than revenue keeps widening the margin and needs a reason in the data, and P/E multiples usually shrink as growth slows.",
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
  defaults: ProjectionDefaults;
}): string {
  const history = {
    revenue: series(income, "revenue"),
    revenueGrowth: series(income, "revenueGrowth"),
    netIncome: series(income, "netIncome"),
    netIncomeGrowth: series(income, "netIncomeGrowth"),
    netMargin: series(income, "profitMargin"),
    peRatio: series(ratios, "pe"),
  };
  const fields = THREE_YEAR_KEYS.map((key) => {
    const [min, max] = threeYearRange(key);
    const [scenario, field] = key.split(".") as [ScenarioId, keyof ScenarioInputs];
    return { key, min, max, dataDefault: Number(defaults.inputs.scenarios[scenario][field].toFixed(4)) };
  });

  return [
    `Suggest projection assumptions for ${symbol} for fiscal years ${defaults.baseYear + 1} to ${defaults.baseYear + 5}, starting from fiscal ${defaults.baseYear}. It is currently priced at ${defaults.inputs.price ?? "unknown"} ${income.currency}.`,
    `Fields (the "dataDefault" values come mechanically from the historical averages; improve on them where the data supports it, for example when recent growth differs from the average): ${JSON.stringify(fields)}`,
    `Company history, newest first: ${JSON.stringify(history)}`,
    "Also return a two-sentence summary of the range of outcomes your scenarios describe.",
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
    const [min, max] = threeYearRange(typedKey);
    // "8" for 8%: only numbers above 1 can be whole-number percentages; 0.9 already means 90%.
    const isPercent = !typedKey.includes(".pe");
    const scaled = isPercent && value > 1 && value > max && value / 100 <= max ? value / 100 : value;
    suggestions[typedKey] = { value: Math.min(max, Math.max(min, scaled)), rationale: cleanText(rationale, 320) };
  }

  // Keep each low P/E at or below its high P/E.
  for (const { id } of SCENARIOS) {
    const low = suggestions[`${id}.peLow`];
    const high = suggestions[`${id}.peHigh`];
    if (low && high && low.value > high.value) {
      [suggestions[`${id}.peLow`], suggestions[`${id}.peHigh`]] = [{ ...low, value: high.value }, { ...high, value: low.value }];
    }
  }

  // Keep the scenarios in order, from ultra bearish up: sort each field's values across them.
  for (const field of FIELDS) {
    const keys = SCENARIOS.map(({ id }) => `${id}.${field}` as ThreeYearKey).filter((key) => suggestions[key]);
    const sorted = keys.map((key) => suggestions[key]!).sort((left, right) => left.value - right.value);
    keys.forEach((key, index) => { suggestions[key] = sorted[index]; });
  }

  if (Object.keys(suggestions).length === 0) return null;
  return { summary: cleanText(record.summary, 600), suggestions };
}
