import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny stand-in for the postgres tagged template: records each query and answers from a list.
const queries: { text: string; values: unknown[] }[] = [];
let answers: unknown[][] = [];
vi.mock("./db", () => ({
  getSql: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(answers.shift() ?? []);
  },
}));

const { latestNotifications, listNotifications, markRead, pruneNotifications, recordNotification, unreadCount } = await import("./notification-inbox");

beforeEach(() => {
  queries.length = 0;
  answers = [];
});

const row = { id: 7, kind: "filings", title: "NVDA filed an 8-K", body: "<b>x</b>", symbols: ["NVDA"], telegram_status: "sent", created_at: new Date("2026-11-12T22:30:00Z"), read_at: null };

describe("notification inbox", () => {
  it("records a message for its user", async () => {
    answers = [[{ id: 42 }]];
    await expect(recordNotification({ userId: "u1", kind: "filings", title: "  NVDA  filed\nan 8-K ", body: "<b>x</b>", symbols: ["NVDA"], telegramStatus: "not-linked" })).resolves.toBe("42");
    expect(queries[0].text).toMatch(/^insert into notifications/);
    expect(queries[0].values).toEqual(["u1", "filings", "NVDA filed an 8-K", "<b>x</b>", ["NVDA"], "not-linked"]);
  });

  it("counts unread and lists the latest, for one user", async () => {
    answers = [[{ count: 3 }], [row]];
    await expect(unreadCount("u1")).resolves.toBe(3);
    expect(queries[0].text).toMatch(/where user_id = \? and read_at is null/);
    const [item] = await latestNotifications("u1");
    expect(item).toEqual({ id: "7", kind: "filings", title: "NVDA filed an 8-K", body: "<b>x</b>", symbols: ["NVDA"], telegramStatus: "sent", createdAt: "2026-11-12T22:30:00.000Z", read: false });
    expect(queries[1].values).toEqual(["u1", 10]);
  });

  it("pages and filters the history", async () => {
    answers = [[row], [{ count: 26 }]];
    const result = await listNotifications("u1", { kind: "filings", symbol: "NVDA", page: 2 });
    expect(result.total).toBe(26);
    expect(queries[0].values).toEqual(["u1", "filings", "filings", "NVDA", "NVDA", 25, 25]);
  });

  it("marks only the user's own notifications as read, and ignores bad ids", async () => {
    answers = [[{ id: 1 }]];
    await expect(markRead("u1", ["1", "2; drop table notifications", 3])).resolves.toBe(1);
    expect(queries[0].text).toMatch(/where user_id = \? and read_at is null and id = any\(\?::bigint\[\]\)/);
    expect(queries[0].values).toEqual(["u1", ["1"]]);

    await expect(markRead("u1", ["nope"])).resolves.toBe(0);
    expect(queries).toHaveLength(1);

    answers = [[{ id: 1 }, { id: 2 }]];
    await expect(markRead("u2", "all")).resolves.toBe(2);
    expect(queries[1].values).toEqual(["u2"]);
  });

  it("prunes notifications after 90 days and the sent log after 180, or only counts on a dry run", async () => {
    const now = new Date("2026-11-15T04:00:00Z");
    answers = [[{ id: 1 }, { id: 2 }], [{ user_id: "u1" }]];
    await expect(pruneNotifications({ now })).resolves.toEqual({
      notifications: 2,
      log: 1,
      notificationsBefore: "2026-08-17T04:00:00.000Z",
      logBefore: "2026-05-19T04:00:00.000Z",
    });
    expect(queries[0].text).toBe("delete from notifications where created_at < ? returning id");
    expect(queries[1].text).toBe("delete from notification_log where sent_at < ? returning user_id");

    queries.length = 0;
    answers = [[{ count: 5 }], [{ count: 0 }]];
    await expect(pruneNotifications({ now, dryRun: true })).resolves.toMatchObject({ notifications: 5, log: 0 });
    expect(queries.every((query) => query.text.startsWith("select count(*)"))).toBe(true);

    // The sent log never goes before the notifications it guards.
    answers = [[], []];
    await expect(pruneNotifications({ now, retentionDays: 365, logDays: 180 })).resolves.toMatchObject({ logBefore: "2025-11-15T04:00:00.000Z" });
  });
});
