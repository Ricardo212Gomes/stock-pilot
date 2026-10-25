import { afterEach, describe, expect, it, vi } from "vitest";
import { describeFiling, filingMatches, parseSubmissions, pressReleaseUrl, type Filing } from "./sec-filings";

const submissions = {
  name: "CrowdStrike Holdings, Inc.",
  filings: {
    recent: {
      accessionNumber: ["0001535527-26-000029", "0001535527-26-000020", "0001535527-26-000010", "0001535527-26-000005", "0000000000-26-000001"],
      filingDate: ["2026-08-26", "2026-06-20", "2026-08-27", "2026-03-10", "2026-08-28"],
      reportDate: ["2026-08-26", "2026-06-18", "2026-07-31", "2026-01-31", ""],
      form: ["8-K", "8-K", "10-Q", "10-K", "4"],
      items: ["2.02,9.01", "5.02", "", "", ""],
      primaryDocument: ["crwd-20260826.htm", "tm2618192d1_8k.htm", "crwd-20260731.htm", "crwd-20260131.htm", "xslF345X05/wk-form4.xml"],
      primaryDocDescription: ["8-K", "FORM 8-K", "10-Q", "10-K", "FORM 4"],
    },
  },
};

describe("parseSubmissions", () => {
  const parsed = parseSubmissions(submissions, "0001535527")!;

  it("turns the SEC's parallel arrays into filings with document links", () => {
    expect(parsed.name).toBe("CrowdStrike Holdings, Inc.");
    expect(parsed.filings[0]).toEqual({
      accession: "0001535527-26-000029",
      form: "8-K",
      filed: "2026-08-26",
      period: "2026-08-26",
      items: ["2.02", "9.01"],
      description: "Earnings results",
      documentUrl: "https://www.sec.gov/Archives/edgar/data/1535527/000153552726000029/crwd-20260826.htm",
      indexUrl: "https://www.sec.gov/Archives/edgar/data/1535527/000153552726000029/0001535527-26-000029-index.htm",
    });
    expect(parsed.filings.map((filing) => filing.description)).toEqual([
      "Earnings results", "Executive or director change", "Quarterly report", "Annual report", "Insider trade",
    ]);
    expect(parsed.filings[4].period).toBeNull();
  });

  it("sorts filings into the page's types", () => {
    const forms = (type: Parameters<typeof filingMatches>[1]) =>
      parsed.filings.filter((filing) => filingMatches(filing, type)).map((filing) => `${filing.form}:${filing.filed}`);
    expect(forms("important")).toEqual(["8-K:2026-08-26", "8-K:2026-06-20", "10-Q:2026-08-27", "10-K:2026-03-10"]);
    expect(forms("reports")).toEqual(["10-Q:2026-08-27", "10-K:2026-03-10"]);
    expect(forms("earnings")).toEqual(["8-K:2026-08-26"]);
    expect(forms("events")).toEqual(["8-K:2026-06-20"]);
    expect(forms("insider")).toEqual(["4:2026-08-28"]);
  });

  it("rejects documents without filings", () => {
    expect(parseSubmissions({ name: "X" }, "1")).toBeNull();
  });
});

describe("describeFiling", () => {
  it("names 8-K items, leaving out the exhibit list", () => {
    expect(describeFiling("8-K", ["5.07"], "")).toBe("Shareholder vote results");
    expect(describeFiling("8-K", ["1.01", "2.03", "9.01"], "")).toBe("New material agreement · New debt or obligation");
    expect(describeFiling("8-K/A", ["9.01"], "")).toBe("Current report (amended)");
    expect(describeFiling("FWP", [], "Free writing prospectus")).toBe("Free writing prospectus");
  });
});

describe("pressReleaseUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  const filing = parseSubmissions(submissions, "0001535527")!.filings[0] as Filing;

  it("finds exhibit 99.1 in the filing's files", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ directory: { item: [
      { name: "crwd-20260826.htm" }, { name: "crwd-20260826xex992.htm" }, { name: "crwd-20260826xex991.htm" }, { name: "R1.htm" },
    ] } })));
    await expect(pressReleaseUrl(filing)).resolves.toBe("https://www.sec.gov/Archives/edgar/data/1535527/000153552726000029/crwd-20260826xex991.htm");
  });

  it("returns null without an exhibit 99 or when the SEC fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ directory: { item: [{ name: "crwd-20260826.htm" }] } })));
    await expect(pressReleaseUrl(filing)).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(pressReleaseUrl(filing)).resolves.toBeNull();
  });
});
