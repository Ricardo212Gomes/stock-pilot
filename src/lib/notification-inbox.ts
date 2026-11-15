import { getSql } from "./db";
import { isNotificationKind, type NotificationKind, type TelegramStatus } from "./notification-kinds";

// The notifications kept in StockPilot for the bell and the Notifications page (docs/notifications.md): every
// message sent, with what happened on Telegram, read or not. Every query is for one user, from the session.

export const PAGE_SIZE = 25;
export const BELL_SIZE = 10;
// Removed daily by npm run notifications:prune. The sent log lasts longer: it stops resends, and no kind looks back
// further than three weeks.
export const NOTIFICATION_RETENTION_DAYS = Number(process.env.NOTIFICATION_RETENTION_DAYS) || 90;
export const LOG_RETENTION_DAYS = 180;

export type InboxNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  symbols: string[];
  telegramStatus: TelegramStatus;
  createdAt: string;
  read: boolean;
};

type Row = {
  id: string | number;
  kind: string;
  title: string;
  body: string;
  symbols: string[] | null;
  telegram_status: TelegramStatus;
  created_at: Date;
  read_at: Date | null;
};

function toNotification(row: Row): InboxNotification {
  return {
    id: String(row.id),
    kind: isNotificationKind(row.kind) ? row.kind : "news",
    title: row.title,
    body: row.body,
    symbols: row.symbols ?? [],
    telegramStatus: row.telegram_status,
    createdAt: row.created_at.toISOString(),
    read: row.read_at !== null,
  };
}

// Ids are bigints; anything else from the browser is dropped.
function cleanIds(ids: unknown[]): string[] {
  return ids.filter((id): id is string => typeof id === "string" && /^\d{1,18}$/.test(id)).slice(0, 100);
}

export async function recordNotification(input: {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  symbols: string[];
  telegramStatus: TelegramStatus;
}): Promise<string> {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 200);
  const [row] = await getSql()<{ id: string | number }[]>`
    insert into notifications (user_id, kind, title, body, symbols, telegram_status)
    values (${input.userId}, ${input.kind}, ${title}, ${input.body}, ${input.symbols}, ${input.telegramStatus})
    returning id
  `;
  return String(row.id);
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await getSql()<{ count: number }[]>`
    select count(*)::int as count from notifications where user_id = ${userId} and read_at is null
  `;
  return row?.count ?? 0;
}

// The bell's list: the latest few, newest first.
export async function latestNotifications(userId: string, limit = BELL_SIZE): Promise<InboxNotification[]> {
  const rows = await getSql()<Row[]>`
    select id, kind, title, body, symbols, telegram_status, created_at, read_at from notifications
    where user_id = ${userId} order by created_at desc, id desc limit ${limit}
  `;
  return rows.map(toNotification);
}

export type HistoryFilter = { kind?: NotificationKind | null; symbol?: string | null; page?: number };

// The Notifications page: one page of 25, newest first, by kind and company.
export async function listNotifications(userId: string, filter: HistoryFilter = {}): Promise<{ items: InboxNotification[]; total: number }> {
  const kind = filter.kind ?? null;
  const symbol = filter.symbol ?? null;
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const sql = getSql();
  const [rows, [{ count }]] = await Promise.all([
    sql<Row[]>`
      select id, kind, title, body, symbols, telegram_status, created_at, read_at from notifications
      where user_id = ${userId}
        and (${kind}::text is null or kind = ${kind})
        and (${symbol}::text is null or ${symbol} = any(symbols))
      order by created_at desc, id desc
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}
    `,
    sql<{ count: number }[]>`
      select count(*)::int as count from notifications
      where user_id = ${userId}
        and (${kind}::text is null or kind = ${kind})
        and (${symbol}::text is null or ${symbol} = any(symbols))
    `,
  ]);
  return { items: rows.map(toNotification), total: count };
}

// The companies the user has notifications about, for the filter.
export async function notificationSymbols(userId: string): Promise<string[]> {
  const rows = await getSql()<{ symbol: string }[]>`
    select distinct unnest(symbols) as symbol from notifications where user_id = ${userId} order by symbol
  `;
  return rows.map((row) => row.symbol);
}

// Marks the user's own notifications as read: the ones given, or all of them. Returns how many changed.
export async function markRead(userId: string, ids: unknown[] | "all"): Promise<number> {
  const sql = getSql();
  if (ids === "all") {
    const rows = await sql`update notifications set read_at = now() where user_id = ${userId} and read_at is null returning id`;
    return rows.length;
  }
  const clean = cleanIds(ids);
  if (clean.length === 0) return 0;
  const rows = await sql`
    update notifications set read_at = now()
    where user_id = ${userId} and read_at is null and id = any(${clean}::bigint[])
    returning id
  `;
  return rows.length;
}

export type PruneResult = { notifications: number; log: number; notificationsBefore: string; logBefore: string };

function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Removes notifications older than the retention and sent-log rows older than 180 days; a dry run only counts.
export async function pruneNotifications({
  now = new Date(),
  retentionDays = NOTIFICATION_RETENTION_DAYS,
  logDays = LOG_RETENTION_DAYS,
  dryRun = false,
}: { now?: Date; retentionDays?: number; logDays?: number; dryRun?: boolean } = {}): Promise<PruneResult> {
  const notificationsBefore = daysBefore(now, retentionDays);
  const logBefore = daysBefore(now, Math.max(logDays, retentionDays));
  const sql = getSql();
  if (dryRun) {
    const [[old], [oldLog]] = await Promise.all([
      sql<{ count: number }[]>`select count(*)::int as count from notifications where created_at < ${notificationsBefore}`,
      sql<{ count: number }[]>`select count(*)::int as count from notification_log where sent_at < ${logBefore}`,
    ]);
    return { notifications: old.count, log: oldLog.count, notificationsBefore, logBefore };
  }
  const removed = await sql`delete from notifications where created_at < ${notificationsBefore} returning id`;
  const removedLog = await sql`delete from notification_log where sent_at < ${logBefore} returning user_id`;
  return { notifications: removed.length, log: removedLog.length, notificationsBefore, logBefore };
}
