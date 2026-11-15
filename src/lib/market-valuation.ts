import { getSql } from "./db";

// Market valuation (docs/market-valuation.md): the S&P 500's and the Nasdaq-100's P/E, CAPE and yields against their
// own history. npm run market-valuation:update stores the series in market_valuations; pages only read them.

export type MarketIndex = "sp500" | "ndx" | "us";
export type ValuationPoint = { date: string; value: number; provisional?: boolean };
// Every stored series, by index and metric, oldest first.
export type ValuationSeries = Partial<Record<MarketIndex, Partial<Record<string, ValuationPoint[]>>>>;

export const INDEX_LABEL: Record<"sp500" | "ndx", string> = { sp500: "S&P 500", ndx: "Nasdaq-100" };

// ---------- Storage ----------

export type StoredSeries = { index: MarketIndex; metric: string; source: string; points: ValuationPoint[] };

// Upserts every point of the series, one statement per series. Returns how many rows were written.
export async function storeSeries(series: StoredSeries[]): Promise<number> {
  const sql = getSql();
  let written = 0;
  for (const { index, metric, source, points } of series) {
    if (points.length === 0) continue;
    const rows = points.map((point) => ({ market: index, metric, date: point.date, value: point.value, source, provisional: point.provisional ?? false }));
    for (let start = 0; start < rows.length; start += 1000) {
      const chunk = rows.slice(start, start + 1000);
      await sql`
        insert into market_valuations ${sql(chunk, "market", "metric", "date", "value", "source", "provisional")}
        on conflict (market, metric, date) do update
          set value = excluded.value, source = excluded.source, provisional = excluded.provisional, updated_at = now()
          where market_valuations.value is distinct from excluded.value or market_valuations.provisional is distinct from excluded.provisional
      `;
      written += chunk.length;
    }
  }
  return written;
}

type Row = { market: MarketIndex; metric: string; date: Date | string; value: number | string; provisional: boolean };

function isoDay(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export async function loadSeries(indexes: MarketIndex[] = ["sp500", "ndx", "us"]): Promise<ValuationSeries> {
  const rows = await getSql()<Row[]>`
    select market, metric, date, value, provisional from market_valuations
    where market = any(${indexes}) order by market, metric, date
  `;
  const series: ValuationSeries = {};
  for (const row of rows) {
    const point: ValuationPoint = { date: isoDay(row.date), value: Number(row.value) };
    if (row.provisional) point.provisional = true;
    ((series[row.market] ??= {})[row.metric] ??= []).push(point);
  }
  return series;
}

export type ValuationSummary = { index: "sp500" | "ndx"; text: string; model: string; basis: string; createdAt: string };

export async function storeSummary(summary: Omit<ValuationSummary, "createdAt">): Promise<void> {
  await getSql()`
    insert into market_valuation_summaries (market, text, model, basis)
    values (${summary.index}, ${summary.text}, ${summary.model}, ${summary.basis})
    on conflict (market) do update set text = excluded.text, model = excluded.model, basis = excluded.basis, created_at = now()
  `;
}

export async function loadSummaries(): Promise<Partial<Record<"sp500" | "ndx", ValuationSummary>>> {
  const rows = await getSql()<{ market: "sp500" | "ndx"; text: string; model: string; basis: string; created_at: Date }[]>`
    select market, text, model, basis, created_at from market_valuation_summaries
  `;
  return Object.fromEntries(rows.map((row) => [row.market, { index: row.market, text: row.text, model: row.model, basis: row.basis, createdAt: row.created_at.toISOString() }]));
}

// ---------- Reading the numbers ----------

export type ZoneId = "cheap" | "fair" | "expensive" | "very-expensive";
export type Zone = { id: ZoneId; label: string; from: number; to: number; meaning: string };

// By percentile of the index's own history: where today sits among every month since the series began.
export const ZONES: Zone[] = [
  { id: "cheap", label: "Cheap", from: 0, to: 25, meaning: "In the cheapest quarter of its history." },
  { id: "fair", label: "Fair", from: 25, to: 75, meaning: "In the middle half of its history." },
  { id: "expensive", label: "Expensive", from: 75, to: 90, meaning: "Higher than three months in four of its history." },
  { id: "very-expensive", label: "Very expensive", from: 90, to: 100, meaning: "Among the highest tenth of its history." },
];

export function zoneFor(percentile: number): Zone {
  return ZONES.find((zone) => percentile < zone.to) ?? ZONES[ZONES.length - 1];
}

// Ten years of months: less than that is too short a history to call a level cheap or expensive.
export const MIN_ZONE_POINTS = 120;

// The share of the history below the value, 0 to 100.
export function percentileOf(values: number[], value: number): number {
  if (values.length === 0) return NaN;
  const below = values.filter((item) => item < value).length;
  const equal = values.filter((item) => item === value).length;
  return ((below + equal / 2) / values.length) * 100;
}

export type HistoryStats = { average: number; deviation: number; low: ValuationPoint; high: ValuationPoint; since: string; count: number };

export function historyStats(points: ValuationPoint[]): HistoryStats | null {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length);
  const low = points.reduce((lowest, point) => (point.value < lowest.value ? point : lowest));
  const high = points.reduce((highest, point) => (point.value > highest.value ? point : highest));
  return { average, deviation, low, high, since: points[0].date, count: points.length };
}

