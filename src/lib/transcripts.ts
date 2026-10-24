import { getSql, isDatabaseConfigured } from "./db";
import { addDays } from "./earnings-calendar";
import { fetchFinnhub } from "./finnhub";

// Earnings call transcripts from Alpha Vantage. Its free key allows 25 requests a day and one a
// second, so every answer is saved (in Postgres when DATABASE_URL is set) and fetched only once.

export type TranscriptSegment = {
  speaker: string;
  title: string | null;
  content: string;
  // Alpha Vantage's sentiment score, from -1 (negative) to 1 (positive).
  sentiment: number | null;
};

// A fiscal quarter as Alpha Vantage and Finnhub label it: "2026Q2" is fiscal 2026's second quarter.
export type FiscalQuarter = `${number}Q${1 | 2 | 3 | 4}`;

export type TranscriptFailureReason = "not-configured" | "rate-limited" | "unavailable" | "provider-error";

export type TranscriptResult =
  | { ok: true; segments: TranscriptSegment[] }
  | { ok: false; reason: TranscriptFailureReason };

const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
// A missing transcript is asked for again after a day; Alpha Vantage adds calls some time after
// them. Older quarters it doesn't have are unlikely to appear, so they wait a week.
export const EMPTY_RETRY_MS = 24 * 60 * 60 * 1000;
export const OLD_EMPTY_RETRY_MS = 7 * EMPTY_RETRY_MS;
// The free key refuses more than one request a second.
const REQUEST_SPACING_MS = 1100;

export function isFiscalQuarter(value: unknown): value is FiscalQuarter {
  return typeof value === "string" && /^\d{4}Q[1-4]$/.test(value);
}

export function quarterLabel(quarter: FiscalQuarter): string {
  return `FY${quarter.slice(0, 4)} Q${quarter.slice(5)}`;
}

export function previousQuarter(quarter: FiscalQuarter): FiscalQuarter {
  const year = Number(quarter.slice(0, 4));
  const number = Number(quarter.slice(5));
  return (number === 1 ? `${year - 1}Q4` : `${year}Q${number - 1}`) as FiscalQuarter;
}

// The given quarter and the ones before it, newest first.
export function recentQuarters(latest: FiscalQuarter, count = 8): FiscalQuarter[] {
  const quarters = [latest];
  while (quarters.length < count) quarters.push(previousQuarter(quarters[quarters.length - 1]));
  return quarters;
}

// The last fiscal quarter that should have had its call. Finnhub's free earnings calendar knows a
// company's next report and its fiscal quarter; the one before it is the latest reported. Without
// it, the calendar quarter before today's is a fair guess.
export async function latestReportedQuarter(symbol: string, today = new Date().toISOString().slice(0, 10)): Promise<FiscalQuarter> {
  const result = await fetchFinnhub("calendar/earnings", { symbol, from: addDays(today, -100), to: addDays(today, 120) }, 60 * 60 * 6);
  const rows = result.ok ? (result.payload as { earningsCalendar?: unknown })?.earningsCalendar : null;
  if (Array.isArray(rows)) {
    const reports = rows
      .map((row) => row as { date?: unknown; year?: unknown; quarter?: unknown })
      .filter((row) => typeof row.date === "string" && Number.isInteger(row.year) && Number.isInteger(row.quarter))
      .map((row) => ({ date: row.date as string, quarter: `${row.year}Q${row.quarter}` }))
      .filter((row): row is { date: string; quarter: FiscalQuarter } => isFiscalQuarter(row.quarter))
      .sort((left, right) => left.date.localeCompare(right.date));
    const past = reports.filter((row) => row.date <= today);
    if (past.length) return past[past.length - 1].quarter;
    if (reports.length) return previousQuarter(reports[0].quarter);
  }
  const month = Number(today.slice(5, 7));
  const current = `${today.slice(0, 4)}Q${Math.ceil(month / 3)}` as FiscalQuarter;
  return previousQuarter(current);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseTranscript(payload: unknown): TranscriptResult {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "provider-error" };
  const record = payload as Record<string, unknown>;
  // Alpha Vantage answers limits and bad requests with status 200 and a message instead of data.
  if (typeof record.Information === "string" || typeof record.Note === "string") return { ok: false, reason: "rate-limited" };
  if (!Array.isArray(record.transcript)) return { ok: false, reason: "provider-error" };
  const segments = record.transcript.flatMap((item): TranscriptSegment[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const content = text(row.content);
    if (!content) return [];
    const sentiment = Number(row.sentiment);
    return [{
      speaker: text(row.speaker) ?? "Unknown speaker",
      title: text(row.title),
      content,
      sentiment: row.sentiment !== undefined && row.sentiment !== "" && Number.isFinite(sentiment) ? sentiment : null,
    }];
  });
  return segments.length ? { ok: true, segments } : { ok: false, reason: "unavailable" };
}

