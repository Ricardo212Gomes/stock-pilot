"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/valuation/format";

// Cells shared by Jeremy's and the Plumas projection tables: number formats, gain and loss colours, and
// the boxed inputs.

// Scenario colours run from the worst case to the best; each is a theme token, set as --scenario.
export type ScenarioTone = "negative" | "chart-3" | "chart-1" | "chart-6" | "positive";

// "amount", "wholePercent" and "signedWholePercent" are Jeremy's: full figures and whole percentages.
export type CellFormat = "money" | "shares" | "perShare" | "price" | "percent" | "multiple" | "amount" | "wholePercent" | "signedWholePercent";
export type CellUnit = "percent" | "multiple";

function compact(value: number, options: Intl.NumberFormatOptions, currency?: string): string {
  const shared: Intl.NumberFormatOptions = { notation: "compact", minimumFractionDigits: 2, maximumFractionDigits: 2, ...options };
  try {
    return new Intl.NumberFormat("en-US", currency ? { ...shared, style: "currency", currency } : shared).format(value);
  } catch {
    return `${new Intl.NumberFormat("en-US", shared).format(value)} ${currency ?? ""}`.trim();
  }
}

// $73.67B, 675.18M, $18.58, $297 (cents only below $10), 21.7%, 19.1×; $50,893,000,000, 20% and +14%.
export function formatCell(value: number | null, format: CellFormat, currency: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "money":
      return value === 0 ? formatMoney(0, currency).replace(/\.00$/, "") : compact(value, {}, currency);
    case "shares":
      return compact(value, {});
    case "perShare":
      return formatMoney(value, currency);
    case "price":
      return Math.abs(value) >= 10 || value === 0
        ? compact(value, { notation: "standard", minimumFractionDigits: 0, maximumFractionDigits: 0 }, currency)
        : formatMoney(value, currency);
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "multiple":
      return `${value.toFixed(1)}×`;
    case "amount":
      try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
      } catch {
        return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} ${currency}`;
      }
    case "wholePercent":
      return `${Math.round(value * 100)}%`;
    case "signedWholePercent":
      return `${Math.round(value * 100) > 0 ? "+" : ""}${Math.round(value * 100)}%`;
  }
}

export function toneOf(value: number | null): string {
  return value === null ? "" : value >= 0 ? "positive-value" : "negative-value";
}

// Percentages show as whole numbers (8.5 for 8.5%), as in the table's boxes.
function cellText(value: number, unit: CellUnit): string {
  return String(Number((unit === "percent" ? value * 100 : value).toFixed(2)));
}

// Accepts "8.5", "8,5" (a decimal comma), "-2" and a trailing % or ×.
function parseCell(text: string, unit: CellUnit): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(/[%×x]$/i, "");
  const normalized = cleaned.includes(".") ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  if (normalized === "" || normalized === "-" || normalized === ".") return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return unit === "percent" ? parsed / 100 : parsed;
}

export function SheetInput({ value, unit, label, onChange }: { value: number; unit: CellUnit; label: string; onChange: (value: number) => void }) {
  // While the box is focused it shows what was typed, so "8." or "-" can be on the way to a number.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="sheet-input">
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? cellText(value, unit)}
        onFocus={(event) => {
          setDraft(cellText(value, unit));
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = parseCell(event.target.value, unit);
          if (parsed !== null) onChange(parsed);
        }}
        onBlur={() => setDraft(null)}
      />
      <span aria-hidden="true">{unit === "percent" ? "%" : "×"}</span>
    </span>
  );
}
