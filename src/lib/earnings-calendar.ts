import { fetchFinnhub, finnhubSymbol, type FinnhubFailureReason } from "./finnhub";

// Reported results arrive through the day, so the calendar refreshes hourly.
const CALENDAR_REVALIDATE_SECONDS = 60 * 60;
const NAMES_TTL_MS = 24 * 60 * 60 * 1000;
// Companies expected to report at least this much quarterly revenue count as "large".
export const LARGE_REVENUE_ESTIMATE = 1e9;

export type ReportTime = "bmo" | "amc" | "dmh" | "unknown";

export const REPORT_TIMES: { id: ReportTime; label: string }[] = [
  { id: "bmo", label: "Before market open" },
  { id: "dmh", label: "During market hours" },
  { id: "amc", label: "After market close" },
  { id: "unknown", label: "Time not announced" },
];

export type EarningsEvent = {
  symbol: string;
  name: string | null;
  date: string;
  time: ReportTime;
  quarter: number | null;
  year: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  epsSurprise: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  revenueSurprise: number | null;
};

export type EarningsDay = { date: string; groups: { time: ReportTime; events: EarningsEvent[] }[]; count: number };

export type EarningsWeek = {
  start: string;
  end: string;
  days: EarningsDay[];
  total: number;
  shown: number;
  reported: number;
  beats: number;
};

export type EarningsWeekResult =
  | { ok: true; data: EarningsWeek }
  | { ok: false; reason: FinnhubFailureReason };

// Dates are plain "YYYY-MM-DD" strings handled in UTC, so no time zone can shift a day.
function toDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

// A real day: "2026-02-30" would roll over to March 2, so the date has to read back the same.
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = toDate(value);
  return !Number.isNaN(date.getTime()) && toIso(date) === value;
}

// The week to open by default: the current one, or the next one on weekends, when the
// current week's reports are over.
export function defaultWeek(today: string): string {
  const day = toDate(today).getUTCDay();
  return day === 0 || day === 6 ? addDays(weekStart(today), 7) : weekStart(today);
}

