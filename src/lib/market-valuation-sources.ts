import { parseFredCsv } from "./event-sources";
import { readXls, type XlsCell } from "./xls";
import type { MarketIndex, ValuationPoint } from "./market-valuation";

// Reads the market valuation series from their free sources (docs/market-valuation.md), for
// npm run market-valuation:update. Nothing here runs when a page opens: the page reads what the job stored.
//
// - Robert Shiller's dataset: the S&P 500 every month since 1871 (price, dividends, earnings, the 10-year rate, CAPE).
// - Siblis Research's free API: the Nasdaq-100's P/E, forward P/E and CAPE, month-end snapshots.
// - FRED's public CSV: index levels, the 10-year Treasury yield, and US stock market value against GDP.

export const SHILLER_PAGE_URL = "https://shillerdata.com/";
// The old address, still served; the page's link is tried first because it moves with each update.
export const SHILLER_FALLBACK_URL = "http://www.econ.yale.edu/~shiller/data/ie_data.xls";
export const SIBLIS_URL = "https://siblisresearch.com/api/v1";
const FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const TIMEOUT_MS = 30_000;
const HEADERS = { "User-Agent": "StockPilot" };

// The Shiller months whose earnings may still be estimates: the latest earnings come in months late, so the last
// half year is filled from S&P's estimates and revised later.
const PROVISIONAL_MONTHS = 6;

export type SourceId = "shiller" | "siblis" | "fred";
export type SourceSeries = { index: MarketIndex; metric: string; source: SourceId; points: ValuationPoint[] };

// Shiller writes the month as a decimal: 2026.01 is January, 2026.1 is October. Months end on their last day.
export function shillerMonth(value: number): string | null {
  if (!Number.isFinite(value) || value < 1800) return null;
  const year = Math.floor(value);
  const month = Math.round((value - year) * 100);
  if (month < 1 || month > 12) return null;
  return monthEnd(year, month);
}

function monthEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

const number = (cell: XlsCell | undefined): number | null => (typeof cell === "number" && Number.isFinite(cell) ? cell : null);
const round = (value: number, digits = 4) => Number(value.toFixed(digits));

