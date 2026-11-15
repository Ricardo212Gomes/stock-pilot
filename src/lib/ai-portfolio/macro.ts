import { getFedTarget, getFredCsvSeries, type FedTarget } from "../event-sources";
import { getTenYearYields } from "../fmp";
import { getVix, vixStats, vixZone, type VixResult } from "../vix";

// The week's macro figures for the AI portfolio's prompt (docs/ai-portfolio.md): the Fed funds target range, the
// 10-year Treasury yield and its change over a month, inflation, and the VIX against its own past year. The yield
// (DGS10) and CPI (CPIAUCSL) come from FRED's API with FRED_API_KEY, or from FRED's public CSV without it; the
// yield falls back to FMP's treasury rates when FRED fails. Each figure is optional: a source that fails is named
// in `missing`, and the run goes on without it.

const FRED_API = "https://api.stlouisfed.org/fred/series/observations";
const DAY_MS = 24 * 60 * 60 * 1000;

export type MacroFigures = {
  fedFunds: { lower: number; upper: number; since: string } | null;
  // Fractions: 0.0425 is 4.25%.
  tenYear: { value: number; date: string; monthAgo: number | null; source: "fred" | "fmp" } | null;
  // CPI's rise over the past year, for the latest month.
  cpi: { yearOverYear: number; month: string } | null;
  vix: { value: number; date: string; zone: string; yearPercentile: number | null; yearAverage: number | null } | null;
  missing: string[];
};

export type Observation = { date: string; value: number };

