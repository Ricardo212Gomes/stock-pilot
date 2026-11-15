import { addDays, getEarningsWeek, weekStart, type EarningsEvent, type ReportTime } from "./earnings-calendar";
import { listFavorites } from "./favorites";
import { ensureFilingAnalysis, isAlertFiling, type FilingAnalysis } from "./filing-analysis";
import { getCompanyNews } from "./finnhub-news";
import { listedName } from "./listed-companies";
import { CANDIDATES_PER_SYMBOL, selectNews, type NewsCandidate, type NewsPick } from "./news-digest";
import { getFilings, isEarningsRelease, pressReleaseUrl, type Filing } from "./sec-filings";
import { recordNotification } from "./notification-inbox";
import type { NotificationKind, TelegramStatus } from "./notification-kinds";
import { markSent, notificationRecipients, wasSent, type Recipient } from "./notification-settings";
import { getReviewsEnabled, listRecentReviews, summarizeReviews, type Rating, type ReviewSummary } from "./portfolio-reviews";
import { escapeHtml, isTelegramConfigured, sendTelegramMessage } from "./telegram";
import { ensureTranscriptSummary, type TranscriptSummary } from "./transcript-summary";
import { latestReport, quarterLabel, type FiscalQuarter } from "./transcripts";

// Notifications for each user's favorites: upcoming earnings, summaries of new earnings calls, a digest of the news
// that matters, and analyses of new SEC filings; and a weekly summary of the Portfolio's AI reviews. Each one is kept
// in the app (the bell and the Notifications page) and also sent to Telegram when the user has a chat linked and
// Telegram on. Run by `npm run notify:earnings`, `notify:transcripts`, `notify:news`, `notify:filings` and
// `notify:reviews`.

export const EARNINGS_DAYS = 7;
// Only calls this recent count as new; older ones were missed, not news.
export const RECENT_CALL_DAYS = 21;

export type RunReport = { sent: number; lines: string[] };

// With NOTIFY_DRY_RUN=1 (npm run notify:… -- --dry-run), messages are printed instead of sent
// and nothing is marked as sent, so a later real run still delivers them.
function isDryRun(): boolean {
  return process.env.NOTIFY_DRY_RUN === "1";
}

type Delivery = { kind: NotificationKind; title: string; symbols: string[] };
export type Delivered = { ok: true; telegram: TelegramStatus; telegramError?: string } | { ok: false; error: string };

// Keeps the message in the app and sends it to Telegram too when the user has that on. It counts as delivered once
// it's kept, whatever Telegram did (the status says), so a Telegram failure doesn't send it twice in the app. A dry
// run prints it and keeps nothing.
async function deliver(recipient: Recipient, message: string, { kind, title, symbols }: Delivery): Promise<Delivered> {
  if (isDryRun()) {
    const to = recipient.chatId ? `chat ${recipient.chatId.slice(0, 3)}…` : "the app only";
    console.log(`\n--- ${kind} for ${recipient.userId} (${to}): ${title} ---\n${message}\n`);
    return { ok: true, telegram: recipient.chatId ? "sent" : recipient.telegramLinked ? "off" : "not-linked" };
  }
  let telegram: TelegramStatus = recipient.telegramLinked ? "off" : "not-linked";
  let telegramError: string | undefined;
  if (recipient.chatId && isTelegramConfigured()) {
    const sent = await sendTelegramMessage(recipient.chatId, message);
    telegram = sent.ok ? "sent" : "failed";
    if (!sent.ok) telegramError = sent.error;
  }
  try {
    await recordNotification({ userId: recipient.userId, kind, title, body: message, symbols, telegramStatus: telegram });
  } catch {
    return { ok: false, error: "the database didn't save it" };
  }
  return { ok: true, telegram, telegramError };
}

// One line for the run's output: kept in the app, and what Telegram did.
function outcome(delivered: Delivered): string {
  if (!delivered.ok) return `failed (${delivered.error})`;
  return `saved; Telegram ${delivered.telegram}${delivered.telegramError ? ` (${delivered.telegramError})` : ""}`;
}

