// Removes old notifications (docs/notifications.md), run daily by .github/workflows/notifications-prune.yml:
//   npm run notifications:prune              — delete notifications older than 90 days (NOTIFICATION_RETENTION_DAYS)
//                                              and sent-log rows older than 180 days
//   npm run notifications:prune -- --dry-run — count them without deleting
import { closeDb, isDatabaseConfigured } from "@/lib/db";
import { pruneNotifications } from "@/lib/notification-inbox";

async function main(): Promise<number> {
  if (!isDatabaseConfigured()) {
    console.error("Set DATABASE_URL first (see docs/notifications.md).");
    return 1;
  }
  const dryRun = process.argv.includes("--dry-run");
  try {
    const result = await pruneNotifications({ dryRun });
    const verb = dryRun ? "would remove" : "removed";
    console.log(`Notifications from before ${result.notificationsBefore.slice(0, 10)}: ${verb} ${result.notifications}.`);
    console.log(`Sent-log rows from before ${result.logBefore.slice(0, 10)}: ${verb} ${result.log}.`);
    return 0;
  } finally {
    await closeDb();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
