import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSummaryPrompt, getSavedSummary, parseSummary, saveSummary } from "./transcript-summary";

const reply = {
  overview: "Revenue grew **21%** to $1.47 billion.",
  highlights: ["- Net new ARR of $250 million.", "Record free cash flow.", "", "4", "5", "6", "7"],
  outlook: ["Guides FY27 revenue to $5.9 billion."],
  analystQuestions: ["Pricing pressure: management sees none."],
  tone: "positive",
  toneReason: "Management raised guidance.",
};

beforeEach(() => vi.stubEnv("DATABASE_URL", ""));
afterEach(() => vi.unstubAllEnvs());

describe("parseSummary", () => {
  it("cleans Markdown and bullets, and caps each list", () => {
    const summary = parseSummary(`\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``)!;
    expect(summary.overview).toBe("Revenue grew 21% to $1.47 billion.");
    expect(summary.highlights).toEqual(["Net new ARR of $250 million.", "Record free cash flow.", "4", "5", "6"]);
    expect(summary).toMatchObject({ tone: "positive", outlook: ["Guides FY27 revenue to $5.9 billion."] });
  });

  it("falls back to a neutral tone and rejects replies without an overview", () => {
    expect(parseSummary(JSON.stringify({ ...reply, tone: "ecstatic" }))?.tone).toBe("neutral");
    expect(parseSummary(JSON.stringify({ ...reply, overview: "" }))).toBeNull();
    expect(parseSummary("not json")).toBeNull();
  });
});

describe("buildSummaryPrompt", () => {
  it("labels each speaker and cuts very long calls", () => {
    const prompt = buildSummaryPrompt({
      company: "CrowdStrike",
      quarterLabel: "FY2026 Q4",
      segments: [
        { speaker: "Operator", title: "Operator", content: "Welcome.", sentiment: null },
        { speaker: "George Kurtz", title: "CEO", content: "x".repeat(130_000), sentiment: 0.5 },
      ],
    });
    expect(prompt).toMatch(/^Summarize CrowdStrike's FY2026 Q4 earnings call\./);
    expect(prompt).toContain("Operator: Welcome.");
    expect(prompt).toContain("George Kurtz (CEO): x");
    expect(prompt).toContain("[The rest of the call is cut for length.]");
  });
});

describe("saved summaries", () => {
  it("keeps a summary in memory without a database", async () => {
    await expect(getSavedSummary("TEST", "2026Q2")).resolves.toBeNull();
    await saveSummary("TEST", "2026Q2", parseSummary(JSON.stringify(reply))!);
    await expect(getSavedSummary("TEST", "2026Q2")).resolves.toMatchObject({ tone: "positive" });
  });
});
