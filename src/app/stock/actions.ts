"use server";

import {
  normalizeTicker,
  type AnnualFinancialSummary,
  type CompanyFundamentals,
} from "@/lib/fmp";
import type { AIAnalysisResult } from "@/lib/ai-analysis-types";

type AnalysisPeriod = Pick<
  AnnualFinancialSummary,
  | "date"
  | "fiscalYear"
  | "period"
  | "currency"
  | "revenue"
  | "revenueGrowth"
  | "grossProfit"
  | "grossMargin"
  | "operatingIncome"
  | "operatingMargin"
  | "netIncome"
  | "netMargin"
  | "eps"
  | "totalDebt"
  | "cash"
  | "netDebt"
  | "equity"
  | "debtToEquity"
  | "currentRatio"
  | "interestCoverage"
  | "operatingCashFlow"
  | "freeCashFlow"
>;

type CleanFundamentals = {
  symbol: string;
  annualFinancials: AnalysisPeriod[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanFundamentals(value: unknown): CleanFundamentals | null {
  if (!isRecord(value)) return null;

  const symbol = normalizeTicker(value.symbol);
  const periods = value.annualFinancials;
  if (!symbol || !Array.isArray(periods) || periods.length === 0 || periods.length > 5) {
    return null;
  }

  const annualFinancials: AnalysisPeriod[] = [];
  for (const period of periods) {
    if (!isRecord(period)) return null;

    const fiscalYear = typeof period.fiscalYear === "string" && /^\d{4}$/.test(period.fiscalYear)
      ? period.fiscalYear
      : "Unknown";
    const date = typeof period.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(period.date)
      ? period.date
      : "";
    const periodName = typeof period.period === "string" && /^[A-Z0-9]{1,4}$/.test(period.period)
      ? period.period
      : "FY";
    const currency = typeof period.currency === "string" && /^[A-Z]{3}$/.test(period.currency)
      ? period.currency
      : "Unknown";

    annualFinancials.push({
      date,
      fiscalYear,
      period: periodName,
      currency,
      revenue: safeNumber(period.revenue),
      revenueGrowth: safeNumber(period.revenueGrowth),
      grossProfit: safeNumber(period.grossProfit),
      grossMargin: safeNumber(period.grossMargin),
      operatingIncome: safeNumber(period.operatingIncome),
      operatingMargin: safeNumber(period.operatingMargin),
      netIncome: safeNumber(period.netIncome),
      netMargin: safeNumber(period.netMargin),
      eps: safeNumber(period.eps),
      totalDebt: safeNumber(period.totalDebt),
      cash: safeNumber(period.cash),
      netDebt: safeNumber(period.netDebt),
      equity: safeNumber(period.equity),
      debtToEquity: safeNumber(period.debtToEquity),
      currentRatio: safeNumber(period.currentRatio),
      interestCoverage: safeNumber(period.interestCoverage),
      operatingCashFlow: safeNumber(period.operatingCashFlow),
      freeCashFlow: safeNumber(period.freeCashFlow),
    });
  }

  const hasMetrics = annualFinancials.some((period) =>
    Object.entries(period).some(([key, metric]) =>
      !["date", "fiscalYear", "period", "currency"].includes(key) && metric !== null,
    ),
  );

  return hasMetrics ? { symbol, annualFinancials } : null;
}

export async function analyzeFundamentals(
  fundamentals: CompanyFundamentals,
): Promise<AIAnalysisResult> {
  const cleanData = cleanFundamentals(fundamentals);
  if (!cleanData) {
    return { ok: false, error: "There are no usable financial metrics to analyze." };
  }

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "Gemini is not configured. Add GEMINI_API_KEY to .env.local and restart the server.",
    };
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
  const instructions = [
    "You are an objective equity research assistant reviewing historical company fundamentals.",
    "Use only the supplied metrics. Do not invent facts or infer causes that are not in the data.",
    "Treat null values as unavailable. Preserve each period and currency, and distinguish values from ratios.",
    "Compare periods with numbers where useful. Mention when missing or unusual data limits the conclusion.",
    "Do not give a buy, sell, or price target recommendation. This is a fundamentals summary, not a valuation.",
    "Write concise plain text with these headings: Revenue and profitability; Debt and liquidity; Cash generation; Strengths, risks, and limits.",
  ].join(" ");

  const prompt = `Review the following annual financial data for ${cleanData.symbol}. Margins and growth rates are decimals, so 0.12 means 12%. Debt-to-equity, current ratio, and interest coverage are multiples.\n\n${JSON.stringify(cleanData)}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
        }),
        signal: AbortSignal.timeout(45_000),
      },
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "Gemini rejected the API key. Check that it is valid and enabled for the Gemini API." };
      }
      if (response.status === 429) {
        return { ok: false, error: "Gemini's request limit was reached. Wait a moment and try again." };
      }
      return { ok: false, error: "Gemini could not complete the analysis. Please try again." };
    }

    const result = (await response.json()) as GeminiResponse;
    const analysis = result.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();

    if (!analysis) {
      return { ok: false, error: "Gemini returned an empty analysis. Please try again." };
    }

    return { ok: true, analysis };
  } catch {
    return { ok: false, error: "Gemini could not be reached. Check your connection and try again." };
  }
}
