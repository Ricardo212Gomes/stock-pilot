import {
  INPUT_FIELDS,
  PROJECTION_YEARS,
  SCENARIOS,
  hasCostOfRevenue,
  netIncomeRatio,
  type InputField,
  type ProjectionDefaults,
  type ScenarioId,
  type ScenarioInputs,
} from "./plumas-projection";

export type ProjectionSuggestions = {
  summary: string;
  scenarios: Partial<Record<ScenarioId, { inputs: Partial<ScenarioInputs>; rationale: string }>>;
};

// Allowed ranges per field, with rates as decimals.
export const PROJECTION_AI_RANGES: Record<InputField, [number, number]> = {
  revenueGrowth: [-0.5, 1],
  netIncomeGrowth: [-0.8, 2],
  costGrowth: [-0.5, 1],
  opexGrowth: [-0.5, 1],
  otherGrowth: [-1, 1],
  buybackYield: [-0.1, 0.1],
  peLow: [1, 150],
  peMid: [1, 150],
  peHigh: [1, 150],
};

const SCENARIO_IDS = SCENARIOS.map(({ id }) => id);

export const PROJECTION_AI_INSTRUCTIONS = [
  "You are a careful equity analyst filling in a five-year financial projection in five scenarios: ultraBearish, bearish, base, bullish and ultraBullish.",
  "Every field takes one value per projected year.",
  "The simple model grows revenue by revenueGrowth and net income by netIncomeGrowth, on today's share count.",
  "The advanced model grows cost of revenue by costGrowth, operating expenses by opexGrowth and interest & other (pretax minus operating income) by otherGrowth;",
  "operating income is revenue minus both, and net income keeps the last year's ratio to pretax income.",
  "Its share count falls each year by buybackYield (negative means dilution).",
  "The price is EPS times peLow, peMid and peHigh.",
  "Scenarios run from the worst a reasonable investor could defend to the best, and in each year peLow ≤ peMid ≤ peHigh.",
  "Use only the supplied company data and widely accepted practice. Do not invent news or guidance.",
  "Base the values on this company's own trend, with the latest years weighing most, and spread the scenarios widely enough to show real risk and upside.",
  "Today's share count already includes the part of the first projected year that has passed, so its buyback yield only covers the months still ahead.",
  "Where analysts' consensus is given, keep the base case near it for the years it covers unless the history argues otherwise.",
  "Growth usually fades for large companies, margins only widen with a reason in the data, and P/E multiples usually shrink as growth slows.",
  "If the company reports no cost of revenue, set costGrowth equal to revenueGrowth.",
  "Give rates as decimals (0.08 means 8%) and P/E as a plain number.",
  "Explain each scenario in one or two plain sentences that refer to the data. Do not recommend buying or selling.",
].join(" ");

const yearly = { type: "ARRAY", items: { type: "NUMBER" }, minItems: PROJECTION_YEARS, maxItems: PROJECTION_YEARS };

export const PROJECTION_AI_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    scenarios: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", enum: SCENARIO_IDS },
          rationale: { type: "STRING" },
          ...Object.fromEntries(INPUT_FIELDS.map((field) => [field, yearly])),
        },
        required: ["id", "rationale", ...INPUT_FIELDS],
      },
    },
  },
  required: ["summary", "scenarios"],
};

function rounded(value: number | null, digits: number): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

