import { fetchFinnhub, finnhubFailureMessage, finnhubSymbol, type FinnhubFailureReason } from "./finnhub";

// News moves quickly, but a short cache still keeps repeat visits well under the rate limit.
const NEWS_REVALIDATE_SECONDS = 60 * 15;
export const COMPANY_NEWS_DAYS = 14;
const SUMMARY_LENGTH = 280;
export const NEWS_PAGE_SIZE = 25;

export const NEWS_CATEGORIES = [
  { id: "general", label: "Markets" },
  { id: "merger", label: "Mergers & acquisitions" },
  { id: "forex", label: "Forex" },
  { id: "crypto", label: "Crypto" },
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number]["id"];

export type NewsFailureReason = FinnhubFailureReason;

export type NewsItem = {
  id: string;
  title: string;
  // ISO 8601 in UTC, converted from Finnhub's Unix timestamp.
  publishedAt: string;
  summary: string;
  url: string | null;
  source: string | null;
  category: string | null;
  tickers: string[];
};

export type NewsResult =
  | { ok: true; items: NewsItem[] }
  | { ok: false; reason: NewsFailureReason };


// Kept for the news page; the message itself lives with the shared Finnhub client.
export const newsFailureMessage = finnhubFailureMessage;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (ENTITIES[lower]) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return match;
  });
}

// Some summaries arrive as HTML. They are shown as plain text, never as markup.
export function plainTextSummary(html: unknown, limit = SUMMARY_LENGTH): string {
  if (typeof html !== "string") return "";
  const text = decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|li|h\d)>/gi, ". ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?])(\s*\.)+/g, "$1")
    .trim();

  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), limit / 2)).replace(/[\s.,;:]+$/, "")}…`;
}

export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// "AAPL,MSFT" → ["AAPL", "MSFT"]
export function parseTickers(value: unknown): string[] {
  const raw = typeof value === "string" ? value : "";
  const tickers = raw
    .split(/[,;\s]+/)
    .map((part) => part.split(":").pop()?.trim().toUpperCase() ?? "")
    .filter((ticker) => /^[A-Z0-9.-]{1,15}$/.test(ticker));
  return [...new Set(tickers)];
}

// The merger feed mixes in translated wire copies; this app's interface is English.
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? decodeEntities(value.trim()) : null;
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeItem(row: unknown): NewsItem | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const headline = text(record.headline);
  const seconds = typeof record.datetime === "number" ? record.datetime : Number(record.datetime);
  if (!headline || CJK.test(headline) || !Number.isFinite(seconds) || seconds <= 0) return null;

  // Aggregated wire stories end in " - Reuters"; the source is already shown beside the time.
  const source = text(record.source);
  const suffix = source ? ` - ${source}` : null;
  const title = suffix && headline.toLowerCase().endsWith(suffix.toLowerCase())
    ? headline.slice(0, -suffix.length).trim()
    : headline;
  // Some feeds repeat the headline as the summary; showing it twice adds nothing.
  const rawSummary = plainTextSummary(record.summary);
  const summary = comparable(rawSummary).startsWith(comparable(title)) ? "" : rawSummary;

  const url = safeUrl(record.url);
  return {
    id: String(record.id ?? url ?? `${seconds}-${title}`),
    title,
    publishedAt: new Date(seconds * 1000).toISOString(),
    summary,
    url,
    source,
    category: text(record.category),
    tickers: parseTickers(record.related),
  };
}

function newestFirst(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return [...items]
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .filter((item) => {
      const key = item.url ?? item.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function fetchNews(endpoint: string, params: Record<string, string>): Promise<NewsResult> {
  const result = await fetchFinnhub(endpoint, params, NEWS_REVALIDATE_SECONDS);
  if (!result.ok) return result;
  if (!Array.isArray(result.payload)) return { ok: false, reason: "provider-error" };

  const items = result.payload.flatMap((row) => {
    const item = normalizeItem(row);
    return item ? [item] : [];
  });
  return { ok: true, items: newestFirst(items) };
}

export function isNewsCategory(value: unknown): value is NewsCategory {
  return NEWS_CATEGORIES.some((category) => category.id === value);
}

export function getMarketNews(category: NewsCategory = "general"): Promise<NewsResult> {
  return fetchNews("news", { category });
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getCompanyNews(symbol: string, today = new Date()): Promise<NewsResult> {
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - COMPANY_NEWS_DAYS);
  return fetchNews("company-news", {
    symbol: finnhubSymbol(symbol),
    from: isoDay(from),
    to: isoDay(today),
  });
}

export function paginate<T>(items: T[], page: number, size = NEWS_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(page, 0), pageCount - 1);
  return { items: items.slice(current * size, (current + 1) * size), page: current, pageCount };
}
