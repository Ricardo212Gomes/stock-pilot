import { describe, expect, it } from "vitest";
import { AI_FILLABLE_KEYS } from "./assumptions";
import { buildAutofillPrompt, parseAutofillResponse } from "./autofill";
import { classifyStock } from "./classify";
import { assumptions, history, profile } from "./test-fixtures";

function reply(entries: { key: string; value: unknown; rationale?: unknown }[], summary: unknown = "Steady outlook.") {
  return JSON.stringify({ summary, assumptions: entries.map((entry) => ({ rationale: "Because.", ...entry })) });
}

describe("parseAutofillResponse", () => {
  it("reads suggestions and their rationales", () => {
    const result = parseAutofillResponse(reply([
      { key: "growthRate", value: 0.08, rationale: "Revenue grew about 8% a year." },
      { key: "exitPe", value: 18 },
    ]));

    expect(result).toEqual({
      summary: "Steady outlook.",
      suggestions: {
        growthRate: { value: 0.08, rationale: "Revenue grew about 8% a year." },
        exitPe: { value: 18, rationale: "Because." },
      },
    });
  });

  it("accepts JSON wrapped in a code fence", () => {
    const text = "```json\n" + reply([{ key: "discountRate", value: 0.09 }]) + "\n```";
    expect(parseAutofillResponse(text)?.suggestions.discountRate?.value).toBe(0.09);
  });

  it("ignores starting values, unknown keys and non-numeric values", () => {
    const result = parseAutofillResponse(reply([
      { key: "currentPrice", value: 1 },
      { key: "fcfPerShare", value: 99 },
      { key: "madeUp", value: 1 },
      { key: "growthRate", value: "fast" },
      { key: "payoutRatio", value: 0.5 },
    ]));
    expect(Object.keys(result?.suggestions ?? {})).toEqual(["payoutRatio"]);
  });

  it("rescales whole-number percentages and clamps to the allowed range", () => {
    const result = parseAutofillResponse(reply([
      { key: "discountRate", value: 9 },
      { key: "exitPe", value: 500 },
      { key: "growthYears", value: 7.6 },
    ]));
    expect(result?.suggestions.discountRate?.value).toBeCloseTo(0.09);
    expect(result?.suggestions.exitPe?.value).toBe(80);
    expect(result?.suggestions.growthYears?.value).toBe(8);
  });

  it("drops a terminal growth at or above the discount rate", () => {
    const result = parseAutofillResponse(reply([
      { key: "discountRate", value: 0.04 },
      { key: "terminalGrowth", value: 0.045 },
    ]));
    expect(result?.suggestions.discountRate).toBeDefined();
    expect(result?.suggestions.terminalGrowth).toBeUndefined();
  });

  it("trims long text and rejects unusable replies", () => {
    const long = parseAutofillResponse(reply([{ key: "growthRate", value: 0.05, rationale: "word ".repeat(200) }], 42));
    expect(long?.suggestions.growthRate?.rationale.length).toBeLessThanOrEqual(320);
    expect(long?.summary).toBe("");

    expect(parseAutofillResponse("not json")).toBeNull();
    expect(parseAutofillResponse(JSON.stringify({ summary: "x" }))).toBeNull();
    expect(parseAutofillResponse(reply([{ key: "madeUp", value: 1 }]))).toBeNull();
  });
});

describe("buildAutofillPrompt", () => {
  it("lists only AI-fillable fields with their ranges and the company context", () => {
    const financials = history(0.06);
    const prompt = buildAutofillPrompt({
      symbol: "TEST",
      profile: profile(),
      financials,
      classification: classifyStock(financials, profile()),
      defaults: assumptions(),
    });

    expect(prompt).toContain("Suggest valuation assumptions for TEST");
    expect(prompt).toContain("Stable compounder");
    expect(prompt).toContain('"industry":"Software - Application"');
    for (const key of AI_FILLABLE_KEYS) expect(prompt).toContain(`"key":"${key}"`);
    expect(prompt).not.toContain('"key":"currentPrice"');
  });
});
