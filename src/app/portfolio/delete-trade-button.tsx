"use client";

import { useState, useTransition } from "react";
import { InlineConfirm } from "../components/inline-confirm";
import { deleteTradeAction } from "./actions";

// Deletes one trade after asking again in its row; the page refreshes with the holdings worked out again.
export function DeleteTradeButton({ id, label }: { id: number; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteTradeAction(id);
        if (!result.ok) {
          setError(result.error);
          setConfirming(false);
        }
      } catch {
        setError("That didn't work. Please try again.");
        setConfirming(false);
      }
    });
  }

  return (
    <>
      {confirming ? (
        <InlineConfirm question="Delete?" pending={pending} onConfirm={remove} onCancel={() => setConfirming(false)} />
      ) : (
        <button type="button" className="portfolio-delete" onClick={() => setConfirming(true)} aria-label={`Delete the ${label}`} title="Delete this trade">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6M8.5 8.5v4.5M11.5 8.5v4.5" />
          </svg>
        </button>
      )}
      {error && <span className="favorite-error" role="alert">{error}</span>}
    </>
  );
}
