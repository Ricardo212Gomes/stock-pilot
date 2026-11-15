import { describe, expect, it } from "vitest";
import { badgeLabel, isNotificationKind, notificationHref, timeAgo } from "./notification-kinds";

describe("notification kinds", () => {
  it("opens the company's tab for one company, else the kind's page", () => {
    expect(notificationHref("filings", ["NVDA"])).toBe("/stock/filings?symbol=NVDA");
    expect(notificationHref("transcripts", ["BRK.B"])).toBe("/stock/transcripts?symbol=BRK.B");
    expect(notificationHref("news", ["AAPL"])).toBe("/news?symbol=AAPL");
    expect(notificationHref("news", ["AAPL", "MSFT"])).toBe("/favorites");
    expect(notificationHref("earnings", ["AAPL"])).toBe("/earnings");
    expect(notificationHref("reviews", ["AAPL"])).toBe("/portfolio");
  });

  it("shows the unread count up to nine", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(3)).toBe("3");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(12)).toBe("9+");
  });

  it("says how long ago, then the date", () => {
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(timeAgo("2026-11-15T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-11-15T11:15:00Z", now)).toBe("45 min ago");
    expect(timeAgo("2026-11-15T07:00:00Z", now)).toBe("5 h ago");
    expect(timeAgo("2026-11-14T12:00:00Z", now)).toBe("1 day ago");
    expect(timeAgo("2026-10-01T12:00:00Z", now)).toBe("1 Oct 2026");
    expect(isNotificationKind("filings")).toBe(true);
    expect(isNotificationKind("alerts")).toBe(false);
  });
});
