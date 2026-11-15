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

const {
  cleanSave,
  createSavedProjection,
  deleteSavedProjection,
  getSavedProjection,
  listSavedProjections,
  renameSavedProjection,
  updateSavedProjection,
  MAX_SAVED_PROJECTIONS,
} = await import("./saved-projections");

const input = {
  tool: "plumas-projection",
  symbol: " nvda ",
  name: "  NVDA ·  Plumas ",
  note: "",
  inputs: { scenarios: {} },
  baseYear: 2025,
  priceAtSave: 180.5,
  valueAtSave: [{ id: "base", label: "Base", value: 250 }, { id: "bad" }],
  currency: "USD",
};

const row = {
  id: "7",
  tool: "plumas-projection",
  symbol: "NVDA",
  name: "NVDA · Plumas",
  note: null,
  schema_version: 1,
  base_year: 2025,
  price_at_save: "180.5",
  value_at_save: [{ id: "base", label: "Base", value: 250 }],
  currency: "USD",
  created_at: new Date("2026-11-14T10:00:00Z"),
  updated_at: new Date("2026-11-14T11:00:00Z"),
};

beforeEach(() => {
  queries.length = 0;
  answers = [];
});

describe("cleanSave", () => {
  it("tidies the name, ticker and values", () => {
    const result = cleanSave(input);
    expect(result).toMatchObject({ ok: true, save: { tool: "plumas-projection", symbol: "NVDA", name: "NVDA · Plumas", note: null, baseYear: 2025, priceAtSave: 180.5 } });
    if (result.ok) expect(JSON.parse(result.save.valueAtSave)).toEqual([{ id: "base", label: "Base", value: 250 }]);
  });

  it("refuses an unknown tool, a bad ticker, no name or no inputs", () => {
    expect(cleanSave({ ...input, tool: "dcf-calculator" })).toMatchObject({ ok: false });
    expect(cleanSave({ ...input, symbol: "not a ticker!" })).toMatchObject({ ok: false });
    expect(cleanSave({ ...input, name: "   " })).toMatchObject({ ok: false, message: expect.stringMatching(/name/) });
    expect(cleanSave({ ...input, name: "x".repeat(81) })).toMatchObject({ ok: false });
    expect(cleanSave({ ...input, inputs: [1, 2] })).toMatchObject({ ok: false });
    expect(cleanSave({ ...input, inputs: { big: "x".repeat(70_000) } })).toMatchObject({ ok: false, message: expect.stringMatching(/too large/) });
  });
});

describe("saved projections", () => {
  it("lists a user's saves, for one company and tool when asked", async () => {
    answers = [[row]];
    const list = await listSavedProjections("user-1", { symbol: "NVDA", tool: "plumas-projection" });
    expect(list).toEqual([expect.objectContaining({ id: "7", priceAtSave: 180.5, updatedAt: "2026-11-14T11:00:00.000Z" })]);
    expect(list[0]).not.toHaveProperty("inputs");
    expect(queries[0].text).toMatch(/where user_id = \?/);
    expect(queries[0].values.slice(0, 5)).toEqual(["user-1", "NVDA", "NVDA", "plumas-projection", "plumas-projection"]);
  });

  it("opens one of the user's own saves, and nothing for a bad id", async () => {
    answers = [[{ ...row, inputs: { scenarios: {} } }]];
    await expect(getSavedProjection("user-1", "7")).resolves.toMatchObject({ id: "7", inputs: { scenarios: {} } });
    expect(queries[0].values).toEqual(["user-1", "7"]);
    await expect(getSavedProjection("user-1", "7; drop table")).resolves.toBeNull();
    expect(queries).toHaveLength(1);
  });

  it("creates a save under the limit and refuses one over it", async () => {
    answers = [[{ count: 3 }], [{ id: 8 }]];
    await expect(createSavedProjection("user-1", input)).resolves.toEqual({ ok: true, id: "8" });
    expect(queries[1].text).toMatch(/^insert into saved_projections/);
    expect(queries[1].values.slice(0, 4)).toEqual(["user-1", "plumas-projection", "NVDA", "NVDA · Plumas"]);

    answers = [[{ count: MAX_SAVED_PROJECTIONS }]];
    await expect(createSavedProjection("user-1", input)).resolves.toMatchObject({ ok: false, reason: "limit" });
  });

  it("updates, renames and deletes only the user's own save", async () => {
    answers = [[{ id: 7 }]];
    await expect(updateSavedProjection("user-1", "7", input)).resolves.toEqual({ ok: true, id: "7" });
    expect(queries[0].text).toMatch(/where user_id = \? and id = \? and tool = \? and symbol = \?/);

    answers = [[]];
    await expect(updateSavedProjection("user-2", "7", input)).resolves.toMatchObject({ ok: false, reason: "not-found" });

    answers = [[{ id: 7 }]];
    await expect(renameSavedProjection("user-1", "7", " Bull run ")).resolves.toEqual({ ok: true, id: "7" });
    expect(queries.at(-1)?.values).toEqual(["Bull run", "user-1", "7"]);
    await expect(renameSavedProjection("user-1", "7", "")).resolves.toMatchObject({ ok: false, reason: "invalid" });

    answers = [[{ id: 7 }]];
    await expect(deleteSavedProjection("user-1", "7")).resolves.toBe(true);
    await expect(deleteSavedProjection("user-1", "abc")).resolves.toBe(false);
  });
});
