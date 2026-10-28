import { beforeEach, describe, expect, it, vi } from "vitest";

const gemini = vi.fn();
vi.mock("./gemini", () => ({ generateGeminiText: (...args: unknown[]) => gemini(...args) }));
const { parsePicks, selectNews } = await import("./news-digest");

const item = (id: string, symbol: string, publishedAt: string) => ({ id, symbol, title: `Title ${id}`, summary: "Summary", source: "Reuters", url: `https://example.com/${id}`, publishedAt });
const candidates = [item("1", "CRWD", "2026-10-28T10:00:00Z"), item("2", "CRWD", "2026-10-28T12:00:00Z"), item("3", "CRWD", "2026-10-28T14:00:00Z"), item("4", "AAPL", "2026-10-28T09:00:00Z")];

beforeEach(() => gemini.mockReset());

describe("parsePicks", () => {
  it("keeps known articles once, in Gemini's order, with the reason", () => {
    const text = JSON.stringify({ picks: [{ id: "3", why: "Raised   guidance." }, { id: "99", why: "x" }, { id: "3", why: "dup" }, { id: "4", why: "" }] });
    expect(parsePicks(text, candidates)?.map((pick) => [pick.id, pick.why])).toEqual([["3", "Raised guidance."], ["4", null]]);
    expect(parsePicks("nope", candidates)).toBeNull();
  });
});

describe("selectNews", () => {
  it("uses Gemini's picks, and falls back to the newest two per company", async () => {
    gemini.mockResolvedValueOnce({ ok: true, text: JSON.stringify({ picks: [{ id: "1", why: "Deal." }] }) });
    await expect(selectNews(candidates)).resolves.toMatchObject({ aiSelected: true, picks: [{ id: "1", why: "Deal." }] });

    // Both attempts fail.
    gemini.mockResolvedValue({ ok: false, error: "limit" });
    const fallback = await selectNews(candidates);
    expect(gemini).toHaveBeenCalledTimes(3);
    expect(fallback.aiSelected).toBe(false);
    expect(fallback.picks.map((pick) => pick.id)).toEqual(["3", "2", "4"]);
    await expect(selectNews([])).resolves.toEqual({ picks: [], aiSelected: false });
  });
});
