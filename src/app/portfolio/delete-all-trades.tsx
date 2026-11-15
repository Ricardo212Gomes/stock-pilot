"use client";

import { useState, useTransition } from "react";
import { InlineConfirm } from "../components/inline-confirm";
import { deleteAllTradesAction } from "./actions";

// Deletes every trade after asking again in place, for starting over or importing a statement again.
export function DeleteAllTrades({ count }: { count: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteAllTradesAction();
        if (!result.ok) setError(result.error);
      } catch {
        setError("That didn't work. Please try again.");
      }
      setConfirming(false);
    });
  }

  return (
    <>
      {confirming ? (
        <InlineConfirm
          question={`Delete all ${count} trades? This can't be undone.`}
          confirmLabel="Delete all"
          pending={pending}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button type="button" className="portfolio-delete-all" onClick={() => setConfirming(true)}>Delete all trades</button>
      )}
      {error && <span className="favorite-error" role="alert">{error}</span>}
    </>
  );
}
