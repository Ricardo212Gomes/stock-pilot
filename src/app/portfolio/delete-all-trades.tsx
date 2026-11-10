"use client";

import { useState, useTransition } from "react";
import { deleteAllTradesAction } from "./actions";

// Deletes every trade after a confirmation, for starting over or importing a statement again.
export function DeleteAllTrades({ count }: { count: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm(`Delete all ${count} trades? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteAllTradesAction();
        if (!result.ok) setError(result.error);
      } catch {
        setError("That didn't work. Please try again.");
      }
    });
  }

  return (
    <>
      <button type="button" className="portfolio-delete-all" onClick={onClick} disabled={pending}>
        {pending ? "Deleting…" : "Delete all trades"}
      </button>
      {error && <span className="favorite-error" role="alert">{error}</span>}
    </>
  );
}
