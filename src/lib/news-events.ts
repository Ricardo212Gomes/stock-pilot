import { addDays } from "./event-sources";
import { getMarketNews, plainTextSummary, safeUrl } from "./finnhub-news";
import { generateGeminiText } from "./gemini";
import { easternToday, marketEvent, type MarketEvent } from "./market-events";

// The events timeline's AI scan: Gemini reads two weeks of headlines about deadlines, summits and votes
// (Google News searches) plus Finnhub's market news, and lists dated events still to come that the
// official calendars don't cover. Every event must come from a headline that gives its date, and links to it.

export const MAX_NEWS_EVENTS = 15;
// Scheduled events rarely sit more than a year out in the news.
const HORIZON_DAYS = 400;
// One scan serves every visitor for a while: the headlines barely change, and each scan costs a request.
const CACHE_MS = 6 * 60 * 60 * 1000;
const RSS_REVALIDATE_SECONDS = 60 * 60;
const SUMMARY_LENGTH = 300;

// Google News searches for the kinds of events the official calendars miss, over the last two weeks.
export const NEWS_QUERIES = [
  "tariff deadline OR \"trade truce\" OR \"trade deal\" OR sanctions deadline when:14d",
  "summit OR G20 OR G7 OR NATO OR APEC leaders meeting when:14d",
  "\"government shutdown\" OR \"funding deadline\" OR \"debt ceiling\" OR \"debt limit\" when:14d",
  "OPEC+ meeting when:14d",
  "\"Supreme Court\" ruling OR arguments tariffs OR \"Federal Reserve\" when:14d",
  "ceasefire OR \"peace talks\" OR negotiations deadline Iran OR Ukraine OR China OR Taiwan when:14d",
];

export const NEWS_EVENT_KINDS = {
  "us-politics": { category: "politics", tag: null },
  geopolitics: { category: "global", tag: "Geopolitics" },
  trade: { category: "global", tag: "Trade" },
  energy: { category: "global", tag: "Energy" },
} as const;

type NewsEventKind = keyof typeof NEWS_EVENT_KINDS;

export type Headline = {
  id: string;
  title: string;
  summary: string;
  // The day it was published, for working out "next Tuesday".
  date: string;
  source: string | null;
  url: string | null;
};

export const NEWS_EVENTS_INSTRUCTIONS = [
  "You read recent news headlines and list scheduled events still to come that could move US markets.",
  "Include an event only when a headline or its summary gives the date: a day it names (\"November 30\", \"on Dec. 2\") or one you can work out from the headline's publication date (\"Sunday meeting\", \"next week's vote\" when the day is clear). When it names only the month (\"in December\"), give the month's first day and set monthOnly. Never use a date you know from elsewhere.",
  "Include trade, tariff and sanctions deadlines; truces or agreements expiring; US government funding and debt-limit deadlines; summits and leaders' meetings; OPEC+ meetings; court hearings and rulings; votes in Congress or parliaments; elections; ceasefire or negotiation deadlines; leadership appointments at central banks.",
  "Leave out company events, conferences and earnings; state, local and single-industry matters (a utility rate case, a city vote); US economic data releases and Federal Reserve meetings (they are listed already); anything that has already happened; and anything without at least a month.",
  `One entry per event, merging headlines about the same one. At most ${MAX_NEWS_EVENTS}, the most market-moving first, and none if nothing qualifies.`,
  "For each give: date and endDate (YYYY-MM-DD; endDate only for events over several days, else an empty string); monthOnly (true when only the month is known); title (under 80 characters, plain and factual, naming who and what); kind (us-politics only for the US federal government: Congress, the White House, US courts and US elections; geopolitics for other countries and international bodies, including the EU and central bank leadership abroad; trade for tariffs, trade deals and sanctions; energy for OPEC+ and oil and gas); importance (high only when it could move the whole market, such as a truce expiring or a shutdown deadline; otherwise medium); why (one sentence on why markets care, using only the headlines); sourceId (the id of the headline that gives the date).",
  "No Markdown, no predictions of the outcome, no investment advice.",
].join(" ");

export const NEWS_EVENTS_SCHEMA = {
  type: "OBJECT",
  properties: {
    events: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          endDate: { type: "STRING" },
          monthOnly: { type: "BOOLEAN" },
          title: { type: "STRING" },
          kind: { type: "STRING", enum: Object.keys(NEWS_EVENT_KINDS) },
          importance: { type: "STRING", enum: ["high", "medium"] },
          why: { type: "STRING" },
          sourceId: { type: "STRING" },
        },
        required: ["date", "title", "kind", "importance", "why", "sourceId"],
      },
    },
  },
  required: ["events"],
};

// Google News RSS items: "Headline - Publisher" titles, a redirect link to the article and the publisher.
export function parseNewsRss(xml: string, idPrefix: string): Headline[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, block], index): Headline[] => {
    const field = (name: string) => plainTextSummary(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? "", 400);
    const source = field("source") || null;
    const fullTitle = field("title");
    const title = source && fullTitle.endsWith(` - ${source}`) ? fullTitle.slice(0, -(source.length + 3)) : fullTitle;
    const published = new Date(field("pubDate"));
    const url = safeUrl(field("link"));
    if (!title || !url || Number.isNaN(published.getTime())) return [];
    return [{ id: `${idPrefix}${index}`, title, summary: "", date: published.toISOString().slice(0, 10), source, url }];
  });
}

