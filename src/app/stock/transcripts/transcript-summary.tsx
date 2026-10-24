"use client";

import { useState, useTransition } from "react";
import { SparkIcon } from "../../components/spark-icon";
import type { CallTone, TranscriptSummary } from "@/lib/transcript-summary";
import { summarizeTranscript } from "./actions";

const TONE_LABEL: Record<CallTone, string> = {
  positive: "Positive tone",
  neutral: "Neutral tone",
  cautious: "Cautious tone",
  negative: "Negative tone",
};

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="transcript-summary-section">
      <h3>{title}</h3>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

// "Summarize with AI" above a transcript. A summary made earlier arrives with the page.
export function TranscriptSummaryCard({
  symbol,
  quarter,
  quarterLabel,
  company,
  initial,
}: {
  symbol: string;
  quarter: string;
  quarterLabel: string;
  company: string;
  initial: TranscriptSummary | null;
}) {
  const [summary, setSummary] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await summarizeTranscript(symbol, quarter, company);
        if (result.ok) setSummary(result.summary);
        else setError(result.error);
      } catch {
        setError("The summary failed to run. Please try again.");
      }
    });
  }

  if (!summary) {
    return (
      <div className="transcript-summary-start">
        <button className="ai-analysis-button" type="button" onClick={run} disabled={pending}>
          <SparkIcon />
          <span>{pending ? "Reading the call…" : "Summarize with AI"}</span>
        </button>
        <p>Key results, outlook, what analysts asked and management&apos;s tone, in a minute&apos;s read.</p>
        {pending && <p className="ai-analysis-status" role="status">Reading the {quarterLabel} call…</p>}
        {error && <p className="ai-analysis-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <section className="ai-review-panel transcript-summary" aria-label={`AI summary of the ${quarterLabel} call`}>
      <div className="ai-review-heading">
        <SparkIcon />
        <strong>AI summary</strong>
        <span>{quarterLabel}</span>
        <span className={`transcript-tone transcript-tone-${summary.tone}`} title={summary.toneReason}>{TONE_LABEL[summary.tone]}</span>
      </div>
      <p>{summary.overview}</p>
      <div className="transcript-summary-grid">
        <List title="Highlights" items={summary.highlights} />
        <List title="Outlook" items={summary.outlook} />
        <List title="What analysts asked" items={summary.analystQuestions} />
      </div>
      {summary.toneReason && <p className="transcript-tone-reason"><strong>{TONE_LABEL[summary.tone]}: </strong>{summary.toneReason}</p>}
      <p className="ai-review-disclaimer">
        AI-generated from the call transcript. It may be incomplete or inaccurate and is not investment advice.
      </p>
    </section>
  );
}