// "NVDA, AAPL and 3 more"
function symbolList(symbols: string[], shown = 4): string {
  return symbols.length <= shown ? symbols.join(", ") : `${symbols.slice(0, shown).join(", ")} and ${symbols.length - shown} more`;
}

async function record(userId: string, kind: string, item: string): Promise<void> {
  if (!isDryRun()) await markSent(userId, kind, item);
}
// News from the last day; runs are daily, so a little overlap catches late articles.
export const NEWS_HOURS = 26;
// Filings from the last few days count as new; older ones were missed, not news.
export const FILING_DAYS = 3;
// New filings analyzed per company per run, newest first, to bound the AI requests.
const FILINGS_PER_SYMBOL = 3;

const TIME_LABEL: Record<ReportTime, string> = {
  bmo: "before the open",
  amc: "after the close",
  dmh: "during market hours",
  unknown: "time not announced",
};

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

function compactMoney(value: number): string {
  return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
}

// A ticker, linked to its page when the app has a public address (APP_URL).
function tickerLink(symbol: string, path = "/stock"): string {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  const label = `<b>${escapeHtml(symbol)}</b>`;
  return base ? `<a href="${escapeHtml(`${base}${path}?symbol=${encodeURIComponent(symbol)}`)}">${label}</a>` : label;
}

export function earningsMessage(events: EarningsEvent[], from: string, to: string): string | null {
  if (events.length === 0) return null;
  const byDay = new Map<string, EarningsEvent[]>();
  for (const event of [...events].sort((left, right) => left.date.localeCompare(right.date) || left.symbol.localeCompare(right.symbol))) {
    byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]);
  }
  const days = [...byDay].map(([date, dayEvents]) => [
    `<b>${dayLabel(date)}</b>`,
    ...dayEvents.map((event) => {
      const name = listedName(event.symbol) ?? event.name;
      const details = [
        TIME_LABEL[event.time],
        event.epsEstimate !== null ? `EPS est. $${event.epsEstimate.toFixed(2)}` : null,
        event.revenueEstimate !== null ? `revenue est. ${compactMoney(event.revenueEstimate)}` : null,
      ].filter(Boolean).join(" · ");
      return `• ${tickerLink(event.symbol)}${name ? ` ${escapeHtml(name)}` : ""}\n   ${details}`;
    }),
  ].join("\n"));
  return [`📅 <b>Earnings from your favorites</b>\n${dayLabel(from)} – ${dayLabel(to)}`, ...days].join("\n\n");
}

const TONE: Record<TranscriptSummary["tone"], string> = {
  positive: "🟢 Positive tone",
  neutral: "⚪ Neutral tone",
  cautious: "🟡 Cautious tone",
  negative: "🔴 Negative tone",
};

export function transcriptMessage(symbol: string, quarter: FiscalQuarter, summary: TranscriptSummary): string {
  const list = (title: string, items: string[]) => (items.length ? `<b>${title}</b>\n${items.map((item) => `• ${escapeHtml(item)}`).join("\n")}` : null);
  const name = listedName(symbol);
  return [
    `🎙 ${tickerLink(symbol, "/stock/transcripts")} <b>${quarterLabel(quarter)} earnings call</b>\n${name ? `${escapeHtml(name)} · ` : ""}${TONE[summary.tone]}`,
    escapeHtml(summary.overview),
    list("Highlights", summary.highlights),
    list("Outlook", summary.outlook),
    list("What analysts asked", summary.analystQuestions),
    summary.toneReason ? `<i>${escapeHtml(summary.toneReason)}</i>` : null,
    "<i>AI summary of the call transcript. Not investment advice.</i>",
  ].filter(Boolean).join("\n\n");
}

