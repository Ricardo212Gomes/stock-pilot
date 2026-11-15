import { beforeEach, describe, expect, it, vi } from "vitest";

const session = { userId: null as string | null };
vi.mock("@/auth", () => ({ currentUserId: async () => session.userId }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
const inbox = { markRead: vi.fn(async () => 1), unreadCount: vi.fn(async () => 2), latestNotifications: vi.fn(async () => [
  { id: "1", kind: "news", title: "2 headlines on NVDA", body: "<b>secret body</b>", symbols: ["NVDA"], telegramStatus: "sent", createdAt: "2026-11-15T10:00:00.000Z", read: false },
]) };
vi.mock("@/lib/notification-inbox", () => inbox);

const { markAllReadAction, markReadAction, refreshBellAction } = await import("./inbox-actions");

beforeEach(() => {
  session.userId = null;
  Object.values(inbox).forEach((mock) => mock.mockClear());
  vi.stubEnv("DATABASE_URL", "postgres://test");
});

describe("inbox actions", () => {
  it("need a signed-in user", async () => {
    await expect(markReadAction(["1"])).resolves.toEqual({ ok: false });
    await expect(refreshBellAction()).resolves.toEqual({ ok: false });
    expect(inbox.markRead).not.toHaveBeenCalled();
  });

  it("mark the session user's notifications, never another user's", async () => {
    session.userId = "u1";
    await markReadAction(["1", "2"]);
    expect(inbox.markRead).toHaveBeenCalledWith("u1", ["1", "2"]);
    await markAllReadAction();
    expect(inbox.markRead).toHaveBeenLastCalledWith("u1", "all");
  });

  it("gives the bell titles and the count, without the messages", async () => {
    session.userId = "u1";
    const state = await refreshBellAction();
    expect(state).toMatchObject({ ok: true, unread: 2 });
    expect(JSON.stringify(state)).not.toContain("secret body");
    expect(inbox.latestNotifications).toHaveBeenCalledWith("u1");
  });
});
