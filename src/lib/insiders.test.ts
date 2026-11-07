import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeCode,
  displayName,
  getInsiderActivity,
  insiderPeople,
  monthlyFlows,
  parseFinnhubTransactions,
  parseForm4,
  rawFormUrl,
  summarizeTrades,
  type InsiderTransaction,
} from "./insiders";

const finnhubRows = {
  data: [
    { name: "Newstead Jennifer", share: 29997, change: -2399, filingDate: "2026-11-05", transactionDate: "2026-11-03", transactionCode: "S", transactionPrice: 325.75, id: "0001140361-26-042149", isDerivative: false },
    { name: "Cook Timothy D", share: 3280000, change: 50000, filingDate: "2026-10-03", transactionDate: "2026-10-01", transactionCode: "M", transactionPrice: 0, id: "0001140361-26-040000", isDerivative: false },
    { name: "Cook Timothy D", share: 0, change: -50000, filingDate: "2026-10-03", transactionDate: "2026-10-01", transactionCode: "M", transactionPrice: 0, id: "0001140361-26-040000", isDerivative: true },
    { name: "Levinson Arthur D", share: 4200000, change: 10000, filingDate: "2026-08-14", transactionDate: "2026-08-12", transactionCode: "P", transactionPrice: 210, id: "0001140361-26-030000", isDerivative: false },
    { name: "Nobody", share: 10, change: 0, filingDate: "2026-08-14", transactionDate: "2026-08-12", transactionCode: "P", transactionPrice: 1, id: "x", isDerivative: false },
  ],
};

describe("parseFinnhubTransactions", () => {
  it("keeps share transactions, labels each code and values trades with a price", () => {
    const rows = parseFinnhubTransactions(finnhubRows);
    expect(rows.map((row) => [row.name, row.kind, row.label, row.shares, row.price, row.value])).toEqual([
      ["Newstead Jennifer", "sale", "Sale", -2399, 325.75, 2399 * 325.75],
      ["Cook Timothy D", "exercise", "Option exercise", 50000, null, null],
      ["Levinson Arthur D", "buy", "Buy", 10000, 210, 2_100_000],
    ]);
    expect(rows[0]).toMatchObject({ accession: "0001140361-26-042149", ownedAfter: 29997, filed: "2026-11-05", date: "2026-11-03" });
  });

  it("writes names in capitals in title case", () => {
    expect(["LEVINSON ARTHUR D", "O'BRIEN DEIRDRE", "SMITH JOHN III", "Newstead Jennifer"].map(displayName)).toEqual([
      "Levinson Arthur D",
      "O'Brien Deirdre",
      "Smith John III",
      "Newstead Jennifer",
    ]);
  });

  it("names unknown codes", () => {
    expect(describeCode("Z")).toEqual({ kind: "other", label: "Other (Z)" });
    expect(describeCode("F")).toEqual({ kind: "tax", label: "Tax withholding" });
  });
});

describe("parseForm4", () => {
  const form = (relationship: string, rest = "") => `<ownershipDocument><reportingOwner><reportingOwnerRelationship>${relationship}</reportingOwnerRelationship></reportingOwner>${rest}</ownershipDocument>`;

  it("reads the role and the 10b5-1 flag", () => {
    expect(parseForm4(form("<isDirector>false</isDirector><isOfficer>true</isOfficer><officerTitle>SVP, GC and Government Affairs</officerTitle>", "<aff10b5One>true</aff10b5One>"))).toEqual({
      role: "SVP, GC and Government Affairs",
      planned: true,
    });
    expect(parseForm4(form("<isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle><isTenPercentOwner>0</isTenPercentOwner>", "<aff10b5One>0</aff10b5One>"))).toEqual({
      role: "Chief Executive Officer, Director",
      planned: false,
    });
  });

  it("finds a plan in a footnote on older forms, and copes without a role", () => {
    expect(parseForm4(form("<isTenPercentOwner>1</isTenPercentOwner>", "<footnotes><footnote id=\"F1\">Sold pursuant to a Rule 10b5-1 trading plan.</footnote></footnotes>"))).toEqual({ role: "10% owner", planned: true });
    expect(parseForm4("<ownershipDocument></ownershipDocument>")).toEqual({ role: null, planned: false });
  });

  it("finds the XML behind EDGAR's rendered form", () => {
    expect(rawFormUrl("https://www.sec.gov/Archives/edgar/data/320193/000114036126042149/xslF345X06/form4.xml")).toBe("https://www.sec.gov/Archives/edgar/data/320193/000114036126042149/form4.xml");
    expect(rawFormUrl("https://www.sec.gov/Archives/edgar/data/320193/000114036126042149/doc.htm")).toBeNull();
  });
});

