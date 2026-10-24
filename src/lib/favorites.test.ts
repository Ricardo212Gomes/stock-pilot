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

const { listFavorites, toggleFavorite, MAX_FAVORITES } = await import("./favorites");

beforeEach(() => {
  queries.length = 0;
  answers = [];
});

describe("favorites", () => {
  it("lists a user's favorites newest first", async () => {
    answers = [[{ symbol: "AAPL", created_at: new Date("2026-10-24T10:00:00Z") }]];
    await expect(listFavorites("user-1")).resolves.toEqual([{ symbol: "AAPL", createdAt: "2026-10-24T10:00:00.000Z" }]);
    expect(queries[0].text).toMatch(/where user_id = \? order by created_at desc/);
    expect(queries[0].values).toEqual(["user-1"]);
  });

  it("removes a favorite that exists", async () => {
    answers = [[{ symbol: "AAPL" }]];
    await expect(toggleFavorite("user-1", " aapl ")).resolves.toEqual({ ok: true, favorite: false });
    expect(queries).toHaveLength(1);
    expect(queries[0].values).toEqual(["user-1", "AAPL"]);
  });

  it("adds a new favorite under the limit, and refuses one over it", async () => {
    answers = [[], [{ count: 2 }], []];
    await expect(toggleFavorite("user-1", "MSFT")).resolves.toEqual({ ok: true, favorite: true });
    expect(queries[2].text).toMatch(/^insert into favorites/);
    expect(queries[2].values).toEqual(["user-1", "MSFT"]);

    queries.length = 0;
    answers = [[], [{ count: MAX_FAVORITES }]];
    await expect(toggleFavorite("user-1", "NVDA")).resolves.toEqual({ ok: false, reason: "limit" });
    expect(queries.some((query) => query.text.startsWith("insert"))).toBe(false);
  });

  it("rejects invalid tickers without touching the database", async () => {
    await expect(toggleFavorite("user-1", "<script>")).resolves.toEqual({ ok: false, reason: "invalid-symbol" });
    expect(queries).toHaveLength(0);
  });
});
