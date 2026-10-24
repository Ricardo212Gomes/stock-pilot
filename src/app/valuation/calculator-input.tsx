"use client";

import { useState } from "react";

// Units for calculator inputs: amounts in millions, percentages as whole numbers.
export type Unit = "currency" | "millions" | "shares" | "percent" | "multiple" | "years";

export function toText(value: number | null, unit: Unit): string {
  if (value === null) return "";
  const shown = unit === "percent" ? value * 100 : unit === "millions" || unit === "shares" ? value / 1e6 : value;
  return String(Number(shown.toFixed(unit === "years" ? 0 : 2)));
}

export function fromText(text: string, unit: Unit): number | null {
  const parsed = Number(text.trim().replace(/,/g, ""));
  if (text.trim() === "" || !Number.isFinite(parsed)) return null;
  return unit === "percent" ? parsed / 100 : unit === "millions" || unit === "shares" ? parsed * 1e6 : parsed;
}

export function NumberInput({
  id,
  label,
  value,
  unit,
  currency,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  unit: Unit;
  currency: string;
  onChange: (value: number | null) => void;
}) {
  // Remounted (via key) when values change from outside, so the typed draft can stay local.
  const [draft, setDraft] = useState(() => toText(value, unit));
  const suffix = { currency, millions: `M ${currency}`, shares: "M", percent: "%", multiple: "×", years: "yrs" }[unit];
  return (
    <div className="assumption-input-wrap">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(fromText(event.target.value, unit));
        }}
      />
      <span className="assumption-suffix" aria-hidden="true">{suffix}</span>
    </div>
  );
}