function shiftYears(isoDate: string, years: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

// The last point on or before a date, if it's within two months of it.
export function pointOn(points: ValuationPoint[], isoDate: string): ValuationPoint | null {
  const earliest = new Date(Date.parse(`${isoDate}T12:00:00Z`) - 62 * 86_400_000).toISOString().slice(0, 10);
  for (let index = points.length - 1; index >= 0; index--) {
    if (points[index].date <= isoDate) return points[index].date >= earliest ? points[index] : null;
  }
  return null;
}

export type Comparison = { label: string; point: ValuationPoint | null };

export function comparisons(points: ValuationPoint[], years = [1, 5, 10, 20]): Comparison[] {
  const last = points.at(-1);
  return years.map((count) => ({
    label: `${count} year${count === 1 ? "" : "s"} ago`,
    point: last ? pointOn(points, shiftYears(last.date, -count)) : null,
  }));
}

// The point of another series in the same month, e.g. the index level at a Siblis snapshot.
export function sameMonth(points: ValuationPoint[] | undefined, isoDate: string): ValuationPoint | null {
  const month = isoDate.slice(0, 7);
  return points?.findLast((point) => point.date.slice(0, 7) === month) ?? null;
}

export type TodayEstimate = {
  value: number;
  level: ValuationPoint;
  // The earnings it's divided by: Shiller's trailing twelve months, or what a Siblis snapshot implies.
  earningsDate: string;
  provisional: boolean;
};

// The S&P 500's latest close over Shiller's latest trailing earnings.
export function sp500Today(series: ValuationSeries): TodayEstimate | null {
  const level = series.sp500?.level?.at(-1);
  const earnings = series.sp500?.earnings?.filter((point) => point.value > 0).at(-1);
  if (!level || !earnings) return null;
  return { value: level.value / earnings.value, level, earningsDate: earnings.date, provisional: Boolean(earnings.provisional) };
}

// The Nasdaq-100's latest close over the earnings its latest snapshot implies (its level then over its P/E then).
export function ndxToday(series: ValuationSeries, metric: "pe" | "pe_forward" = "pe"): TodayEstimate | null {
  const level = series.ndx?.level?.at(-1);
  const snapshot = series.ndx?.[metric]?.at(-1);
  if (!level || !snapshot) return null;
  const then = sameMonth(series.ndx?.level, snapshot.date);
  if (!then) return null;
  return { value: level.value / (then.value / snapshot.value), level, earningsDate: snapshot.date, provisional: false };
}

export type Reading = {
  metric: string;
  latest: ValuationPoint;
  stats: HistoryStats | null;
  percentile: number | null;
  zone: Zone | null;
  comparisons: Comparison[];
};

// One metric's latest value, against its history; the zone only with ten years or more of it.
export function reading(points: ValuationPoint[] | undefined, metric: string, value?: number): Reading | null {
  const latest = points?.at(-1);
  if (!points || !latest) return null;
  const current = value ?? latest.value;
  const enough = points.length >= MIN_ZONE_POINTS;
  const percentile = enough ? percentileOf(points.map((point) => point.value), current) : null;
  return {
    metric,
    latest,
    stats: historyStats(points),
    percentile,
    zone: percentile === null ? null : zoneFor(percentile),
    comparisons: comparisons(points),
  };
}

// Earnings yield minus the 10-year Treasury yield, in percentage points, for the months both have.
export function yieldGap(earningsYield: ValuationPoint[] | undefined, tenYear: ValuationPoint[] | undefined): ValuationPoint[] {
  if (!earningsYield || !tenYear) return [];
  const rates = new Map(tenYear.map((point) => [point.date.slice(0, 7), point.value]));
  return earningsYield.flatMap((point): ValuationPoint[] => {
    const rate = rates.get(point.date.slice(0, 7));
    return rate === undefined ? [] : [{ date: point.date, value: Number((point.value - rate).toFixed(3)), ...(point.provisional ? { provisional: true } : {}) }];
  });
}

// What the AI summary is written from, also used to tell when the numbers have moved enough to write a new one.
export function summaryFacts(series: ValuationSeries, index: "sp500" | "ndx"): { facts: string[]; basis: string } {
  const facts: string[] = [];
  const format = (value: number, digits = 1) => value.toFixed(digits);
  const describe = (label: string, item: Reading | null, unit = "") => {
    if (!item) return;
    const parts = [`${label}: ${format(item.latest.value)}${unit} (${item.latest.date})`];
    if (item.stats) parts.push(`average ${format(item.stats.average)}${unit} since ${item.stats.since.slice(0, 4)}`);
    if (item.percentile !== null) parts.push(`higher than ${Math.round(item.percentile)}% of months`);
    for (const { label: ago, point } of item.comparisons) if (point) parts.push(`${ago} ${format(point.value)}${unit}`);
    facts.push(parts.join("; "));
  };
  if (index === "sp500") {
    const today = sp500Today(series);
    if (today) facts.push(`Trailing P/E today (estimate): ${format(today.value)}, the close on ${today.level.date} over earnings to ${today.earningsDate}`);
    describe("Trailing P/E, monthly", reading(series.sp500?.pe, "pe"));
    describe("CAPE (Shiller P/E10)", reading(series.sp500?.cape, "cape"));
    describe("Dividend yield", reading(series.sp500?.dividend_yield, "dividend_yield"), "%");
    describe("Earnings yield minus 10-year Treasury yield", reading(yieldGap(series.sp500?.earnings_yield, series.sp500?.ten_year), "gap"), " points");
    describe("US stock market value to GDP (Buffett indicator)", reading(series.us?.buffett, "buffett"), "%");
  } else {
    const today = ndxToday(series);
    if (today) facts.push(`Trailing P/E today (estimate): ${format(today.value)}, the close on ${today.level.date} over the earnings implied on ${today.earningsDate}`);
    describe("Trailing P/E (snapshots since Dec 2023)", reading(series.ndx?.pe, "pe"));
    describe("Forward P/E", reading(series.ndx?.pe_forward, "pe_forward"));
    describe("CAPE", reading(series.ndx?.cape, "cape"));
    const sp500 = series.sp500?.pe?.filter((point) => !point.provisional).at(-1);
    if (sp500) facts.push(`S&P 500 trailing P/E for comparison: ${format(sp500.value)} (${sp500.date})`);
  }
  const ten = series.us?.ten_year?.at(-1);
  if (ten) facts.push(`10-year Treasury yield: ${format(ten.value, 2)}% (${ten.date})`);
  // A new summary when a month's data arrives, not for every day's close.
  const basis = [index, series[index]?.pe?.at(-1)?.date, series[index]?.cape?.at(-1)?.date, series.us?.buffett?.at(-1)?.date].join("|");
  return { facts, basis };
}

export type HomeSnapshot = { value: number; percentile: number | null; zone: Zone | null };

// The Home page's card: today's S&P 500 P/E estimate and its zone, from three small reads rather than every series.
export async function sp500Snapshot(): Promise<HomeSnapshot | null> {
  const sql = getSql();
  const [history, latest] = await Promise.all([
    sql<{ value: number }[]>`select value from market_valuations where market = 'sp500' and metric = 'pe'`,
    sql<Row[]>`
      select distinct on (metric) market, metric, date, value, provisional from market_valuations
      where market = 'sp500' and metric in ('level', 'earnings') and value > 0
      order by metric, date desc
    `,
  ]);
  const level = latest.find((row) => row.metric === "level");
  const earnings = latest.find((row) => row.metric === "earnings");
  if (!level || !earnings) return null;
  const value = Number(level.value) / Number(earnings.value);
  const percentile = history.length >= MIN_ZONE_POINTS ? percentileOf(history.map((row) => Number(row.value)), value) : null;
  return { value, percentile, zone: percentile === null ? null : zoneFor(percentile) };
}
