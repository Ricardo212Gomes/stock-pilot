// What a saved projection keeps for each valuation tool (see docs/valuation.md, "Saved projections"), and how an
// older save is brought up to date. Pure TypeScript, shared by the server and the browser.
import { ASSUMPTION_SPECS, type AssumptionKey, type Assumptions } from "./valuation/assumptions";
import type { DcfOptions, FcfBasis } from "./valuation/dcf";
import {
  INPUT_FIELDS,
  PROJECTION_YEARS,
  SCENARIOS,
  type BaseYear,
  type ProjectionMode,
  type ScenarioCount,
  type ScenarioId,
  type ScenarioInputs,
} from "./plumas-projection";
import { CASES, CASE_FIELDS, JEREMY_YEARS, type CaseId, type CaseInputs } from "./jeremy-projection";

export const SAVED_TOOLS = ["intrinsic-value", "jeremy-projection", "plumas-projection"] as const;
export type SavedTool = (typeof SAVED_TOOLS)[number];

export function isSavedTool(value: unknown): value is SavedTool {
  return typeof value === "string" && (SAVED_TOOLS as readonly string[]).includes(value);
}

// Short names for the default save name, e.g. "NVDA · Plumas · 14 Nov 2026".
export const TOOL_SHORT_NAME: Record<SavedTool, string> = {
  "intrinsic-value": "Intrinsic Value",
  "jeremy-projection": "Jeremy",
  "plumas-projection": "Plumas",
};

export function defaultSaveName(symbol: string, tool: SavedTool, date = new Date()): string {
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
  return `${symbol} · ${TOOL_SHORT_NAME[tool]} · ${day}`;
}

// The value per share at the time of saving: the blended value, or each scenario's.
export type SavedValue = { id: string; label: string; value: number | null };

// The figure a save is compared with today's price by: the blended value or the base scenario.
export function headlineValue(values: SavedValue[]): SavedValue | null {
  return values.find(({ id }) => id === "blended" || id === "base") ?? values.find(({ value }) => value !== null) ?? null;
}

// How far the saved value sits above (+) or below (−) a price.
export function valueGap(value: number | null, price: number | null): number | null {
  if (value === null || price === null || price <= 0) return null;
  return value / price - 1;
}

export type SavedSort = "date" | "gap";
export type SavedOrder = "asc" | "desc";

// For the All saved page: by when each was saved, or by its gap. A row without a gap goes last either way.
export function sortSaved<T extends { gap: number | null; updatedAt: string }>(rows: T[], sort: SavedSort, order: SavedOrder): T[] {
  const sign = order === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort === "gap") {
      if (left.gap === null || right.gap === null) return left.gap === null ? (right.gap === null ? 0 : 1) : -1;
      return sign * (left.gap - right.gap);
    }
    return sign * (Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
  });
}

// ---- Each tool's inputs -------------------------------------------------------------------------------------------

export type IntrinsicValueInputs = {
  // A null currentPrice means today's price: only a price typed over the quote is kept.
  assumptions: Partial<Assumptions>;
  sources: Partial<Record<AssumptionKey, "data" | "analysts" | "ai" | "edited">>;
  dcfOptions: DcfOptions;
  fcfBasis: { basis: FcfBasis; stockCompAsCost: boolean } | null;
  aiNotes: Partial<Record<AssumptionKey, string>>;
  aiSummary: string | null;
};

export type JeremyInputs = {
  cases: Record<CaseId, CaseInputs>;
  // The first column's fiscal year and its figures, so the save opens the same after a new report.
  start: { year: number; revenue: number | null; netIncome: number | null; shares: number | null };
  entryPrice: number | null;
};

export type PlumasInputs = {
  scenarios: Record<ScenarioId, ScenarioInputs>;
  ai: { summary: string; rationale: Partial<Record<ScenarioId, string>> } | null;
  view: { mode: ProjectionMode; count: ScenarioCount };
  // The fiscal year the projection grows from, with its figures.
  base: BaseYear;
  // A null price means today's price.
  start: { price: number | null; shares: number | null };
};

export type ToolInputs = {
  "intrinsic-value": IntrinsicValueInputs;
  "jeremy-projection": JeremyInputs;
  "plumas-projection": PlumasInputs;
};

// ---- Versions and migrations --------------------------------------------------------------------------------------

// Raise a tool's version whenever the shape of its inputs changes, and add the step from the old version below.
export const SCHEMA_VERSIONS: Record<SavedTool, number> = {
  "intrinsic-value": 1,
  "jeremy-projection": 1,
  "plumas-projection": 1,
};

type Raw = Record<string, unknown>;
// Upgrades inputs saved at one version to the next, naming anything that no longer exists.
export type MigrationStep = (inputs: Raw) => { inputs: Raw; dropped: string[] };