async function favoritesOf(recipients: Recipient[]): Promise<Map<string, string[]>> {
  const favorites = new Map<string, string[]>();
  for (const recipient of recipients) favorites.set(recipient.userId, (await listFavorites(recipient.userId)).map((favorite) => favorite.symbol));
  return favorites;
}

// Each user gets one message listing their favorites that report in the next week.
export async function runEarningsAlerts(today = new Date().toISOString().slice(0, 10)): Promise<RunReport> {
  const report: RunReport = { sent: 0, lines: [] };
  const recipients = await notificationRecipients("earnings");
  if (recipients.length === 0) return { sent: 0, lines: ["No one has earnings alerts on."] };

  const to = addDays(today, EARNINGS_DAYS - 1);
  const weeks = [...new Set([weekStart(today), weekStart(to)])];
  const events: EarningsEvent[] = [];
  for (const start of weeks) {
    const week = await getEarningsWeek(start, false);
    if (!week.ok) return { sent: 0, lines: [`Finnhub's earnings calendar failed (${week.reason}).`] };
    for (const day of week.data.days) for (const group of day.groups) events.push(...group.events);
  }
  const upcoming = events.filter((event) => event.date >= today && event.date <= to);

  const favorites = await favoritesOf(recipients);
  for (const recipient of recipients) {
    const mine = new Set(favorites.get(recipient.userId));
    const reporting = upcoming.filter((event) => mine.has(event.symbol));
    const message = earningsMessage(reporting, today, to);
    if (!message) {
      report.lines.push(`${recipient.userId}: no favorites report by ${to}.`);
      continue;
    }
    const symbols = [...new Set(reporting.map((event) => event.symbol))];
    const sent = await deliver(recipient, message, { kind: "earnings", title: `Earnings in the next week: ${symbolList(symbols)}`, symbols });
    report.lines.push(`${recipient.userId}: ${outcome(sent)}.`);
    if (sent.ok) report.sent += 1;
  }
  return report;
}

// A summary of each favorite's latest earnings call, once, when it's recent and Alpha Vantage has
// the transcript. A call that isn't transcribed yet is tried again on the next run.
export async function runTranscriptSummaries(today = new Date().toISOString().slice(0, 10)): Promise<RunReport> {
  const report: RunReport = { sent: 0, lines: [] };
  const recipients = await notificationRecipients("transcripts");
  if (recipients.length === 0) return { sent: 0, lines: ["No one has transcript summaries on."] };

  const favorites = await favoritesOf(recipients);
  const symbols = [...new Set([...favorites.values()].flat())].sort();
  const oldest = addDays(today, -RECENT_CALL_DAYS);

  for (const symbol of symbols) {
    const { quarter, date } = await latestReport(symbol, today);
    if (!date || date < oldest) {
      report.lines.push(`${symbol}: no call in the last ${RECENT_CALL_DAYS} days.`);
      continue;
    }
    const item = `${symbol}:${quarter}`;
    const waiting: Recipient[] = [];
    for (const recipient of recipients) {
      if (favorites.get(recipient.userId)?.includes(symbol) && !(await wasSent(recipient.userId, "transcript", item))) waiting.push(recipient);
    }
    if (waiting.length === 0) {
      report.lines.push(`${symbol} ${quarter}: already sent.`);
      continue;
    }

    const summary = await ensureTranscriptSummary(symbol, quarter, listedName(symbol) ?? symbol);
    if (!summary.ok) {
      report.lines.push(`${symbol} ${quarter}: not ready (${summary.error})`);
      continue;
    }
    const message = transcriptMessage(symbol, quarter, summary.summary);
    const title = `${symbol} ${quarterLabel(quarter)} earnings call: ${summary.summary.tone} tone`;
    for (const recipient of waiting) {
      const sent = await deliver(recipient, message, { kind: "transcripts", title, symbols: [symbol] });
      if (sent.ok) {
        await record(recipient.userId, "transcript", item);
        report.sent += 1;
      }
      report.lines.push(`${symbol} ${quarter} → ${recipient.userId}: ${outcome(sent)}.`);
    }
  }
  return report;
}