function trade(overrides: Partial<InsiderTransaction>): InsiderTransaction {
  return {
    id: "t", accession: "a", name: "A", role: null, date: "2026-10-01", filed: "2026-10-02", code: "S", kind: "sale", label: "Sale",
    shares: -100, price: 10, value: 1000, ownedAfter: 900, planned: null, filingUrl: null, ...overrides,
  };
}

describe("summaries", () => {
  const transactions = [
    trade({ name: "A", date: "2026-11-03", value: 5000, planned: true, ownedAfter: 800, role: "CFO" }),
    trade({ name: "A", date: "2026-10-01", value: 1000, planned: false }),
    trade({ name: "B", date: "2026-08-12", kind: "buy", code: "P", label: "Buy", shares: 100, value: 2000 }),
    trade({ name: "C", date: "2026-09-01", kind: "award", code: "A", label: "Award", shares: 500, value: null }),
  ];

  it("totals buys and sales in the market, and the part under plans", () => {
    expect(summarizeTrades(transactions)).toEqual({
      buys: { count: 1, insiders: 1, shares: 100, value: 2000 },
      sales: { count: 2, insiders: 1, shares: 200, value: 6000, plannedValue: 5000 },
    });
  });

  it("adds up each month over the last twelve", () => {
    const months = monthlyFlows(transactions, "2026-11-07");
    expect(months).toHaveLength(12);
    expect(months[0].month).toBe("2025-12");
    expect(months.at(-1)).toEqual({ month: "2026-11", bought: 0, sold: 5000 });
    expect(months.find((month) => month.month === "2026-08")).toEqual({ month: "2026-08", bought: 2000, sold: 0 });
  });

  it("lists each insider with their latest holdings, biggest traders first", () => {
    expect(insiderPeople(transactions).map((person) => [person.name, person.role, person.owned, person.trades, person.bought, person.sold])).toEqual([
      ["A", "CFO", 800, 2, 0, 6000],
      ["B", null, 900, 1, 2000, 0],
      ["C", null, 900, 0, 0, 0],
    ]);
  });
});

describe("getInsiderActivity", () => {
  beforeEach(() => vi.stubEnv("FINNHUB_API_KEY", "finnhub-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("adds roles, plans and filing links from the SEC to Finnhub's trades", async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.startsWith("https://finnhub.io/")) return Response.json(finnhubRows);
      if (url === "https://www.sec.gov/files/company_tickers.json") return Response.json({ 0: { cik_str: 320193, ticker: "AAPL" } });
      if (url.startsWith("https://data.sec.gov/submissions/")) {
        return Response.json({
          name: "Apple Inc.",
          filings: { recent: {
            accessionNumber: ["0001140361-26-042149", "0001140361-26-030000"],
            form: ["4", "4"],
            filingDate: ["2026-11-05", "2026-08-14"],
            reportDate: ["2026-11-03", "2026-08-12"],
            items: ["", ""],
            primaryDocument: ["xslF345X06/form4.xml", "xslF345X06/form4.xml"],
            primaryDocDescription: ["", ""],
          } },
        });
      }
      if (url.endsWith("/000114036126042149/form4.xml")) {
        return new Response("<reportingOwnerRelationship><isOfficer>true</isOfficer><officerTitle>General Counsel</officerTitle></reportingOwnerRelationship><aff10b5One>true</aff10b5One>");
      }
      if (url.endsWith("/000114036126030000/form4.xml")) {
        return new Response("<reportingOwnerRelationship><isDirector>true</isDirector></reportingOwnerRelationship><aff10b5One>false</aff10b5One>");
      }
      return new Response("not mocked", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getInsiderActivity("AAPL", new Date("2026-11-07T12:00:00Z"));
    if (!result.ok) throw new Error(result.reason);
    const { transactions, summary, filingsRead, from } = result.data;
    expect(from).toBe("2025-11-07");
    expect(filingsRead).toBe(2);
    expect(transactions.map((transaction) => [transaction.name, transaction.role, transaction.planned])).toEqual([
      ["Newstead Jennifer", "General Counsel", true],
      ["Cook Timothy D", null, null],
      ["Levinson Arthur D", "Director", false],
    ]);
    expect(transactions[0].filingUrl).toBe("https://www.sec.gov/Archives/edgar/data/320193/000114036126042149/xslF345X06/form4.xml");
    expect(summary.buys.value).toBe(2_100_000);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("from")).toBe("2025-11-07");
  });

  it("passes on Finnhub's failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(getInsiderActivity("AAPL")).resolves.toEqual({ ok: false, reason: "rate-limited" });
  });
});