export function buildProjectionPrompt({ symbol, defaults }: { symbol: string; defaults: ProjectionDefaults }): string {
  const { base, start, history, years, ttmEps, currency } = defaults;
  const company = {
    lastFiscalYear: base.year,
    projectedYears: years,
    price: start.price,
    sharesOutstandingToday: start.shares,
    peTtm: start.price !== null && ttmEps !== null && ttmEps > 0 ? rounded(start.price / ttmEps, 1) : null,
    reportsCostOfRevenue: hasCostOfRevenue(base),
    netIncomeToPretaxRatio: rounded(netIncomeRatio(base).value, 4),
    monthsOfFirstYearAhead: Math.round(defaults.firstYearAhead * 12),
  };
  const reported = history.map((year) => ({
    year: year.year,
    revenue: rounded(year.revenue, 0),
    revenueGrowth: rounded(year.revenueGrowth, 4),
    costOfRevenue: rounded(year.costOfRevenue, 0),
    grossMargin: rounded(year.grossMargin, 4),
    operatingExpenses: rounded(year.operatingExpenses, 0),
    operatingMargin: rounded(year.operatingMargin, 4),
    interestAndOther: rounded(year.other, 0),
    netIncome: rounded(year.netIncome, 0),
    netIncomeGrowth: rounded(year.netIncomeGrowth, 4),
    netMargin: rounded(year.netMargin, 4),
    dilutedShares: rounded(year.shares, 0),
    buybackYield: rounded(year.buybackYield, 4),
    eps: rounded(year.eps, 2),
    pe: rounded(year.pe, 1),
  }));

  const consensus = years.flatMap((year, index) => {
    const estimate = defaults.estimates[index];
    return estimate ? [{
      year,
      revenue: rounded(estimate.revenue.avg, 0),
      netIncome: rounded(estimate.netIncome.avg, 0),
      eps: rounded(estimate.eps.avg, 2),
      analysts: estimate.analysts,
    }] : [];
  });

  return [
    `Fill in the projection for ${symbol}: fiscal years ${years[0]} to ${years[years.length - 1]}, starting from fiscal ${base.year}. Figures are in ${currency}.`,
    `Company: ${JSON.stringify(company)}`,
    `Reported history, oldest first: ${JSON.stringify(reported)}`,
    consensus.length ? `Analysts' consensus (averages): ${JSON.stringify(consensus)}` : "There are no analysts' estimates for these years.",
    "Return all five scenarios with five values per field, and a two-sentence summary of the range of outcomes they describe.",
  ].join("\n\n");
}

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function readField(field: InputField, raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const [min, max] = PROJECTION_AI_RANGES[field];
  const isRate = !field.startsWith("pe");
  const values = raw
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .slice(0, PROJECTION_YEARS)
    .map((value) => {
      // "8" for 8%: only numbers beyond ±1 can be whole-number percentages; 0.9 already means 90%.
      const percent = isRate && Math.abs(value) > 1 && (value > max || value < min) && value / 100 >= min && value / 100 <= max;
      const clamped = Math.min(max, Math.max(min, percent ? value / 100 : value));
      // Rates to a tenth of a point and multiples to a tenth, as typed in the table.
      return isRate ? Math.round(clamped * 1000) / 1000 : Math.round(clamped * 10) / 10;
    });
  if (values.length === 0) return null;
  while (values.length < PROJECTION_YEARS) values.push(values[values.length - 1]);
  return values;
}

export function parseProjectionResponse(text: string): ProjectionSuggestions | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const record = payload as { summary?: unknown; scenarios?: unknown } | null;
  if (!record || !Array.isArray(record.scenarios)) return null;

  const scenarios: ProjectionSuggestions["scenarios"] = {};
  for (const item of record.scenarios) {
    const entry = (item ?? {}) as Record<string, unknown>;
    if (typeof entry.id !== "string" || !(SCENARIO_IDS as string[]).includes(entry.id)) continue;
    const inputs: Partial<ScenarioInputs> = {};
    for (const field of INPUT_FIELDS) {
      const values = readField(field, entry[field]);
      if (values) inputs[field] = values;
    }
    // Keep each year's P/E in order: low, mid, high.
    const multiples = (["peLow", "peMid", "peHigh"] as const).filter((field) => inputs[field]);
    for (let index = 0; index < PROJECTION_YEARS; index++) {
      const sorted = multiples.map((field) => inputs[field]![index]).sort((left, right) => left - right);
      multiples.forEach((field, position) => { inputs[field]![index] = sorted[position]; });
    }
    if (Object.keys(inputs).length === 0) continue;
    scenarios[entry.id as ScenarioId] = { inputs, rationale: cleanText(entry.rationale, 400) };
  }

  if (Object.keys(scenarios).length === 0) return null;
  return { summary: cleanText(record.summary, 600), scenarios };
}
