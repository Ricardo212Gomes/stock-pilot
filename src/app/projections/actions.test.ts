import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autofillAssumptions, autofillDcf, autofillThreeYear } from "./actions";

const statements = {
  "income-statement": [
    { date: "2024-12-31", fiscalYear: "2024", period: "FY", reportedCurrency: "USD", revenue: 1100, netIncome: 110, epsDiluted: 1.1, weightedAverageShsOutDil: 100 },
    { date: "2023-12-31", fiscalYear: "2023", period: "FY", reportedCurrency: "USD", revenue: 1000, netIncome: 100, epsDiluted: 1, weightedAverageShsOutDil: 100 },
  ],
  "balance-sheet-statement": [{ date: "2024-12-31", totalStockholdersEquity: 500 }],
  "cash-flow-statement": [{ date: "2024-12-31", operatingCashFlow: 150, capitalExpenditure: -30 }],
  ratios: [{ date: "2024-12-31", priceToEarningsRatio: 20 }],
  profile: [{ symbol: "TEST", price: 25, beta: 1.1, sector: "Technology", industry: "Software", currency: "USD" }],
  quote: [{ symbol: "TEST", name: "Test Corp", price: 25 }],
  "treasury-rates": [{ date: "2026-10-20", year10: 4.5 }],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function geminiReply(text: string) {
  return json({ candidates: [{ content: { parts: [{ text }] } }] });
}

function mockServices({
  fmpStatus = 200,
  gemini = () => geminiReply(JSON.stringify({
    summary: "Moderate growth with average risk.",
    assumptions: [
      { key: "growthRate", value: 0.08, rationale: "Revenue grew 10% last year; a fade is prudent." },
      { key: "discountRate", value: 0.095, rationale: "Beta of 1.1 on a 4.5% risk-free rate." },
    ],
  })),
}: { fmpStatus?: number; gemini?: () => Response } = {}) {
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    void init;
    const url = new URL(input);
    if (url.hostname === "generativelanguage.googleapis.com") return gemini();
    if (fmpStatus !== 200) return json({ "Error Message": "failure" }, fmpStatus);
    const endpoint = url.pathname.replace("/stable/", "") as keyof typeof statements;
    return json(statements[endpoint] ?? []);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("FMP_API_KEY", "fmp-key");
  vi.stubEnv("GEMINI_API_KEY", "gemini-key");
  vi.stubEnv("GEMINI_MODEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("autofillAssumptions", () => {
  it("rejects invalid tickers without calling any service", async () => {
    const fetchMock = mockServices();
    await expect(autofillAssumptions("<script>")).resolves.toEqual({ ok: false, error: "Enter a valid ticker symbol first." });
    await expect(autofillAssumptions({ symbol: "AAPL" })).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains FMP failures instead of calling Gemini", async () => {
    const fetchMock = mockServices({ fmpStatus: 429 });
    const result = await autofillAssumptions("TEST");

    expect(!result.ok && result.error).toMatch(/request limit/);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("generativelanguage"))).toBe(false);
  });

  it("asks Gemini for structured JSON built from server-side data", async () => {
    const fetchMock = mockServices();
    const result = await autofillAssumptions("test");

    expect(result).toEqual({
      ok: true,
      summary: "Moderate growth with average risk.",
      suggestions: {
        growthRate: { value: 0.08, rationale: "Revenue grew 10% last year; a fade is prudent." },
        discountRate: { value: 0.095, rationale: "Beta of 1.1 on a 4.5% risk-free rate." },
      },
    });

    const geminiCall = fetchMock.mock.calls.find(([input]) => String(input).includes("generativelanguage"));
    const body = JSON.parse(String((geminiCall?.[1] as RequestInit).body)) as {
      contents: { parts: { text: string }[] }[];
      generationConfig: { responseMimeType: string; responseSchema: unknown };
    };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toBeDefined();
    expect(body.contents[0].parts[0].text).toContain("Suggest valuation assumptions for TEST");
    expect(body.contents[0].parts[0].text).toContain('"price":25');
  });

  it("reports unreadable replies and Gemini errors", async () => {
    mockServices({ gemini: () => geminiReply("Sure! Here are some ideas.") });
    let result = await autofillAssumptions("TEST");
    expect(!result.ok && result.error).toMatch(/could not be read/);

    mockServices({ gemini: () => json({}, 500) });
    result = await autofillAssumptions("TEST");
    expect(!result.ok && result.error).toMatch(/could not complete the autofill/);
  });
});

describe("autofillThreeYear", () => {
  it("rejects invalid tickers and explains FMP failures without calling Gemini", async () => {
    let fetchMock = mockServices();
    await expect(autofillThreeYear("<x>")).resolves.toEqual({ ok: false, error: "Enter a valid ticker symbol first." });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock = mockServices({ fmpStatus: 429 });
    const result = await autofillThreeYear("TEST");
    expect(!result.ok && result.error).toMatch(/request limit/);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("generativelanguage"))).toBe(false);
  });

  it("asks for structured low and high cases built from server-side data", async () => {
    const fetchMock = mockServices({
      gemini: () => geminiReply(JSON.stringify({
        summary: "Modest growth.",
        assumptions: [
          { key: "low.revenueGrowth", value: 0.03, rationale: "Below recent growth." },
          { key: "high.peRatio", value: 24, rationale: "Near the recent P/E." },
        ],
      })),
    });
    await expect(autofillThreeYear("test")).resolves.toEqual({
      ok: true,
      summary: "Modest growth.",
      suggestions: {
        "low.revenueGrowth": { value: 0.03, rationale: "Below recent growth." },
        "high.peRatio": { value: 24, rationale: "Near the recent P/E." },
      },
    });

    const call = fetchMock.mock.calls.find(([input]) => String(input).includes("generativelanguage"));
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as {
      contents: { parts: { text: string }[] }[];
      generationConfig: { responseMimeType: string };
    };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.contents[0].parts[0].text).toContain("3-year projection assumptions for TEST, currently priced at 25 USD");
  });
});

describe("autofillDcf", () => {
  it("rejects invalid tickers and builds the prompt from server-side data", async () => {
    let fetchMock = mockServices();
    await expect(autofillDcf("<x>")).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock = mockServices({
      gemini: () => geminiReply(JSON.stringify({
        summary: "Steady cash flows.",
        assumptions: [{ key: "discountRate", value: 0.09, rationale: "Average risk." }],
      })),
    });
    await expect(autofillDcf("test")).resolves.toEqual({
      ok: true,
      summary: "Steady cash flows.",
      suggestions: { discountRate: { value: 0.09, rationale: "Average risk." } },
    });
    const call = fetchMock.mock.calls.find(([input]) => String(input).includes("generativelanguage"));
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as { contents: { parts: { text: string }[] }[] };
    expect(body.contents[0].parts[0].text).toContain("Suggest DCF assumptions for TEST, currently priced at 25 USD");
  });
});
