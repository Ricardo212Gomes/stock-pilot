import { addDays, getCompanyNames, isIsoDate, weekStart } from "./earnings-calendar";
import { FMP_BASE_URL, failureReason, fetchFmp, type FmpFailureReason } from "./fmp";

// Dividends are announced weeks ahead and rarely change during the day.
const DIVIDEND_REVALIDATE_SECONDS = 60 * 60 * 6;
// Payments usually follow the ex-dividend date within a few weeks; look back this far for them.
const PAYMENT_LOOKBACK_DAYS = 60;
// The free FMP plan refuses calendar requests that start more than about four weeks ago.
export const FREE_PLAN_LOOKBACK_DAYS = 25;

export type DividendDateField = "ex" | "pay";

export type DividendEvent = {
  symbol: string;
  name: string | null;
  exDate: string;
  recordDate: string | null;
  paymentDate: string | null;
  declarationDate: string | null;
  dividend: number;
  // Percent, as FMP reports it (0.57 means 0.57%).
  yieldPercent: number | null;
  frequency: string | null;
  annualDividend: number | null;
};

export type DividendDay = { date: string; inMonth: boolean; events: DividendEvent[] };

export type DividendMonth = {
  month: string;
  by: DividendDateField;
  weeks: DividendDay[][];
  count: number;
};

export type DividendMonthResult =
  | { ok: true; data: DividendMonth }
  | { ok: false; reason: FmpFailureReason };

const PAYMENTS_PER_YEAR: Record<string, number> = {
  monthly: 12,
  quarterly: 4,
  "semi-annual": 2,
  semiannual: 2,
  annual: 1,
};

// "2026-10" for any date in October 2026.
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function addMonths(month: string, count: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + count, 1, 12));
  return date.toISOString().slice(0, 7);
}

function lastDayOfMonth(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

// Monday-to-Friday weeks covering the month, padded with the neighbouring months' days.
export function monthGrid(month: string): string[][] {
  const first = weekStart(`${month}-01`);
  const last = lastDayOfMonth(month);
  const weeks: string[][] = [];
  for (let monday = first; monday <= last; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 5 }, (_, day) => addDays(monday, day)));
  }
  return weeks;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeDividend(row: unknown, names: Map<string, string>): DividendEvent | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const dividend = typeof record.dividend === "number" && Number.isFinite(record.dividend) ? record.dividend : null;
  if (typeof record.symbol !== "string" || !record.symbol || !isIsoDate(record.date) || dividend === null || dividend <= 0) {
    return null;
  }

  const frequency = text(record.frequency);
  const payments = frequency ? PAYMENTS_PER_YEAR[frequency.toLowerCase()] : undefined;
  const date = (value: unknown) => (isIsoDate(value) ? value : null);
  return {
    symbol: record.symbol,
    name: names.get(record.symbol) ?? null,
    exDate: record.date as string,
    recordDate: date(record.recordDate),
    paymentDate: date(record.paymentDate),
    declarationDate: date(record.declarationDate),
    dividend,
    yieldPercent: typeof record.yield === "number" && Number.isFinite(record.yield) ? record.yield : null,
    frequency,
    annualDividend: payments ? dividend * payments : null,
  };
}

export function placementDate(event: DividendEvent, by: DividendDateField): string | null {
  return by === "ex" ? event.exDate : event.paymentDate;
}

export function buildMonth(events: DividendEvent[], month: string, by: DividendDateField): DividendMonth {
  const grid = monthGrid(month);
  const byDate = new Map<string, DividendEvent[]>();
  for (const event of events) {
    const date = placementDate(event, by);
    if (!date) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), event]);
  }

  const weeks = grid.map((week) => week.map((date) => ({
    date,
    inMonth: monthOf(date) === month,
    // Highest-yielding first within a day.
    events: [...(byDate.get(date) ?? [])].sort((left, right) =>
      (right.yieldPercent ?? -1) - (left.yieldPercent ?? -1) || left.symbol.localeCompare(right.symbol)),
  })));

  return {
    month,
    by,
    weeks,
    count: weeks.flat().filter((day) => day.inMonth).reduce((sum, day) => sum + day.events.length, 0),
  };
}

export async function getDividendMonth(
  month: string,
  by: DividendDateField,
  today = new Date().toISOString().slice(0, 10),
): Promise<DividendMonthResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { ok: false, reason: "not-configured" };

  const grid = monthGrid(month);
  const gridStart = grid[0][0];
  const gridEnd = grid[grid.length - 1][4];
  // FMP filters by ex-dividend date; a payment this month can follow an ex-date weeks earlier.
  const wanted = by === "pay" ? addDays(gridStart, -PAYMENT_LOOKBACK_DAYS) : gridStart;
  // Never start before the free plan's window while the month itself is inside it; an older
  // month is requested as is and reported as plan-restricted.
  const earliest = addDays(today, -FREE_PLAN_LOOKBACK_DAYS);
  const from = wanted < earliest && gridEnd >= earliest ? earliest : wanted;

  const url = new URL(`${FMP_BASE_URL}/dividends-calendar`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", gridEnd);
  url.searchParams.set("apikey", apiKey);

  try {
    const [payload, names] = await Promise.all([fetchFmp(url, DIVIDEND_REVALIDATE_SECONDS), getCompanyNames()]);
    if (!Array.isArray(payload)) return { ok: false, reason: "provider-error" };
    const events = payload.flatMap((row) => {
      const event = normalizeDividend(row, names);
      return event ? [event] : [];
    });
    return { ok: true, data: buildMonth(events, month, by) };
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
}
