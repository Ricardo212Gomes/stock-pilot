import { describe, expect, it, vi } from "vitest";
import type { Filing } from "../sec-filings";
import { loadRecentFilings, pickRecentFilings, type FilingsDeps } from "./filings";

function filing(form: string, filed: string, items: string[] = [], description = form): Filing {
  return { accession: `${form}-${filed}`, form, filed, period: null, items, description, documentUrl: "", indexUrl: "" };
}

const LIST: Filing[] = [
  filing("4", "2026-11-14", [], "Insider trade"),
  filing("8-K", "2026-11-12", ["2.02", "9.01"], "Earnings results"),
  filing("10-Q", "2026-11-05", [], "Quarterly report"),
  filing("DEF 14A", "2026-10-30", [], "Proxy statement for the shareholder meeting"),
  filing("8-K", "2026-10-20", ["5.02"], "Executive or director change"),
  filing("8-K", "2026-10-18", ["8.01"], "Other events"),
  filing("S-3ASR", "2026-10-17", [], "Shelf registration for securities"),
  filing("10-K", "2026-09-01", [], "Annual report"),
];

describe("pickRecentFilings", () => {
  it("keeps the last 30 days' important filings, newest first, at most five", () => {
    expect(pickRecentFilings(LIST, "2026-11-16").map(({ form, filed }) => `${form} ${filed}`)).toEqual([
      "8-K 2026-11-12",
      "10-Q 2026-11-05",
      "DEF 14A 2026-10-30",
      "8-K 2026-10-20",
      "8-K 2026-10-18",
    ]);
    expect(pickRecentFilings(LIST, "2026-11-16", 11).map(({ form }) => form)).toEqual(["8-K", "10-Q"]);
  });
});

describe("loadRecentFilings", () => {
  function deps(overrides: Partial<FilingsDeps> = {}): FilingsDeps {
    return {
      filings: async () => ({ ok: true, data: { name: "Test", cik: "1", filings: LIST } }),
      analysis: async (accession) => (accession === "10-Q-2026-11-05" ? { headline: "", summary: "Margins widened.", keyPoints: [], watch: [], sentiment: "positive" } : null),
      space: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("adds stored analyses for holdings only, waiting its turn for SEC", async () => {
    const held = deps();
    const rows = await loadRecentFilings("TEST", true, "2026-11-16", held);
    expect(held.space).toHaveBeenCalledTimes(1);
    expect(rows?.[1]).toEqual({ form: "10-Q", filed: "2026-11-05", description: "Quarterly report", analysis: "Margins widened." });
    expect(rows?.[0]).not.toHaveProperty("analysis");
    const notHeld = await loadRecentFilings("TEST", false, "2026-11-16", deps());
    expect(notHeld?.some((row) => row.analysis)).toBe(false);
  });

  it("is empty for a company EDGAR doesn't know, and null when EDGAR fails", async () => {
    await expect(loadRecentFilings("ASML", false, "2026-11-16", deps({ filings: async () => ({ ok: false, reason: "not-found" }) }))).resolves.toEqual([]);
    await expect(loadRecentFilings("TEST", false, "2026-11-16", deps({ filings: async () => ({ ok: false, reason: "provider-error" }) }))).resolves.toBeNull();
  });
});