// MIGRATIONS[tool][n] turns version n into n + 1. Every tool is at version 1, the first saved shape.
export const MIGRATIONS: Record<SavedTool, Record<number, MigrationStep>> = {
  "intrinsic-value": {},
  "jeremy-projection": {},
  "plumas-projection": {},
};

export type Migrated = { ok: true; inputs: Raw; dropped: string[] } | { ok: false; reason: string };

export function migrateInputs(
  tool: SavedTool,
  version: number,
  inputs: unknown,
  steps: Record<number, MigrationStep> = MIGRATIONS[tool],
  current: number = SCHEMA_VERSIONS[tool],
): Migrated {
  if (!isRecord(inputs)) return { ok: false, reason: "This saved projection has no inputs." };
  if (!Number.isInteger(version) || version < 1) return { ok: false, reason: "This saved projection's version isn't known." };
  if (version > current) return { ok: false, reason: "This projection was saved by a newer version of StockPilot. Reload the page." };
  let next: Raw = inputs;
  const dropped: string[] = [];
  for (let at = version; at < current; at += 1) {
    const step = steps[at];
    if (!step) return { ok: false, reason: `There's no way to open a projection saved at version ${at}.` };
    const result = step(next);
    next = result.inputs;
    dropped.push(...result.dropped);
  }
  return { ok: true, inputs: next, dropped };
}

// ---- Reading saved inputs back ------------------------------------------------------------------------------------
// Each reader takes the migrated inputs (and, for the projections, the tool's starting values). Anything unreadable falls back to the
// starting value, and anything the tool no longer has is left out; both are named in `dropped`.

