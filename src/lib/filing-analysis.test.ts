import { describe, expect, it } from "vitest";
import { focusDocument, htmlToText, isAlertFiling, parseFilingAnalysis } from "./filing-analysis";

describe("htmlToText", () => {
  it("drops tags, scripts, hidden XBRL headers and entities", () => {
    const html = `<html><head><style>p{}</style></head><body><ix:header><ix:hidden>1535527</ix:hidden></ix:header>
      <p>Revenue grew&nbsp;22%</p><script>x()</script><div>AT&amp;T &#8217;s deal</div></body></html>`;
    expect(htmlToText(html)).toBe("Revenue grew 22%\nAT&T ’s deal");
  });
});

describe("focusDocument", () => {
  it("starts a 10-Q at Management's Discussion and Analysis, skipping the table of contents", () => {
    const text = `Table of contents. Management's Discussion and Analysis ... page 20. ${"x".repeat(1000)} Management’s Discussion and Analysis of results. ${"y".repeat(30_000)}`;
    expect(focusDocument(text, "10-Q").startsWith("Management’s Discussion and Analysis of results")).toBe(true);
    expect(focusDocument("Item 2.02 Results", "8-K")).toBe("Item 2.02 Results");
  });
});

describe("isAlertFiling", () => {
  it("keeps reports and significant 8-Ks", () => {
    expect(isAlertFiling({ form: "10-Q", items: [] })).toBe(true);
    expect(isAlertFiling({ form: "8-K", items: ["2.02", "9.01"] })).toBe(true);
    expect(isAlertFiling({ form: "8-K", items: ["5.07"] })).toBe(false);
    expect(isAlertFiling({ form: "4", items: [] })).toBe(false);
  });
});

describe("parseFilingAnalysis", () => {
  it("reads and caps the analysis, and rejects replies without a headline", () => {
    const reply = { headline: "Q2 results beat", summary: "Revenue **rose**.", keyPoints: ["- ARR $5.3B", "2", "3", "4", "5", "6"], watch: [], sentiment: "glowing" };
    expect(parseFilingAnalysis(JSON.stringify(reply))).toEqual({
      headline: "Q2 results beat", summary: "Revenue rose.", keyPoints: ["ARR $5.3B", "2", "3", "4", "5"], watch: [], sentiment: "neutral",
    });
    expect(parseFilingAnalysis(JSON.stringify({ ...reply, headline: "" }))).toBeNull();
    expect(parseFilingAnalysis("nope")).toBeNull();
  });
});
