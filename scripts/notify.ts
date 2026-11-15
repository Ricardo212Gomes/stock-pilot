// Makes notifications for users' favorites, kept in the app and also sent to Telegram (docs/notifications.md):
//   npm run notify:earnings     — favorites reporting in the next 7 days
//   npm run notify:transcripts  — summaries of favorites' new earnings calls
//   npm run notify:news         — the day's relevant news about favorites
//   npm run notify:filings      — AI analyses of favorites' new SEC filings
//   npm run notify:reviews      — the weekly summary of the Portfolio's AI reviews
// Add -- --dry-run to print the messages instead of keeping and sending them.
import { closeDb, isDatabaseConfigured } from "@/lib/db";
import { runEarningsAlerts, runFilingAlerts, runNewsDigest, runReviewSummaries, runTranscriptSummaries, type RunReport } from "@/lib/notifications";
import { isTelegramConfigured } from "@/lib/telegram";

async function main(kind: string | undefined): Promise<number> {
  if (process.argv.includes("--dry-run")) process.env.NOTIFY_DRY_RUN = "1";
  const runs: Record<string, () => Promise<RunReport>> = {
    earnings: () => runEarningsAlerts(),
    transcripts: () => runTranscriptSummaries(),
    news: () => runNewsDigest(),
    filings: () => runFilingAlerts(),
    reviews: () => runReviewSummaries(),
  };
  const run = kind ? runs[kind] : undefined;
  if (!run) {
    console.error(`Usage: tsx scripts/notify.ts ${Object.keys(runs).join("|")}`);
    return 1;
  }
  if (!isDatabaseConfigured()) {
    console.error("Set DATABASE_URL first (see docs/notifications.md).");
    return 1;
  }
  // Notifications are kept in the app either way; Telegram is the second channel.
  if (!isTelegramConfigured()) console.log("Telegram isn't set up (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME): notifications go to the app only.");
  try {
    const report = await run();
    for (const line of report.lines) console.log(line);
    const verb = process.env.NOTIFY_DRY_RUN === "1" ? "printed (dry run, nothing kept or sent)" : "delivered";
    console.log(`Done: ${report.sent} notification${report.sent === 1 ? "" : "s"} ${verb}.`);
    return 0;
  } finally {
    await closeDb();
  }
}

main(process.argv[2]).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