function groupBySymbol<T extends { symbol: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.symbol, [...(groups.get(item.symbol) ?? []), item]);
  return groups;
}

export function newsMessage(picks: NewsPick[], aiSelected: boolean): string | null {
  if (picks.length === 0) return null;
  const sections = [...groupBySymbol(picks)].map(([symbol, items]) => {
    const name = listedName(symbol);
    return [
      `${tickerLink(symbol, "/news")}${name ? ` ${escapeHtml(name)}` : ""}`,
      ...items.map((item) => {
        const title = escapeHtml(item.title);
        const headline = item.url ? `<a href="${escapeHtml(item.url)}">${title}</a>` : title;
        return `• ${headline}${item.source ? ` · ${escapeHtml(item.source)}` : ""}${item.why ? `\n   ${escapeHtml(item.why)}` : ""}`;
      }),
    ].join("\n");
  });
  return [
    `📰 <b>News on your favorites</b>\n${aiSelected ? "Picked by AI from the last day's headlines" : "The latest headlines"}`,
    ...sections,
  ].join("\n\n");
}

const SENTIMENT: Record<FilingAnalysis["sentiment"], string> = {
  positive: "🟢 Positive for shareholders",
  neutral: "⚪ Neutral for shareholders",
  negative: "🔴 Negative for shareholders",
};

// documentUrl: the press release for an earnings 8-K, since that's what was analyzed.
export function filingMessage(symbol: string, filing: Filing, analysis: FilingAnalysis, documentUrl = filing.documentUrl): string {
  const list = (title: string, items: string[]) => (items.length ? `<b>${title}</b>\n${items.map((item) => `• ${escapeHtml(item)}`).join("\n")}` : null);
  const name = listedName(symbol);
  return [
    `🗂 ${tickerLink(symbol, "/stock/filings")} <b>filed ${/^8/.test(filing.form) ? "an" : "a"} ${escapeHtml(filing.form)}</b> · ${escapeHtml(filing.description)}\n${name ? `${escapeHtml(name)} · ` : ""}${SENTIMENT[analysis.sentiment]}`,
    `<b>${escapeHtml(analysis.headline)}</b>\n${escapeHtml(analysis.summary)}`,
    list("Key points", analysis.keyPoints),
    list("What to watch", analysis.watch),
    `<a href="${escapeHtml(documentUrl)}">${documentUrl === filing.documentUrl ? "Read the filing" : "Read the press release"} on sec.gov</a>`,
    "<i>AI analysis of the filing. Not investment advice.</i>",
  ].filter(Boolean).join("\n\n");
}

// One digest per user: Gemini picks the headlines about their favorites that matter, each sent once.
export async function runNewsDigest(now = new Date()): Promise<RunReport> {
  const report: RunReport = { sent: 0, lines: [] };
  const recipients = await notificationRecipients("news");
  if (recipients.length === 0) return { sent: 0, lines: ["No one has news alerts on."] };

  const since = new Date(now.getTime() - NEWS_HOURS * 3_600_000).toISOString();
  const favorites = await favoritesOf(recipients);
  const newsBySymbol = new Map<string, NewsCandidate[]>();
  for (const symbol of new Set([...favorites.values()].flat())) {
    const news = await getCompanyNews(symbol, now);
    if (!news.ok) {
      report.lines.push(`${symbol}: news failed (${news.reason}).`);
      continue;
    }
    newsBySymbol.set(symbol, news.items
      .filter((item) => item.publishedAt >= since)
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, CANDIDATES_PER_SYMBOL)
      .map((item) => ({ id: item.id, symbol, title: item.title, summary: item.summary, source: item.source, url: item.url, publishedAt: item.publishedAt })));
  }

  for (const recipient of recipients) {
    const candidates: NewsCandidate[] = [];
    const seen = new Set<string>();
    for (const symbol of favorites.get(recipient.userId) ?? []) {
      for (const item of newsBySymbol.get(symbol) ?? []) {
        if (seen.has(item.id) || (await wasSent(recipient.userId, "news", item.id))) continue;
        seen.add(item.id);
        candidates.push(item);
      }
    }
    const { picks, aiSelected } = await selectNews(candidates);
    const message = newsMessage(picks, aiSelected);
    if (!message) {
      report.lines.push(`${recipient.userId}: nothing relevant among ${candidates.length} new headlines.`);
      continue;
    }
    const symbols = [...new Set(picks.map((pick) => pick.symbol))];
    const title = `${picks.length} headline${picks.length === 1 ? "" : "s"} on ${symbolList(symbols)}`;
    const sent = await deliver(recipient, message, { kind: "news", title, symbols });
    if (sent.ok) {
      for (const pick of picks) await record(recipient.userId, "news", pick.id);
      report.sent += 1;
    }
    report.lines.push(`${recipient.userId}: ${sent.ok ? `${picks.length} of ${candidates.length} headlines, ${outcome(sent)}` : outcome(sent)}.`);
  }
  return report;
}

