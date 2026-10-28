// Sends Telegram notifications for users' favorites:
//   npm run notify:earnings     — favorites reporting in the next 7 days
//   npm run notify:transcripts  — summaries of favorites' new earnings calls
//   npm run notify:news         — the day's relevant news about favorites
//   npm run notify:filings      — AI analyses of favorites' new SEC filings
// Add -- --dry-run to print the messages instead of sending them.
import { closeDb, isDatabaseConfigured } from "@/lib/db";
import { runEarningsAlerts, runFilingAlerts, runNewsDigest, runTranscriptSummaries, type RunReport } from "@/lib/notifications";
import { isTelegramConfigured } from "@/lib/telegram";

async function main(kind: string | undefined): Promise<number> {
  if (process.argv.includes("--dry-run")) process.env.NOTIFY_DRY_RUN = "1";
  const runs: Record<string, () => Promise<RunReport>> = {
    earnings: () => runEarningsAlerts(),
    transcripts: () => runTranscriptSummaries(),
    news: () => runNewsDigest(),
    filings: () => runFilingAlerts(),
  };
  const run = kind ? runs[kind] : undefined;
  if (!run) {
    console.error(`Usage: tsx scripts/notify.ts ${Object.keys(runs).join("|")}`);
    return 1;
  }
  if (!isTelegramConfigured() || !isDatabaseConfigured()) {
    console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and DATABASE_URL first (see docs/notifications.md).");
    return 1;
  }
  try {
    const report = await run();
    for (const line of report.lines) console.log(line);
    const verb = process.env.NOTIFY_DRY_RUN === "1" ? "printed (dry run, nothing sent)" : "sent";
    console.log(`Done: ${report.sent} message${report.sent === 1 ? "" : "s"} ${verb}.`);
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