// FRED's observations as numbers, oldest first. Missing days are "." and are skipped.
export function parseFredObservations(payload: unknown): Observation[] | null {
  const list = (payload as { observations?: unknown })?.observations;
  if (!Array.isArray(list)) return null;
  return list.flatMap((row: { date?: unknown; value?: unknown }) => {
    const value = typeof row?.value === "string" ? Number(row.value) : NaN;
    return typeof row?.date === "string" && Number.isFinite(value) ? [{ date: row.date, value }] : [];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

async function fredSeries(seriesId: string, from: string, apiKey: string): Promise<Observation[] | null> {
  const url = new URL(FRED_API);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("observation_start", from);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("api_key", apiKey);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return response.ok ? parseFredObservations(await response.json()) : null;
  } catch {
    return null;
  }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The latest value, and the last one on or before a month earlier.
export function latestAndMonthAgo(series: Observation[]): { value: number; date: string; monthAgo: number | null } | null {
  const latest = series.at(-1);
  if (!latest) return null;
  const target = new Date(`${latest.date}T12:00:00Z`);
  target.setUTCMonth(target.getUTCMonth() - 1);
  const cutoff = isoDay(target);
  const before = [...series].reverse().find((point) => point.date <= cutoff);
  return { value: latest.value, date: latest.date, monthAgo: before?.value ?? null };
}

// CPI against the same month a year earlier, for the latest month that has one: a month can be missing (October
// 2025 was never published), and the figure then says which month it's for.
export function cpiYearOverYear(series: Observation[]): { yearOverYear: number; month: string } | null {
  const byDate = new Map(series.map((point) => [point.date, point.value]));
  for (let index = series.length - 1; index >= 0; index--) {
    const point = series[index];
    const base = byDate.get(`${Number(point.date.slice(0, 4)) - 1}${point.date.slice(4)}`);
    if (base !== undefined && base > 0) return { yearOverYear: point.value / base - 1, month: point.date.slice(0, 7) };
  }
  return null;
}

export type MacroDeps = {
  now: () => Date;
  fredKey: () => string | undefined;
  fedTarget: () => Promise<FedTarget | null>;
  // FRED's API with a key, else its public CSV; values as FRED publishes them (the yield in percent).
  fred: (seriesId: string, from: string, apiKey: string | undefined) => Promise<Observation[] | null>;
  fmpTenYear: (from: string) => Promise<Observation[]>;
  vix: () => Promise<VixResult>;
};

export const defaultMacroDeps: MacroDeps = {
  now: () => new Date(),
  fredKey: () => process.env.FRED_API_KEY || undefined,
  fedTarget: getFedTarget,
  fred: (seriesId, from, apiKey) => (apiKey ? fredSeries(seriesId, from, apiKey) : getFredCsvSeries(seriesId, from)),
  fmpTenYear: getTenYearYields,
  vix: () => getVix(),
};

export async function getMacroFigures(deps: MacroDeps = defaultMacroDeps): Promise<MacroFigures> {
  const now = deps.now();
  const sixWeeksAgo = isoDay(new Date(now.getTime() - 45 * DAY_MS));
  const fourteenMonthsAgo = isoDay(new Date(now.getTime() - 425 * DAY_MS));
  const key = deps.fredKey();

  const [target, fredYields, cpi, vix] = await Promise.all([
    deps.fedTarget().catch(() => null),
    deps.fred("DGS10", sixWeeksAgo, key).catch(() => null),
    deps.fred("CPIAUCSL", fourteenMonthsAgo, key).catch(() => null),
    deps.vix().catch(() => null),
  ]);
  const missing: string[] = [];
  const fredName = key ? "FRED's API" : "FRED";

  const lastChange = target?.changes.at(-1);
  const fedFunds = lastChange ? { lower: lastChange.lower, upper: lastChange.upper, since: lastChange.date } : null;
  if (!fedFunds) missing.push("the Fed funds target range (FRED)");

  // FRED gives the yield in percent; FMP's reader, the fallback, already in fractions.
  let tenYear: MacroFigures["tenYear"] = null;
  const fromFred = fredYields ? latestAndMonthAgo(fredYields.map((point) => ({ ...point, value: point.value / 100 }))) : null;
  if (fromFred) tenYear = { ...fromFred, source: "fred" };
  else {
    const fromFmp = latestAndMonthAgo(await deps.fmpTenYear(sixWeeksAgo).catch(() => []));
    if (fromFmp) tenYear = { ...fromFmp, source: "fmp" };
  }
  if (!tenYear) missing.push(`the 10-year Treasury yield (${fredName} and FMP)`);

  const inflation = cpi ? cpiYearOverYear(cpi) : null;
  if (!inflation) missing.push(`CPI (${fredName})`);

  let vixFigure: MacroFigures["vix"] = null;
  if (vix?.ok) {
    const stats = vixStats(vix.data);
    vixFigure = {
      value: vix.data.quote.value,
      date: vix.data.quote.date,
      zone: vixZone(vix.data.quote.value).label,
      yearPercentile: stats.yearPercentile,
      yearAverage: stats.yearAverage,
    };
  } else {
    missing.push("the VIX");
  }

  return { fedFunds, tenYear, cpi: inflation, vix: vixFigure, missing };
}

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;

// The block at the top of the prompt, one figure a line; null when there's nothing to say.
export function macroLines(macro: MacroFigures): string | null {
  const lines: string[] = [];
  if (macro.fedFunds) lines.push(`Fed funds target range: ${macro.fedFunds.lower.toFixed(2)}–${macro.fedFunds.upper.toFixed(2)}%, since ${macro.fedFunds.since}.`);
  if (macro.tenYear) {
    const { value, monthAgo, date } = macro.tenYear;
    const change = monthAgo === null ? "" : `, ${value >= monthAgo ? "up" : "down"} ${Math.abs((value - monthAgo) * 10_000).toFixed(0)} basis points from ${pct(monthAgo)} a month earlier`;
    lines.push(`10-year Treasury yield: ${pct(value)} on ${date}${change}.`);
  }
  if (macro.cpi) lines.push(`Inflation (CPI): ${pct(macro.cpi.yearOverYear, 1)} over the year to ${macro.cpi.month}.`);
  if (macro.vix) {
    const { value, zone, yearPercentile, yearAverage, date } = macro.vix;
    const context = [
      yearAverage === null ? null : `its past year averaged ${yearAverage.toFixed(1)}`,
      yearPercentile === null ? null : `higher than ${Math.round(yearPercentile * 100)}% of the past year's closes`,
    ].filter(Boolean).join("; ");
    lines.push(`VIX: ${value.toFixed(1)} on ${date} (${zone.toLowerCase()})${context ? `; ${context}` : ""}.`);
  }
  return lines.length > 0 ? `Market this week:\n${lines.map((line) => `- ${line}`).join("\n")}` : null;
}
