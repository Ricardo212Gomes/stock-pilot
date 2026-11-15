import type { NotificationKind } from "@/lib/notification-kinds";

// One outline icon per kind, in the sidebar's style: calendar, microphone, newspaper, document, spark.
const PATHS: Record<NotificationKind, string> = {
  earnings: "M4 5.5h12v10.5H4zM4 8.5h12M7.5 3.5v3M12.5 3.5v3M7 11.5h2M11 11.5h2M7 13.5h2",
  transcripts: "M10 3.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0V6A2.5 2.5 0 0 1 10 3.5ZM5.5 9.5a4.5 4.5 0 0 0 9 0M10 14v2.5M7.5 16.5h5",
  news: "M4 4.5h9.5v11H5.5A1.5 1.5 0 0 1 4 14V4.5ZM13.5 7.5H16v6.5a1.5 1.5 0 0 1-3 0M6.5 7.5h4.5M6.5 10h4.5M6.5 12.5h3",
  filings: "M6 3.5h5.5L15 7v9.5H6zM11.5 3.5V7H15M8 10h5M8 12.5h5",
  reviews: "M10 3.5l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5zM15 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
};

export function NotificationIcon({ kind }: { kind: NotificationKind }) {
  return (
    <svg className="notification-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={PATHS[kind]} />
    </svg>
  );
}
