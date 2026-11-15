// The kinds of notification, their labels and where each one leads. Plain data, shared by the server and the bell.

export const NOTIFICATION_KINDS = ["earnings", "transcripts", "news", "filings", "reviews"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

export const KIND_LABEL: Record<NotificationKind, string> = {
  earnings: "Upcoming earnings",
  transcripts: "Earnings call",
  news: "News",
  filings: "SEC filing",
  reviews: "AI reviews",
};

// What happened on Telegram: sent, failed, no chat linked, or turned off by the user.
export type TelegramStatus = "sent" | "failed" | "not-linked" | "off";

export const TELEGRAM_STATUS_LABEL: Record<TelegramStatus, string> = {
  sent: "Also sent to Telegram",
  failed: "Telegram failed",
  "not-linked": "Telegram not connected",
  off: "Telegram off",
};

// The page a notification opens: the company's tab when it's about one company, else the kind's own page.
export function notificationHref(kind: NotificationKind, symbols: string[]): string {
  const one = symbols.length === 1 ? `?symbol=${encodeURIComponent(symbols[0])}` : "";
  switch (kind) {
    case "earnings":
      return "/earnings";
    case "transcripts":
      return one ? `/stock/transcripts${one}` : "/favorites";
    case "news":
      return one ? `/news${one}` : "/favorites";
    case "filings":
      return one ? `/stock/filings${one}` : "/favorites";
    case "reviews":
      return "/portfolio";
  }
}

// The unread badge: the count up to nine, then "9+".
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? "9+" : String(count);
}

// "5 min ago", "3 h ago", "2 days ago", then the date.
export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}