export type Restored<T> = { inputs: T; dropped: string[] };

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrNull(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isYearly(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(isNumber);
}

// "revenueGrowth" → "revenue growth"
export function humanize(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

function unknownKeys(value: Raw, known: readonly string[], prefix: string, dropped: string[]) {
  for (const key of Object.keys(value)) if (!known.includes(key)) dropped.push(`${prefix}${humanize(key)}`);
}

const ASSUMPTION_KEYS = ASSUMPTION_SPECS.map(({ key }) => key);
const ASSUMPTION_LABEL = Object.fromEntries(ASSUMPTION_SPECS.map(({ key, label }) => [key, label])) as Record<AssumptionKey, string>;
const SOURCES = ["data", "analysts", "ai", "edited"] as const;

export function restoreIntrinsicValue(raw: Raw): Restored<IntrinsicValueInputs> {
  const dropped: string[] = [];
  unknownKeys(raw, ["assumptions", "sources", "dcfOptions", "fcfBasis", "aiNotes", "aiSummary"], "", dropped);

  const assumptions: Partial<Assumptions> = {};
  const savedAssumptions = isRecord(raw.assumptions) ? raw.assumptions : {};
  unknownKeys(savedAssumptions, ASSUMPTION_KEYS, "", dropped);
  for (const key of ASSUMPTION_KEYS) {
    if (!(key in savedAssumptions)) continue;
    const value = savedAssumptions[key];
    if (numberOrNull(value)) assumptions[key] = value;
    else dropped.push(ASSUMPTION_LABEL[key]);
  }

  const sources: IntrinsicValueInputs["sources"] = {};
  const savedSources = isRecord(raw.sources) ? raw.sources : {};
  for (const key of ASSUMPTION_KEYS) {
    const source = savedSources[key];
    if (typeof source === "string" && (SOURCES as readonly string[]).includes(source)) sources[key] = source as (typeof SOURCES)[number];
  }

  const options = isRecord(raw.dcfOptions) ? raw.dcfOptions : {};
  const dcfOptions: DcfOptions = {
    firstYearFcf: numberOrNull(options.firstYearFcf) ? options.firstYearFcf : null,
    terminalMethod: options.terminalMethod === "multiple" ? "multiple" : "growth",
  };
  if (isRecord(raw.dcfOptions)) unknownKeys(raw.dcfOptions, ["firstYearFcf", "terminalMethod"], "DCF ", dropped);

  const basis = isRecord(raw.fcfBasis) ? raw.fcfBasis : null;
  const fcfBasis = basis && (basis.basis === "reported" || basis.basis === "smoothed") && typeof basis.stockCompAsCost === "boolean"
    ? { basis: basis.basis as FcfBasis, stockCompAsCost: basis.stockCompAsCost }
    : null;

  const aiNotes: IntrinsicValueInputs["aiNotes"] = {};
  if (isRecord(raw.aiNotes)) {
    for (const key of ASSUMPTION_KEYS) if (typeof raw.aiNotes[key] === "string") aiNotes[key] = raw.aiNotes[key] as string;
  }

  // An assumption that wasn't kept starts from the filings again, so it loses its saved source too.
  for (const key of ASSUMPTION_KEYS) if (!(key in assumptions)) delete sources[key];
  return {
    inputs: { assumptions, sources, dcfOptions, fcfBasis, aiNotes, aiSummary: typeof raw.aiSummary === "string" ? raw.aiSummary : null },
    dropped,
  };
}

export function restoreJeremy(raw: Raw, fallback: { cases: Record<CaseId, CaseInputs>; start: JeremyInputs["start"] }): Restored<JeremyInputs> {
  const dropped: string[] = [];
  unknownKeys(raw, ["cases", "start", "entryPrice"], "", dropped);
  const savedCases = isRecord(raw.cases) ? raw.cases : {};
  unknownKeys(savedCases, CASES.map(({ id }) => id), "", dropped);

  const cases = {} as Record<CaseId, CaseInputs>;
  for (const { id, label } of CASES) {
    const saved = isRecord(savedCases[id]) ? savedCases[id] : {};
    unknownKeys(saved, CASE_FIELDS, `${label} `, dropped);
    cases[id] = Object.fromEntries(CASE_FIELDS.map((field) => {
      if (isYearly(saved[field], JEREMY_YEARS)) return [field, saved[field]];
      dropped.push(`${label} ${humanize(field)}`);
      return [field, fallback.cases[id][field]];
    })) as CaseInputs;
  }

  const start = isRecord(raw.start) ? raw.start : null;
  let restoredStart = fallback.start;
  if (start && Number.isInteger(start.year) && numberOrNull(start.revenue) && numberOrNull(start.netIncome) && numberOrNull(start.shares)) {
    restoredStart = { year: start.year as number, revenue: start.revenue, netIncome: start.netIncome, shares: start.shares };
  } else {
    dropped.push("starting year");
  }

  return {
    inputs: { cases, start: restoredStart, entryPrice: isNumber(raw.entryPrice) ? raw.entryPrice : null },
    dropped,
  };
}

const BASE_FIELDS = ["revenue", "costOfRevenue", "operatingIncome", "pretaxIncome", "netIncome"] as const;

export function restorePlumas(
  raw: Raw,
  fallback: { scenarios: Record<ScenarioId, ScenarioInputs>; base: BaseYear; mode: ProjectionMode },
): Restored<PlumasInputs> {
  const dropped: string[] = [];
  unknownKeys(raw, ["scenarios", "ai", "view", "base", "start"], "", dropped);
  const savedScenarios = isRecord(raw.scenarios) ? raw.scenarios : {};
  unknownKeys(savedScenarios, SCENARIOS.map(({ id }) => id), "", dropped);

  const scenarios = {} as Record<ScenarioId, ScenarioInputs>;
  for (const { id, label } of SCENARIOS) {
    const saved = isRecord(savedScenarios[id]) ? savedScenarios[id] : {};
    unknownKeys(saved, INPUT_FIELDS, `${label} `, dropped);
    scenarios[id] = Object.fromEntries(INPUT_FIELDS.map((field) => {
      if (isYearly(saved[field], PROJECTION_YEARS)) return [field, saved[field]];
      dropped.push(`${label} ${humanize(field)}`);
      return [field, fallback.scenarios[id][field]];
    })) as ScenarioInputs;
  }

  const ai = isRecord(raw.ai) && typeof raw.ai.summary === "string"
    ? {
      summary: raw.ai.summary,
      rationale: Object.fromEntries(SCENARIOS.flatMap(({ id }) => {
        const reason = isRecord(raw.ai) && isRecord(raw.ai.rationale) ? raw.ai.rationale[id] : undefined;
        return typeof reason === "string" ? [[id, reason]] : [];
      })) as Partial<Record<ScenarioId, string>>,
    }
    : null;

  const view = isRecord(raw.view) ? raw.view : {};
  const mode: ProjectionMode = view.mode === "simple" || view.mode === "advanced" ? view.mode : fallback.mode;
  const count: ScenarioCount = view.count === 5 ? 5 : 3;

  const base = isRecord(raw.base) ? raw.base : null;
  let restoredBase = fallback.base;
  if (base && Number.isInteger(base.year) && (base.periodEnding === null || typeof base.periodEnding === "string") && BASE_FIELDS.every((field) => numberOrNull(base[field]))) {
    restoredBase = {
      year: base.year as number,
      periodEnding: base.periodEnding as string | null,
      ...Object.fromEntries(BASE_FIELDS.map((field) => [field, base[field]])),
    } as BaseYear;
  } else {
    dropped.push("starting year");
  }

  const start = isRecord(raw.start) ? raw.start : {};
  return {
    inputs: {
      scenarios,
      ai,
      view: { mode, count },
      base: restoredBase,
      start: { price: isNumber(start.price) ? start.price : null, shares: isNumber(start.shares) ? start.shares : null },
    },
    dropped,
  };
}

// "Bear revenue growth, terminal multiple" for a notice.
export function droppedNotice(dropped: string[]): string | null {
  if (dropped.length === 0) return null;
  const unique = [...new Set(dropped)];
  return `Some saved inputs couldn't be used and were left out or set back to the starting values: ${unique.join(", ")}.`;
}
