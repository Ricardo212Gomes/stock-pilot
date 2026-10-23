"use client";

import { useState, useTransition } from "react";
import type { CompanyFundamentals } from "@/lib/fmp";
import { SparkIcon } from "../components/spark-icon";
import { analyzeFundamentals } from "./actions";

export function AIAnalysis({
  fundamentals,
  symbol,
}: {
  fundamentals: CompanyFundamentals | null;
  symbol: string | null;
}) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAnalyze() {
    if (!fundamentals) return;

    setAnalysis(null);
    setError(null);

    startTransition(async () => {
      try {
        const result = await analyzeFundamentals(fundamentals);
        if (result.ok) setAnalysis(result.analysis);
        else setError(result.error);
      } catch {
        setError("The analysis failed to run. Please try again.");
      }
    });
  }

  return (
    <section className="ai-analysis-panel" aria-labelledby="ai-analysis-heading">
      <div className="ai-analysis-heading">
        <div className="ai-analysis-copy">
          <p className="section-label">AI-ASSISTED REVIEW</p>
          <h2 id="ai-analysis-heading">Company fundamentals, explained</h2>
          {fundamentals ? (
            <p>
              Get a concise review of {fundamentals.symbol}&apos;s revenue, margins,
              debt and cash generation from its last {fundamentals.annualFinancials.length} annual reports.
            </p>
          ) : (
            <p>Load annual financial data for a company to enable its AI review.</p>
          )}
        </div>
        <button
          className="ai-analysis-button"
          type="button"
          onClick={handleAnalyze}
          disabled={isPending || !fundamentals}
        >
          <SparkIcon />
          <span>{isPending ? "Analyzing…" : analysis ? "Analyze again" : "Analyze with AI"}</span>
        </button>
      </div>

      {isPending && <p className="ai-analysis-status" role="status">Reviewing the available financial periods…</p>}
      {error && <p className="ai-analysis-error" role="alert">{error}</p>}
      {analysis && (
        <div className="ai-analysis-result" aria-live="polite">
          <h3>AI financial review</h3>
          <p>{analysis}</p>
        </div>
      )}

      <p className="ai-analysis-disclaimer">
        {fundamentals
          ? "AI-generated summary of historical fundamentals. It may be incomplete or inaccurate and is not investment advice."
          : symbol
            ? `Search for ${symbol} above and load its financials to enable analysis.`
            : "Search for a ticker above and load its financials to enable analysis."}
      </p>
    </section>
  );
}
