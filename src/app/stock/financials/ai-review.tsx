"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { SparkIcon } from "../../components/spark-icon";
import { reviewParagraphs, type ReviewStatement } from "@/lib/financial-review";
import type { StatementPeriod } from "@/lib/financial-statements";
import { reviewFinancials } from "./actions";

export type AiReviewTarget = { symbol: string; statement: ReviewStatement; period: StatementPeriod; label: string };

type ReviewEntry = { open: boolean; pending: boolean; text: string | null; error: string | null };

type ReviewStore = {
  entries: Record<string, ReviewEntry>;
  toggle: (target: AiReviewTarget) => void;
  close: (target: AiReviewTarget) => void;
};

const EMPTY: ReviewEntry = { open: false, pending: false, text: null, error: null };
const ReviewContext = createContext<ReviewStore | null>(null);

function reviewKey({ symbol, statement, period }: AiReviewTarget): string {
  return `${symbol}:${statement}:${period}`;
}

// Lives in the Financials layout, which stays mounted while switching tabs and periods and
// unmounts when leaving Financials. Each statement keeps its own review until then.
export function AiReviewProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, ReviewEntry>>({});
  // Mirrors the latest entries so toggle can decide whether to fetch without a stale closure.
  const latest = useRef(entries);

  const update = useCallback((key: string, patch: Partial<ReviewEntry>) => {
    setEntries((previous) => {
      const next = { ...previous, [key]: { ...(previous[key] ?? EMPTY), ...patch } };
      latest.current = next;
      return next;
    });
  }, []);

  const toggle = useCallback((target: AiReviewTarget) => {
    const key = reviewKey(target);
    const entry = latest.current[key] ?? EMPTY;
    if (entry.open) {
      update(key, { open: false });
      return;
    }
    // A saved answer reopens instantly; a failed or missing one is requested again.
    if (entry.text || entry.pending) {
      update(key, { open: true });
      return;
    }
    update(key, { open: true, pending: true, error: null });
    reviewFinancials(target.symbol, target.statement, target.period)
      .then((result) => update(key, result.ok
        ? { pending: false, text: result.analysis, error: null }
        : { pending: false, text: null, error: result.error }))
      .catch(() => update(key, { pending: false, error: "The review failed to run. Please try again." }));
  }, [update]);

  const close = useCallback((target: AiReviewTarget) => update(reviewKey(target), { open: false }), [update]);

  return <ReviewContext.Provider value={{ entries, toggle, close }}>{children}</ReviewContext.Provider>;
}

export function useAiReview(target: AiReviewTarget) {
  const store = useContext(ReviewContext);
  if (!store) throw new Error("useAiReview must be used inside AiReviewProvider.");
  const entry = store.entries[reviewKey(target)] ?? EMPTY;

  return {
    open: entry.open,
    isPending: entry.pending,
    current: entry.text || entry.error ? { text: entry.text, error: entry.error } : null,
    toggle: () => store.toggle(target),
    close: () => store.close(target),
  };
}

export function AiReviewButton({ label, open, pending, onClick }: { label: string; open: boolean; pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="ai-review-button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`Explain ${label} with AI`}
      title={`Explain ${label} with AI`}
      disabled={pending}
    >
      <SparkIcon />
    </button>
  );
}

export function AiReviewPanel({
  target,
  review,
}: {
  target: AiReviewTarget;
  review: ReturnType<typeof useAiReview>;
}) {
  if (!review.open) return null;
  const { current, isPending } = review;

  return (
    <section className="ai-review-panel" aria-live="polite" aria-label={`AI review of ${target.label}`}>
      <div className="ai-review-heading">
        <SparkIcon />
        <strong>AI review</strong>
        <span>{target.period === "annual" ? "Annual" : "Quarterly"}</span>
        <button type="button" className="ai-review-close" onClick={review.close} aria-label="Close the AI review">×</button>
      </div>
      {isPending && !current && <p className="ai-analysis-status" role="status">Reading the {target.label.toLowerCase()}…</p>}
      {current?.error && <p className="ai-analysis-error" role="alert">{current.error}</p>}
      {current?.text && reviewParagraphs(current.text).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <p className="ai-review-disclaimer">
        AI-generated from the reported figures. It may be incomplete or inaccurate and is not investment advice.
      </p>
    </section>
  );
}

// Puts the spark button in front of a server-rendered heading and opens the review under it,
// after the heading's subtitle so the two stay together.
export function AiHeading({
  target,
  children,
  subtitle,
}: {
  target: AiReviewTarget;
  children: ReactNode;
  subtitle?: ReactNode;
}) {
  const review = useAiReview(target);
  return (
    <>
      <div className="ai-title-row">
        <AiReviewButton label={target.label} open={review.open} pending={review.isPending} onClick={review.toggle} />
        {children}
      </div>
      {subtitle}
      <AiReviewPanel target={target} review={review} />
    </>
  );
}