async function searchNews(query: string, idPrefix: string): Promise<Headline[]> {
  try {
    const url = `https://news.google.com/rss/search?${new URLSearchParams({ q: query, hl: "en-US", gl: "US", ceid: "US:en" })}`;
    const response = await fetch(url, { next: { revalidate: RSS_REVALIDATE_SECONDS }, signal: AbortSignal.timeout(12_000) });
    return response.ok ? parseNewsRss(await response.text(), idPrefix) : [];
  } catch {
    return [];
  }
}

// Every headline once, by title, the newest first.
export async function collectHeadlines(): Promise<Headline[]> {
  const [market, ...searches] = await Promise.all([
    getMarketNews("general"),
    ...NEWS_QUERIES.map((query, index) => searchNews(query, `g${index}-`)),
  ]);
  const finnhub: Headline[] = market.ok
    ? market.items.map((item) => ({ id: `f-${item.id}`, title: item.title, summary: item.summary, date: item.publishedAt.slice(0, 10), source: item.source, url: item.url }))
    : [];
  const seen = new Set<string>();
  return [...finnhub, ...searches.flat()]
    .filter((headline) => {
      const key = headline.title.toLowerCase();
      return !seen.has(key) && seen.add(key);
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function buildNewsEventsPrompt(headlines: Headline[], today: string): string {
  const list = headlines.map((headline) => ({
    id: headline.id,
    published: headline.date,
    source: headline.source,
    title: headline.title,
    ...(headline.summary ? { summary: headline.summary.slice(0, SUMMARY_LENGTH) } : {}),
  }));
  return `Today is ${today}. Recent headlines:\n\n${JSON.stringify(list)}`;
}

function clean(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

// Gemini's answer as timeline events, keeping only well-formed ones: a date from today to about a year out,
// a headline we actually sent (with a link), and no duplicates. Null when the answer isn't readable.
export function parseNewsEvents(text: string, headlines: Headline[], today: string): MarketEvent[] | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const entries = (payload as { events?: unknown } | null)?.events;
  if (!Array.isArray(entries)) return null;

  const byId = new Map(headlines.map((headline) => [headline.id, headline]));
  const latest = addDays(today, HORIZON_DAYS);
  const seen = new Set<string>();
  return entries.flatMap((entry): MarketEvent[] => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const date = clean(raw.date, 10);
    const endDate = clean(raw.endDate, 10);
    const title = clean(raw.title, 120);
    const headline = byId.get(clean(raw.sourceId, 100));
    const rawKind = clean(raw.kind, 20);
    const kind: NewsEventKind = Object.hasOwn(NEWS_EVENT_KINDS, rawKind) ? (rawKind as NewsEventKind) : "geopolitics";
    const monthOnly = raw.monthOnly === true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date > latest || !title || !headline?.url) return [];
    // A month-only event counts until its month is over.
    const over = monthOnly ? `${addDays(`${date.slice(0, 7)}-28`, 4).slice(0, 7)}-01` <= today : date < today;
    if (over) return [];
    const key = `${date}|${title.toLowerCase()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const { category, tag } = NEWS_EVENT_KINDS[kind];
    return [marketEvent({
      kind: `news-${kind}`,
      date: monthOnly ? `${date.slice(0, 7)}-01` : date,
      monthOnly,
      endDate: !monthOnly && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate > date ? endDate : null,
      category,
      importance: raw.importance === "high" ? "high" : "medium",
      title,
      detail: clean(raw.why, 300) || null,
      tags: tag ? [tag] : [],
      source: { label: headline.source ?? "News", url: headline.url },
      ai: true,
    })];
  }).slice(0, MAX_NEWS_EVENTS);
}

export type NewsEventsResult =
  | { ok: true; events: MarketEvent[]; headlines: number; scannedAt: string }
  | { ok: false; error: string };

let cached: { day: string; at: number; result: NewsEventsResult } | null = null;

// The last scan while it's fresh, so the page can show it without a new request.
export function cachedNewsEvents(now = new Date()): NewsEventsResult | null {
  return cached && cached.day === easternToday(now) && now.getTime() - cached.at < CACHE_MS ? cached.result : null;
}

export async function scanNewsForEvents(now = new Date()): Promise<NewsEventsResult> {
  const today = easternToday(now);
  const fresh = cachedNewsEvents(now);
  if (fresh) return fresh;

  const headlines = await collectHeadlines();
  if (headlines.length === 0) return { ok: false, error: "The news couldn't be loaded. Try again in a moment." };

  const answer = await generateGeminiText({
    instructions: NEWS_EVENTS_INSTRUCTIONS,
    prompt: buildNewsEventsPrompt(headlines, today),
    generationConfig: { temperature: 0.1, maxOutputTokens: 4000, responseMimeType: "application/json", responseSchema: NEWS_EVENTS_SCHEMA },
    subject: "news scan",
    timeoutMs: 90_000,
  });
  if (!answer.ok) return answer;
  const events = parseNewsEvents(answer.text, headlines, today);
  if (!events) return { ok: false, error: "Gemini's answer couldn't be read. Please try again." };

  const result: NewsEventsResult = { ok: true, events, headlines: headlines.length, scannedAt: now.toISOString() };
  cached = { day: today, at: now.getTime(), result };
  return result;
}
