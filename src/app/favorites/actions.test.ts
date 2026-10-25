import { beforeEach, describe, expect, it, vi } from "vitest";

const session = { userId: null as string | null };
vi.mock("@/auth", () => ({ currentUserId: async () => session.userId, signIn: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
const toggle = vi.fn();
vi.mock("@/lib/favorites", () => ({ MAX_FAVORITES: 30, toggleFavorite: (...args: unknown[]) => toggle(...args) }));

const { toggleFavoriteAction } = await import("./actions");

beforeEach(() => {
  session.userId = null;
  toggle.mockReset();
  vi.stubEnv("DATABASE_URL", "postgres://test");
});

describe("toggleFavoriteAction", () => {
  it("needs a signed-in user and a database", async () => {
    await expect(toggleFavoriteAction("AAPL")).resolves.toEqual({ ok: false, error: "Sign in to save favorites." });
    session.userId = "user-1";
    vi.stubEnv("DATABASE_URL", "");
    await expect(toggleFavoriteAction("AAPL")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/DATABASE_URL/) });
    expect(toggle).not.toHaveBeenCalled();
  });

  it("toggles for the session's user, and explains failures", async () => {
    session.userId = "user-1";
    toggle.mockResolvedValueOnce({ ok: true, favorite: true });
    await expect(toggleFavoriteAction("AAPL")).resolves.toEqual({ ok: true, favorite: true });
    expect(toggle).toHaveBeenCalledWith("user-1", "AAPL");

    toggle.mockResolvedValueOnce({ ok: false, reason: "limit" });
    await expect(toggleFavoriteAction("MSFT")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/up to 30/) });

    toggle.mockRejectedValueOnce(new Error("connection refused"));
    await expect(toggleFavoriteAction("MSFT")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/database connection/) });
  });
});