// An AI analysis of each favorite's new 10-K, 10-Q or significant 8-K, sent once per user.
export async function runFilingAlerts(today = new Date().toISOString().slice(0, 10)): Promise<RunReport> {
  const report: RunReport = { sent: 0, lines: [] };
  const recipients = await notificationRecipients("filings");
  if (recipients.length === 0) return { sent: 0, lines: ["No one has filing alerts on."] };

  const favorites = await favoritesOf(recipients);
  const oldest = addDays(today, -FILING_DAYS);
  for (const symbol of [...new Set([...favorites.values()].flat())].sort()) {
    const result = await getFilings(symbol);
    if (!result.ok) {
      report.lines.push(`${symbol}: filings failed (${result.reason}).`);
      continue;
    }
    const recent = result.data.filings.filter((filing) => isAlertFiling(filing) && filing.filed >= oldest).slice(0, FILINGS_PER_SYMBOL);
    if (recent.length === 0) {
      report.lines.push(`${symbol}: no new filings to analyze.`);
      continue;
    }
    for (const filing of recent) {
      const waiting: Recipient[] = [];
      for (const recipient of recipients) {
        if (favorites.get(recipient.userId)?.includes(symbol) && !(await wasSent(recipient.userId, "filing", filing.accession))) waiting.push(recipient);
      }
      if (waiting.length === 0) continue;

      const analysis = await ensureFilingAnalysis(symbol, listedName(symbol) ?? result.data.name ?? symbol, filing);
      if (!analysis.ok) {
        report.lines.push(`${symbol} ${filing.form} ${filing.filed}: not analyzed (${analysis.error})`);
        continue;
      }
      const release = isEarningsRelease(filing) ? await pressReleaseUrl(filing) : null;
      const message = filingMessage(symbol, filing, analysis.analysis, release ?? filing.documentUrl);
      const title = `${symbol} filed ${/^8/.test(filing.form) ? "an" : "a"} ${filing.form}: ${analysis.analysis.headline}`;
      for (const recipient of waiting) {
        const sent = await deliver(recipient, message, { kind: "filings", title, symbols: [symbol] });
        if (sent.ok) {
          await record(recipient.userId, "filing", filing.accession);
          report.sent += 1;
        }
        report.lines.push(`${symbol} ${filing.form} ${filing.filed} → ${recipient.userId}: ${outcome(sent)}.`);
      }
    }
  }
  return report;
}

// --- Weekly summary of the Portfolio's AI reviews --------------------------------------------------------

// A rating counts as changed this week when its latest review is this recent and differs from the one before.
export const REVIEW_WEEK_DAYS = 7;

const REVIEW_GROUPS: { title: string; ratings: Rating[] }[] = [
  { title: "Underweight or Sell", ratings: ["Sell", "Underweight"] },
  { title: "Hold", ratings: ["Hold", "Review"] },
  { title: "Overweight or Buy", ratings: ["Overweight", "Buy"] },
];