// The columns are found by their header (the row starting "Date"), in case Shiller adds or moves one.
export function parseShiller(rows: XlsCell[][]): SourceSeries[] {
  const headerAt = rows.findIndex((row) => row?.[0] === "Date");
  if (headerAt < 0) throw new Error("Shiller's Data sheet has no header row.");
  const header = rows[headerAt].map((cell) => (typeof cell === "string" ? cell.trim() : ""));
  const column = (name: string) => header.findIndex((cell) => cell === name);
  const columns = { price: column("P"), dividend: column("D"), earnings: column("E"), rate: column("Rate GS10"), cape: column("CAPE") };
  if (Object.values(columns).some((index) => index < 0)) throw new Error("Shiller's Data sheet is missing a column.");

  const series: Record<string, ValuationPoint[]> = { pe: [], cape: [], earnings_yield: [], dividend_yield: [], ten_year: [], price: [], earnings: [] };
  const months: { date: string; earnings: number | null }[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const date = shillerMonth(number(row?.[0]) ?? NaN);
    if (!date) continue;
    const price = number(row[columns.price]);
    const earnings = number(row[columns.earnings]);
    const dividend = number(row[columns.dividend]);
    const rate = number(row[columns.rate]);
    const cape = number(row[columns.cape]);
    months.push({ date, earnings });
    if (price !== null && price > 0) {
      series.price.push({ date, value: round(price, 2) });
      if (earnings !== null && earnings > 0) {
        series.pe.push({ date, value: round(price / earnings, 2) });
        series.earnings_yield.push({ date, value: round((earnings / price) * 100, 3) });
      }
      if (dividend !== null && dividend > 0) series.dividend_yield.push({ date, value: round((dividend / price) * 100, 3) });
    }
    if (earnings !== null) series.earnings.push({ date, value: round(earnings, 3) });
    if (rate !== null) series.ten_year.push({ date, value: round(rate, 3) });
    if (cape !== null && cape > 0) series.cape.push({ date, value: round(cape, 2) });
  }

  // The last months with earnings are marked provisional, in every series that uses them.
  const withEarnings = months.filter((month) => month.earnings !== null);
  const provisionalFrom = withEarnings[Math.max(0, withEarnings.length - PROVISIONAL_MONTHS)]?.date ?? "9999";
  for (const metric of ["pe", "earnings_yield", "dividend_yield", "earnings"]) {
    for (const point of series[metric]) if (point.date >= provisionalFrom) point.provisional = true;
  }
  return Object.entries(series).map(([metric, points]) => ({ index: "sp500", metric, source: "shiller", points }));
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

// The download link on Shiller's page, e.g. "//img1.wsimg.com/…/ie_data.xls?ver=…".
export function shillerLink(html: string): string | null {
  const match = /href="([^"]*\/ie_data\.xls[^"]*)"/i.exec(html);
  if (!match) return null;
  const href = match[1].replace(/&amp;/g, "&");
  return href.startsWith("//") ? `https:${href}` : href.startsWith("http") ? href : null;
}

export async function fetchShiller(): Promise<SourceSeries[]> {
  let file: Uint8Array | null = null;
  try {
    const page = new TextDecoder().decode(await fetchBytes(SHILLER_PAGE_URL));
    const link = shillerLink(page);
    if (link) file = await fetchBytes(link);
  } catch {
    // The old address below.
  }
  file ??= await fetchBytes(SHILLER_FALLBACK_URL);
  const data = readXls(file).find((sheet) => sheet.name.trim() === "Data");
  if (!data) throw new Error("Shiller's file has no Data sheet.");
  return parseShiller(data.rows);
}

// Siblis's free tier: { data: [{ "trading_day (EOD)": "2026-09-30", value: 35.09 }, …] }.
// Its dividend yield for NDX comes back empty, so it is not asked for.
export const SIBLIS_RATIOS: Record<string, string> = { "pe-trailing": "pe", "pe-forward": "pe_forward", cape: "cape" };

export function parseSiblis(payload: unknown): ValuationPoint[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("Siblis answered without data.");
  return data.flatMap((row: Record<string, unknown>): ValuationPoint[] => {
    const date = Object.entries(row).find(([key]) => key.startsWith("trading_day"))?.[1];
    const value = row.value;
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof value === "number" && Number.isFinite(value) && value > 0
      ? [{ date, value: round(value, 3) }]
      : [];
  });
}

export async function fetchSiblis(): Promise<SourceSeries[]> {
  const series: SourceSeries[] = [];
  for (const [ratio, metric] of Object.entries(SIBLIS_RATIOS)) {
    const response = await fetch(`${SIBLIS_URL}/NDX/${ratio}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) throw new Error(`Siblis answered ${response.status} for ${ratio}.`);
    series.push({ index: "ndx", metric, source: "siblis", points: parseSiblis(await response.json()) });
  }
  return series;
}

// The last value of each month, dated that day; plus the latest day itself when the month isn't over.
export function monthEnds(points: ValuationPoint[]): ValuationPoint[] {
  const byMonth = new Map<string, ValuationPoint>();
  for (const point of points) byMonth.set(point.date.slice(0, 7), point);
  return [...byMonth.values()].sort((left, right) => left.date.localeCompare(right.date));
}

// Market value of US corporate equities (NCBEILQ027S, millions of dollars) against GDP (billions, annual rate), in
// percent, for the quarters both have.
export function buffettIndicator(equities: ValuationPoint[], gdp: ValuationPoint[]): ValuationPoint[] {
  const gdpByDate = new Map(gdp.map((point) => [point.date, point.value]));
  return equities.flatMap((point): ValuationPoint[] => {
    const output = gdpByDate.get(point.date);
    return output ? [{ date: quarterEnd(point.date), value: round((point.value / 1000 / output) * 100, 2) }] : [];
  });
}

// FRED dates a quarter by its first day; the value is as of its end.
function quarterEnd(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return monthEnd(year, month + 2);
}

async function fredSeries(id: string, from: string): Promise<ValuationPoint[]> {
  const bytes = await fetchBytes(`${FRED_CSV_URL}?id=${encodeURIComponent(id)}&cosd=${from}`);
  const points = parseFredCsv(new TextDecoder().decode(bytes), id);
  if (!points?.length) throw new Error(`FRED had no data for ${id}.`);
  return points;
}

export async function fetchFred(): Promise<SourceSeries[]> {
  const [sp500, ndx, tenYear, equities, gdp] = await Promise.all([
    fredSeries("SP500", "2000-01-01"),
    fredSeries("NASDAQ100", "1986-01-01"),
    fredSeries("DGS10", "1962-01-01"),
    fredSeries("NCBEILQ027S", "1945-01-01"),
    fredSeries("GDP", "1945-01-01"),
  ]);
  return [
    { index: "sp500", metric: "level", source: "fred", points: monthEnds(sp500) },
    { index: "ndx", metric: "level", source: "fred", points: monthEnds(ndx) },
    { index: "us", metric: "ten_year", source: "fred", points: monthEnds(tenYear) },
    { index: "us", metric: "buffett", source: "fred", points: buffettIndicator(equities, gdp) },
  ];
}

export const SOURCE_FETCHERS: Record<SourceId, () => Promise<SourceSeries[]>> = { shiller: fetchShiller, siblis: fetchSiblis, fred: fetchFred };
