import { describe, expect, it } from "vitest";
import { buildReviewPrompt, formatForPrompt, isReviewStatement, reviewInstructions, reviewParagraphs } from "./financial-review";
import type { StatementTable } from "./financial-statements";

const table: StatementTable = {
  statement: "income",
  period: "annual",
  currency: "USD",
  fiscalYear: "October - September",
  columns: [
    { id: "ttm", label: "TTM", periodEnding: "2026-06-27" },
    { id: "2025-09-27", label: "FY 2025", periodEnding: "2025-09-27" },
  ],
  rows: [
    { id: "revenue", label: "Revenue", format: "money", emphasis: true, section: null, help: null, values: [466823000000.4, 416161000000] },
    { id: "revenueGrowth", label: "Revenue Growth (YoY)", format: "growth", emphasis: false, section: null, help: null, values: [null, 0.064347] },
  ],
  chart: { title: "Revenue & Profits", labels: [], series: [], defaults: [] },
};

describe("review statements", () => {
  it("reviews every statement tab but not the charts-only tab", () => {
    for (const statement of ["income", "balance", "cash-flow", "ratios"]) expect(isReviewStatement(statement)).toBe(true);
    for (const other of ["overview", "segments", undefined]) expect(isReviewStatement(other)).toBe(false);
  });

  it("tailors the instructions to each statement", () => {
    expect(reviewInstructions("income")).toMatch(/income statement in plain language.*revenue growth, gross, operating and profit margins/);
    expect(reviewInstructions("balance")).toMatch(/balance sheet in plain language.*net cash \(debt\)/);
    expect(reviewInstructions("cash-flow")).toMatch(/cash flow statement in plain language.*free cash flow and its margin/);
    expect(reviewInstructions("ratios")).toMatch(/financial ratios in plain language.*Briefly say what each ratio you mention means/);
    for (const statement of ["income", "balance", "cash-flow", "ratios"] as const) {
      expect(reviewInstructions(statement)).toMatch(/Do not give a buy, sell or price recommendation/);
    }
  });
});

describe("buildReviewPrompt", () => {
  it("names the statement and period and includes readable figures", () => {
    const prompt = buildReviewPrompt({ symbol: "AAPL", table });
    expect(prompt).toContain("Explain AAPL's Income Statement (annual periods");
    expect(prompt).toContain('"columns":["TTM (2026-06-27)","FY 2025 (2025-09-27)"]');
    expect(prompt).toContain('"values":["$466.8B","$416.2B"]');
    expect(prompt).toContain('"values":[null,"+6.4%"]');
  });
});

describe("formatForPrompt", () => {
  it("formats each kind of figure the way the page shows it", () => {
    expect(formatForPrompt(8.731, "perShare", "USD")).toBe("$8.73");
    expect(formatForPrompt(14.75e9, "shares", "USD")).toBe("14.75B shares");
    expect(formatForPrompt(0.48653, "percent", "USD")).toBe("48.7%");
    expect(formatForPrompt(-0.028, "growth", "USD")).toBe("-2.8%");
    expect(formatForPrompt(39.536, "ratio", "USD")).toBe("39.54");
    expect(formatForPrompt(-21.9e9, "money", "EUR")).toBe("-€21.9B");
    expect(formatForPrompt(null, "money", "USD")).toBeNull();
  });
});

describe("reviewParagraphs", () => {
  it("strips Markdown and splits paragraphs", () => {
    expect(reviewParagraphs("## Revenue\n**Revenue** grew 6%\nlast year.\n\n- Margins rose\n\n\nWatch debt."))
      .toEqual(["Revenue Revenue grew 6% last year.", "• Margins rose", "Watch debt."]);
  });
});