// The plan's first sentence, for the holdings worth a closer look.
function firstSentence(text: string, limit = 180): string {
  const sentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length > limit ? `${sentence.slice(0, limit - 1).trimEnd()}…` : sentence;
}

function ratingLabel(rating: Rating): string {
  return rating === "Review" ? "No rating" : rating;
}

// One message: what changed this week, then every reviewed holding, Underweight and Sell first, each linking to
// its report when the app has a public address. Null with no reviews. Plain code over the stored ratings: the
// AI's work is the reviews themselves.
export function reviewsMessage(summaries: ReviewSummary[], today: string): string | null {
  if (summaries.length === 0) return null;
  const since = addDays(today, -REVIEW_WEEK_DAYS);
  const changed = summaries.filter((review) => review.previousRating && review.previousRating !== review.rating && review.analysisDate > since);
  const lines = [`<b>AI reviews of your portfolio</b> · ${dayLabel(today)}`];
  if (changed.length > 0) {
    lines.push("", "<b>Changed this week</b>");
    for (const review of changed) {
      lines.push(`• ${tickerLink(review.symbol, "/portfolio/review")}: ${ratingLabel(review.previousRating!)} → <b>${ratingLabel(review.rating)}</b>`);
    }
  }
  for (const group of REVIEW_GROUPS) {
    const reviews = summaries.filter((review) => group.ratings.includes(review.rating));
    if (reviews.length === 0) continue;
    lines.push("", `<b>${group.title}</b>`);
    for (const review of reviews) {
      const target = review.priceTarget === null ? "" : ` · target $${review.priceTarget.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
      const stale = review.stale ? " (old)" : "";
      lines.push(`• ${tickerLink(review.symbol, "/portfolio/review")} ${ratingLabel(review.rating)}${target} · ${dayLabel(review.analysisDate)}${stale}`);
      // The plan for the ones to look at; the rest keep to one line.
      if (group.ratings.includes("Sell")) lines.push(`  ${escapeHtml(firstSentence(review.summary))}`);
    }
  }
  lines.push("", `<i>${summaries.length} holding${summaries.length === 1 ? "" : "s"} reviewed by TradingAgents' AI agents. Not investment advice.</i>`);
  return lines.join("\n");
}

// Each user with the reviews on and the summary turned on gets one message a week, on Sundays.
export async function runReviewSummaries(today = new Date().toISOString().slice(0, 10)): Promise<RunReport> {
  const report: RunReport = { sent: 0, lines: [] };
  const recipients = await notificationRecipients("reviews");
  if (recipients.length === 0) return { sent: 0, lines: ["No one has the weekly AI reviews on."] };

  const week = weekStart(today);
  for (const recipient of recipients) {
    if (await wasSent(recipient.userId, "reviews", week)) {
      report.lines.push(`${recipient.userId}: already sent for the week of ${week}.`);
      continue;
    }
    if (!(await getReviewsEnabled(recipient.userId))) {
      report.lines.push(`${recipient.userId}: the Portfolio's AI reviews are off.`);
      continue;
    }
    const summaries = summarizeReviews(await listRecentReviews(recipient.userId), today);
    const message = reviewsMessage(summaries, today);
    if (!message) {
      report.lines.push(`${recipient.userId}: no reviews yet.`);
      continue;
    }
    const sent = await deliver(recipient, message, {
      kind: "reviews",
      title: `Weekly AI reviews of your portfolio: ${summaries.length} holding${summaries.length === 1 ? "" : "s"}`,
      symbols: summaries.map((review) => review.symbol),
    });
    if (sent.ok) {
      await record(recipient.userId, "reviews", week);
      report.sent += 1;
    }
    report.lines.push(`${recipient.userId}: ${outcome(sent)}.`);
  }
  return report;
}
