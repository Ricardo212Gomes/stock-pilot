"use client";

import { useState, useTransition } from "react";
import { setAiReviewsAction } from "./actions";

// Turns TradingAgents' reviews of the user's holdings on or off; the page reloads its data either way.
export function AiReviewsSwitch({ enabled }: { enabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setAiReviewsAction(!enabled);
        if (!result.ok) setError(result.error);
      } catch {
        setError("That didn't work. Please try again.");
      }
    });
  }

  return (
    <div className="portfolio-reviews-switch">
      <button type="button" className={enabled ? "favorites-sign-in portfolio-reviews-off" : "favorites-sign-in"} onClick={toggle} disabled={pending}>
        {pending ? "Saving…" : enabled ? "Turn off AI reviews" : "Turn on AI reviews"}
      </button>
      {error && <span className="favorite-error" role="alert">{error}</span>}
    </div>
  );
}
