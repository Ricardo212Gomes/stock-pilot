import { addDays, getEarningsWeek, weekStart, type EarningsEvent, type ReportTime } from "./earnings-calendar";
import { listFavorites } from "./favorites";
import { listedName } from "./listed-companies";
import { markSent, notificationRecipients, wasSent, type Recipient } from "./notification-settings";
import { escapeHtml, sendTelegramMessage } from "./telegram";
import { ensureTranscriptSummary, type TranscriptSummary } from "./transcript-summary";
import { latestReport, quarterLabel, type FiscalQuarter } from "./transcripts";

// Telegram notifications for each user's favorites: upcoming earnings, and summaries of new
// earnings calls. Run by `npm run notify:earnings` and `npm run notify:transcripts`.

export const EARNINGS_DAYS = 7;
// Only calls this recent count as new; older ones were missed, not news.
export const RECENT_CALL_DAYS = 21;

export type RunReport = { sent: number; lines: string[] };

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
  if (recipients.length === 0) return { sent: 0, lines: ["No one has earnings alerts on with Telegram connected."] };

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
    const message = earningsMessage(upcoming.filter((event) => mine.has(event.symbol)), today, to);
    if (!message) {
      report.lines.push(`${recipient.userId}: no favorites report by ${to}.`);
      continue;
    }
    const sent = await sendTelegramMessage(recipient.chatId, message);
    report.lines.push(`${recipient.userId}: ${sent.ok ? "sent" : `failed (${sent.error})`}.`);
    if (sent.ok) report.sent += 1;
  }
  return report;
}

// A summary of each favorite's latest earnings call, once, when it's recent and Alpha Vantage has
// the transcript. A call that isn't transcribed yet is tried again on the next run.
export async function runTranscriptSummaries(today = new Date().toISOString().slice(0, 10)): Promise<RunReport> {
  const report: RunReport = { sent: 0, lines: [] };
  const recipients = await notificationRecipients("transcripts");
  if (recipients.length === 0) return { sent: 0, lines: ["No one has transcript summaries on with Telegram connected."] };

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
    for (const recipient of waiting) {
      const sent = await sendTelegramMessage(recipient.chatId, message);
      if (sent.ok) {
        await markSent(recipient.userId, "transcript", item);
        report.sent += 1;
      }
      report.lines.push(`${symbol} ${quarter} → ${recipient.userId}: ${sent.ok ? "sent" : `failed (${sent.error})`}.`);
    }
  }
  return report;
}
