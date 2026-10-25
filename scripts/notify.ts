// Sends Telegram notifications for users' favorites:
//   npm run notify:earnings     — favorites reporting in the next 7 days
//   npm run notify:transcripts  — summaries of favorites' new earnings calls
import { closeDb, isDatabaseConfigured } from "@/lib/db";
import { runEarningsAlerts, runTranscriptSummaries } from "@/lib/notifications";
import { isTelegramConfigured } from "@/lib/telegram";

async function main(kind: string | undefined): Promise<number> {
  if (kind !== "earnings" && kind !== "transcripts") {
    console.error("Usage: tsx scripts/notify.ts earnings|transcripts");
    return 1;
  }
  if (!isTelegramConfigured() || !isDatabaseConfigured()) {
    console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and DATABASE_URL first (see docs/notifications.md).");
    return 1;
  }
  try {
    const report = kind === "earnings" ? await runEarningsAlerts() : await runTranscriptSummaries();
    for (const line of report.lines) console.log(line);
    console.log(`Done: ${report.sent} message${report.sent === 1 ? "" : "s"} sent.`);
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
