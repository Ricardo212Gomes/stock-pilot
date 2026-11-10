"use client";

import { useState, useTransition } from "react";
import { setCurrencyAction } from "./actions";
import type { Currency } from "@/lib/fx";

const OPTIONS: { id: Currency; label: string }[] = [
  { id: "USD", label: "USD" },
  { id: "EUR", label: "EUR" },
];

// The currency the portfolio is shown in, saved for the user; the page works itself out again in it.
export function CurrencySwitch({ current }: { current: Currency }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(currency: Currency) {
    if (currency === current) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await setCurrencyAction(currency);
        if (!result.ok) setError(result.error);
      } catch {
        setError("That didn't work. Please try again.");
      }
    });
  }

  return (
    <div className="portfolio-currency">
      <span id="portfolio-currency-label">Shown in</span>
      <div className="chart-view-switch" role="group" aria-labelledby="portfolio-currency-label">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === current ? "chart-view-active" : ""}
            aria-pressed={option.id === current}
            disabled={pending}
            onClick={() => choose(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error && <span className="favorite-error" role="alert">{error}</span>}
    </div>
  );
}
