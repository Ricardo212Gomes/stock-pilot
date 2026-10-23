import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewFinancials } from "./actions";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const income = [2025, 2024].map((year) => ({
  date: `${year}-09-27`, fiscalYear: String(year), period: "FY", reportedCurrency: "USD",
  revenue: year === 2025 ? 416e9 : 391e9, netIncome: year === 2025 ? 112e9 : 93.7e9,
}));

function mockServices({ fmpStatus = 200, gemini = () => json({ candidates: [{ content: { parts: [{ text: "Revenue grew 6%." }] } }] }) } = {}) {
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    void init;
    const url = new URL(input);
    if (url.hostname === "generativelanguage.googleapis.com") return gemini();
    if (fmpStatus !== 200) return json({ "Error Message": "failure" }, fmpStatus);
    return json(url.pathname.endsWith("/income-statement") ? income : []);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function geminiPrompt(fetchMock: ReturnType<typeof mockServices>): string {
  const call = fetchMock.mock.calls.find(([input]) => String(input).includes("generativelanguage"));
  const body = JSON.parse(String((call?.[1] as RequestInit).body)) as { contents: { parts: { text: string }[] }[] };
  return body.contents[0].parts[0].text;
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

describe("reviewFinancials", () => {
  it("rejects bad input without calling any service", async () => {
    const fetchMock = mockServices();
    await expect(reviewFinancials("<b>", "income", "annual")).resolves.toMatchObject({ ok: false });
    await expect(reviewFinancials("AAPL", "segments", "annual")).resolves.toMatchObject({ ok: false });
    // The charts-only Financials tab has no AI review.
    await expect(reviewFinancials("AAPL", "overview", "annual")).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reloads the statement on the server and returns Gemini's text", async () => {
    const fetchMock = mockServices();
    await expect(reviewFinancials("aapl", "income", "annual")).resolves.toEqual({ ok: true, analysis: "Revenue grew 6%." });

    const prompt = geminiPrompt(fetchMock);
    expect(prompt).toContain("Explain AAPL's Income Statement (annual periods");
    expect(prompt).toContain('"FY 2025 (2025-09-27)"');
  });

  it("uses the statement's own instructions and treats unknown periods as annual", async () => {
    const fetchMock = mockServices();
    await reviewFinancials("AAPL", "cash-flow", "weekly");

    const call = fetchMock.mock.calls.find(([input]) => String(input).includes("generativelanguage"));
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as { systemInstruction: { parts: { text: string }[] } };
    expect(body.systemInstruction.parts[0].text).toMatch(/cash flow statement.*free cash flow and its margin/);
    expect(geminiPrompt(fetchMock)).toContain("Explain AAPL's Cash Flow Statement (annual periods");
  });

  it("explains FMP and Gemini failures", async () => {
    mockServices({ fmpStatus: 429 });
    const limited = await reviewFinancials("AAPL", "income", "annual");
    expect(!limited.ok && limited.error).toMatch(/request limit/);

    mockServices({ gemini: () => json({}, 500) });
    const failed = await reviewFinancials("AAPL", "income", "annual");
    expect(!failed.ok && failed.error).toMatch(/could not complete the review/);
  });
});