type Saved = { segments: TranscriptSegment[]; fetchedAt: number };
// Used when there's no database, and as a fallback when it can't be reached.
const memory = new Map<string, Saved>();
let lastRequestAt = 0;

async function readSaved(symbol: string, quarter: FiscalQuarter): Promise<Saved | null> {
  if (isDatabaseConfigured()) {
    try {
      const [row] = await getSql()<{ segments: TranscriptSegment[]; fetched_at: Date }[]>`
        select segments, fetched_at from transcripts where symbol = ${symbol} and quarter = ${quarter}
      `;
      if (row) return { segments: row.segments, fetchedAt: row.fetched_at.getTime() };
    } catch {
      // Fall through to the in-memory copy.
    }
  }
  return memory.get(`${symbol}:${quarter}`) ?? null;
}

async function save(symbol: string, quarter: FiscalQuarter, segments: TranscriptSegment[]): Promise<void> {
  memory.set(`${symbol}:${quarter}`, { segments, fetchedAt: Date.now() });
  if (!isDatabaseConfigured()) return;
  try {
    const sql = getSql();
    await sql`
      insert into transcripts (symbol, quarter, segments, fetched_at)
      values (${symbol}, ${quarter}, ${sql.json(segments)}, now())
      on conflict (symbol, quarter) do update set segments = excluded.segments, fetched_at = now()
    `;
  } catch {
    // The memory copy still saves the request until the server restarts.
  }
}

export async function getTranscript(
  symbol: string,
  quarter: FiscalQuarter,
  { emptyRetryMs = EMPTY_RETRY_MS, now = Date.now() }: { emptyRetryMs?: number; now?: number } = {},
): Promise<TranscriptResult> {
  const saved = await readSaved(symbol, quarter);
  if (saved?.segments.length) return { ok: true, segments: saved.segments };
  if (saved && now - saved.fetchedAt < emptyRetryMs) return { ok: false, reason: "unavailable" };

  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!apiKey) return { ok: false, reason: "not-configured" };

  const wait = lastRequestAt + REQUEST_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  const url = new URL(ALPHA_VANTAGE_URL);
  url.searchParams.set("function", "EARNINGS_CALL_TRANSCRIPT");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("quarter", quarter);
  url.searchParams.set("apikey", apiKey);
  let result: TranscriptResult;
  try {
    // Not the Next.js data cache: limit messages arrive with status 200 and must not be kept.
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return { ok: false, reason: response.status === 429 ? "rate-limited" : "provider-error" };
    result = parseTranscript(await response.json());
  } catch {
    return { ok: false, reason: "provider-error" };
  }

  if (result.ok) await save(symbol, quarter, result.segments);
  else if (result.reason === "unavailable") await save(symbol, quarter, []);
  return result;
}

// Which of these quarters are already known to have a transcript, or to have none. Lets the page
// mark missing quarters without spending requests on them.
export async function savedQuarters(symbol: string, quarters: FiscalQuarter[]): Promise<Map<FiscalQuarter, boolean>> {
  const known = new Map<FiscalQuarter, boolean>();
  for (const quarter of quarters) {
    const saved = memory.get(`${symbol}:${quarter}`);
    if (saved) known.set(quarter, saved.segments.length > 0);
  }
  if (!isDatabaseConfigured()) return known;
  try {
    const rows = await getSql()<{ quarter: FiscalQuarter; available: boolean }[]>`
      select quarter, jsonb_array_length(segments) > 0 as available
      from transcripts where symbol = ${symbol} and quarter in ${getSql()(quarters)}
    `;
    for (const row of rows) known.set(row.quarter, row.available);
  } catch {
    // Without the database, only this server's memory is known.
  }
  return known;
}

export function transcriptFailureMessage(reason: TranscriptFailureReason, quarter: FiscalQuarter): string {
  switch (reason) {
    case "not-configured":
      return "Transcripts come from Alpha Vantage. Add ALPHAVANTAGE_API_KEY to the environment file and restart the server.";
    case "rate-limited":
      return "Alpha Vantage's free limit has been reached (25 requests a day, one a second). Transcripts already loaded still open; try new ones tomorrow.";
    case "unavailable":
      return `Alpha Vantage doesn't have the ${quarterLabel(quarter)} call. New calls usually appear some days after they happen, and some companies' recent calls are missing; try another quarter.`;
    default:
      return "Alpha Vantage couldn't return this transcript. Try again in a moment.";
  }
}
