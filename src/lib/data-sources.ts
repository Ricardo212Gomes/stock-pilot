import { rememberedRestrictions } from "./fmp";
import { providerEvents, type ProviderEvents, type ProviderId } from "./provider-status";

// The Data sources card in Settings: which sources are set up, what each is used for, its free plan's limits,
// and what it has said lately (since the server started): a limit reached, a failure, or a fallback that
// stood in. The keys themselves are never shown. docs/data-sources.md explains which source is used when.

type Source = {
  name: string;
  configured: boolean;
  usedFor: string;
  limits: string;
  events?: ProviderId;
  note?: string;
};

export type SourceStatus = Omit<Source, "events"> & { status: string; tone: "ok" | "warning" | "off" };

const RECENT_MS = 24 * 60 * 60 * 1000;

function time(at: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(at));
}

function describe(source: Source, events: ProviderEvents | null, now: number): Pick<SourceStatus, "status" | "tone"> {
  if (!source.configured) return { status: "Not set up", tone: "off" };
  if (events?.limitedAt && now - events.limitedAt < RECENT_MS) return { status: `Limit reached at ${time(events.limitedAt)} ET`, tone: "warning" };
  if (events?.failedAt && now - events.failedAt < RECENT_MS) return { status: `Failed at ${time(events.failedAt)} ET (${events.failure})`, tone: "warning" };
  return { status: "Working", tone: "ok" };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function dataSourceStatuses(now = Date.now(), env: Record<string, string | undefined> = process.env): SourceStatus[] {
  const restrictions = rememberedRestrictions(now);
  const tiingo = providerEvents("tiingo");
  const sources: Source[] = [
    {
      name: "Financial Modeling Prep",
      configured: Boolean(env.FMP_API_KEY),
      usedFor: "The Overview's quote and statistics, statements, price targets, estimates, rating changes, dividends, leaderboards, the VIX quote.",
      limits: "Free: 250 requests a day, and a sample of large companies.",
      events: "fmp",
      note: restrictions > 0 ? `${plural(restrictions, "request")} the plan refuses, remembered for a day so they aren't sent again.` : undefined,
    },
    {
      name: "Finnhub",
      configured: Boolean(env.FINNHUB_API_KEY),
      usedFor: "Quotes on company headers, lists and the Portfolio, analyst ratings, the earnings calendar, news, insider trades, earnings surprises, growth rates.",
      limits: "Free: 60 requests a minute, every US stock.",
      events: "finnhub",
    },
    {
      name: "Tiingo",
      configured: Boolean(env.TIINGO_API_KEY),
      usedFor: "The Overview chart, the Portfolio's prices, splits and dividends, and daily prices when FMP can't give them.",
      limits: "Free: 50 requests an hour, 1,000 a day, 500 stocks a month.",
      events: "tiingo",
      note: tiingo.fallbacks > 0 ? `Stood in for FMP ${plural(tiingo.fallbacks, "time")} since the server started.` : undefined,
    },
    {
      name: "Frankfurter",
      configured: true,
      usedFor: "Euro exchange rates (the ECB's) for portfolios kept in euros or with trades in euros.",
      limits: "Free, no key.",
      events: "frankfurter",
    },
    {
      name: "SEC EDGAR",
      configured: true,
      usedFor: "Filings, Form 4 insider filings, and statements when FMP doesn't cover a company.",
      limits: "Free, no key: 10 requests a second.",
    },
    {
      name: "Gemini",
      configured: Boolean(env.GEMINI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY),
      usedFor: "AI reviews, call summaries, valuation autofill, the events news scan, notification digests.",
      limits: "Free tier: limited requests a minute and a day.",
    },
    {
      name: "Alpha Vantage",
      configured: Boolean(env.ALPHAVANTAGE_API_KEY),
      usedFor: "Earnings call transcripts, each fetched once and saved.",
      limits: "Free: 25 requests a day.",
    },
    {
      name: "Postgres",
      configured: Boolean(env.DATABASE_URL),
      usedFor: "Favorites, portfolio trades, saved transcripts and summaries, notification settings.",
      limits: "Your database's plan.",
    },
  ];
  return sources.map(({ events, ...source }) => ({ ...source, ...describe(source, events ? providerEvents(events) : null, now) }));
}