// The Monday of the week containing the date.
export function weekStart(iso: string): string {
  const day = toDate(iso).getUTCDay();
  return addDays(iso, day === 0 ? -6 : 1 - day);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function surprise(actual: number | null, estimate: number | null): number | null {
  if (actual === null || estimate === null || estimate === 0) return null;
  return (actual - estimate) / Math.abs(estimate);
}

function reportTime(value: unknown): ReportTime {
  return value === "bmo" || value === "amc" || value === "dmh" ? value : "unknown";
}

export type CompanyReport = { date: string; time: ReportTime; year: number | null; quarter: number | null };

// One company's reports in Finnhub's calendar, from 100 days back to 120 ahead, oldest first; free for every
// company. The Overview (the next report) and the Transcripts tab (the latest) share this cached request.
export async function getCompanyReports(symbol: string, today: string): Promise<CompanyReport[] | null> {
  const result = await fetchFinnhub("calendar/earnings", { symbol: finnhubSymbol(symbol), from: addDays(today, -100), to: addDays(today, 120) }, 60 * 60 * 6);
  const rows = result.ok ? (result.payload as { earningsCalendar?: unknown } | null)?.earningsCalendar : null;
  if (!Array.isArray(rows)) return null;
  return rows
    .flatMap((row): CompanyReport[] => {
      const record = row as { date?: unknown; hour?: unknown; year?: unknown; quarter?: unknown };
      return isIsoDate(record.date)
        ? [{
            date: record.date,
            time: reportTime(record.hour),
            year: Number.isInteger(record.year) ? (record.year as number) : null,
            quarter: Number.isInteger(record.quarter) ? (record.quarter as number) : null,
          }]
        : [];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function normalizeEvent(row: unknown, names: Map<string, string>): EarningsEvent | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (typeof record.symbol !== "string" || !record.symbol || !isIsoDate(record.date)) return null;

  const epsEstimate = num(record.epsEstimate);
  const epsActual = num(record.epsActual);
  const revenueEstimate = num(record.revenueEstimate);
  const revenueActual = num(record.revenueActual);
  return {
    symbol: record.symbol,
    name: names.get(record.symbol) ?? null,
    date: record.date as string,
    time: reportTime(record.hour),
    quarter: num(record.quarter),
    year: num(record.year),
    epsEstimate,
    epsActual,
    epsSurprise: surprise(epsActual, epsEstimate),
    revenueEstimate,
    revenueActual,
    revenueSurprise: surprise(revenueActual, revenueEstimate),
  };
}

const LOWER_WORDS = new Set(["of", "and", "the", "for", "de", "a"]);
// Words without vowels are acronyms (RTX, WR, CV), except these abbreviations.
const VOWELLESS_WORDS = new Set(["ltd"]);

// Finnhub lists names like "COCA-COLA CO/THE" or "META PLATFORMS INC-CLASS A".
export function cleanCompanyName(raw: string): string {
  const trimmed = raw
    .replace(/\/THE$/i, "")
    .replace(/[-\s]+(CLASS|CL)\s+[A-Z]$/i, "")
    .replace(/\s+-\s*$/, "")
    .trim();
  return trimmed
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((part, index) => {
      if (/^\s+$|^[-/]$/.test(part)) return part;
      // Keep tokens with symbols or digits (AT&T, 3M) as written.
      if (/[&\d]/.test(part)) return part.toUpperCase();
      if (index > 0 && LOWER_WORDS.has(part)) return part;
      if (!/[aeiouy]/.test(part) && !VOWELLESS_WORDS.has(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

let namesCache: { at: number; names: Map<string, string> } | null = null;
let namesRequest: Promise<Map<string, string>> | null = null;

// The US symbol list is ~7 MB, over the Next.js data cache's 2 MB limit, so the names are kept
// in memory for a day instead. Without them the calendar still works, showing tickers only.
export async function getCompanyNames(now = Date.now()): Promise<Map<string, string>> {
  if (namesCache && now - namesCache.at < NAMES_TTL_MS) return namesCache.names;
  namesRequest ??= (async () => {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return new Map<string, string>();
    try {
      const response = await fetch("https://finnhub.io/api/v1/stock/symbol?exchange=US", {
        headers: { "X-Finnhub-Token": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return new Map<string, string>();
      const rows: unknown = await response.json();
      const names = new Map<string, string>();
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const { symbol, description } = (row ?? {}) as { symbol?: unknown; description?: unknown };
          if (typeof symbol === "string" && typeof description === "string" && description) {
            names.set(symbol, cleanCompanyName(description));
          }
        }
      }
      if (names.size > 0) namesCache = { at: now, names };
      return names;
    } catch {
      return new Map<string, string>();
    } finally {
      namesRequest = null;
    }
  })();
  return namesRequest;
}

// For tests: forget the cached names.
export function resetCompanyNames(): void {
  namesCache = null;
  namesRequest = null;
}

export function buildWeek(events: EarningsEvent[], start: string, largeOnly: boolean): EarningsWeek {
  const end = addDays(start, 6);
  const inWeek = events.filter((event) => event.date >= start && event.date <= end);
  const shown = largeOnly ? inWeek.filter((event) => (event.revenueEstimate ?? 0) >= LARGE_REVENUE_ESTIMATE) : inWeek;
  // Largest companies first within each group, using expected revenue as the size measure.
  const bySize = (left: EarningsEvent, right: EarningsEvent) =>
    (right.revenueEstimate ?? -1) - (left.revenueEstimate ?? -1) || left.symbol.localeCompare(right.symbol);

  const days: EarningsDay[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(start, offset);
    const dayEvents = shown.filter((event) => event.date === date);
    // Weekends only appear when something is scheduled on them.
    if (offset >= 5 && dayEvents.length === 0) continue;
    days.push({
      date,
      count: dayEvents.length,
      groups: REPORT_TIMES
        .map(({ id }) => ({ time: id, events: dayEvents.filter((event) => event.time === id).sort(bySize) }))
        .filter((group) => group.events.length > 0),
    });
  }

  const reported = shown.filter((event) => event.epsActual !== null);
  return {
    start,
    end,
    days,
    total: inWeek.length,
    shown: shown.length,
    reported: reported.length,
    beats: reported.filter((event) => (event.epsSurprise ?? 0) > 0).length,
  };
}

export async function getEarningsWeek(start: string, largeOnly: boolean): Promise<EarningsWeekResult> {
  const [calendar, names] = await Promise.all([
    fetchFinnhub("calendar/earnings", { from: start, to: addDays(start, 6) }, CALENDAR_REVALIDATE_SECONDS),
    getCompanyNames(),
  ]);
  if (!calendar.ok) return calendar;

  const rows = calendar.payload && typeof calendar.payload === "object"
    ? (calendar.payload as { earningsCalendar?: unknown }).earningsCalendar
    : null;
  if (!Array.isArray(rows)) return { ok: false, reason: "provider-error" };

  const events = rows.flatMap((row) => {
    const event = normalizeEvent(row, names);
    return event ? [event] : [];
  });
  return { ok: true, data: buildWeek(events, start, largeOnly) };
}
