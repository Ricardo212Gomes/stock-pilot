import { beforeEach, describe, expect, it, vi } from "vitest";

const session = { userId: null as string | null };
vi.mock("@/auth", () => ({ currentUserId: async () => session.userId }));
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
const store = { create: vi.fn(), update: vi.fn(), rename: vi.fn(), remove: vi.fn() };
vi.mock("@/lib/saved-projections", () => ({
  createSavedProjection: (...args: unknown[]) => store.create(...args),
  updateSavedProjection: (...args: unknown[]) => store.update(...args),
  renameSavedProjection: (...args: unknown[]) => store.rename(...args),
  deleteSavedProjection: (...args: unknown[]) => store.remove(...args),
}));

const { deleteProjectionAction, renameProjectionAction, saveProjectionAction } = await import("./saved-actions");

const input = { tool: "jeremy-projection", symbol: "AAPL", name: "AAPL · Jeremy", note: "", inputs: {}, baseYear: 2026, priceAtSave: 200, valueAtSave: [], currency: "USD" };

beforeEach(() => {
  session.userId = null;
  refresh.mockReset();
  Object.values(store).forEach((mock) => mock.mockReset());
  vi.stubEnv("DATABASE_URL", "postgres://test");
});

describe("saved projection actions", () => {
  it("need a signed-in user and a database", async () => {
    await expect(saveProjectionAction(input)).resolves.toEqual({ ok: false, error: "Sign in to save projections." });
    session.userId = "user-1";
    vi.stubEnv("DATABASE_URL", "");
    await expect(saveProjectionAction(input)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/DATABASE_URL/) });
    expect(store.create).not.toHaveBeenCalled();
  });

  it("creates a save, or updates one with an id, for the session's user", async () => {
    session.userId = "user-1";
    store.create.mockResolvedValueOnce({ ok: true, id: "9" });
    await expect(saveProjectionAction(input)).resolves.toEqual({ ok: true, id: "9" });
    expect(store.create).toHaveBeenCalledWith("user-1", input);
    expect(refresh).toHaveBeenCalledTimes(1);

    store.update.mockResolvedValueOnce({ ok: true, id: "9" });
    await expect(saveProjectionAction({ ...input, id: "9" })).resolves.toEqual({ ok: true, id: "9" });
    expect(store.update).toHaveBeenCalledWith("user-1", "9", expect.objectContaining({ name: "AAPL · Jeremy" }));
  });

  it("passes on the store's reasons and database failures", async () => {
    session.userId = "user-1";
    store.create.mockResolvedValueOnce({ ok: false, reason: "limit", message: "You can keep up to 300 saved projections." });
    await expect(saveProjectionAction(input)).resolves.toEqual({ ok: false, error: "You can keep up to 300 saved projections." });
    store.create.mockRejectedValueOnce(new Error("connection refused"));
    await expect(saveProjectionAction(input)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/database connection/) });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renames and deletes", async () => {
    session.userId = "user-1";
    store.rename.mockResolvedValueOnce({ ok: true, id: "9" });
    await expect(renameProjectionAction("9", "New")).resolves.toEqual({ ok: true, id: "9" });
    expect(store.rename).toHaveBeenCalledWith("user-1", "9", "New");
    store.remove.mockResolvedValueOnce(false);
    await expect(deleteProjectionAction("9")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
    store.remove.mockResolvedValueOnce(true);
    await expect(deleteProjectionAction("9")).resolves.toEqual({ ok: true, id: "9" });
  });
});
