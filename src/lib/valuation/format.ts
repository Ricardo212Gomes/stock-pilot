import type { AssumptionUnit } from "./assumptions";
import type { StepKind } from "./models";

export function formatMoney(value: number | null, currency: string, compact = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const options: Intl.NumberFormatOptions = {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: 2,
    minimumFractionDigits: compact ? 0 : 2,
  };
  try {
    return new Intl.NumberFormat("en-US", { ...options, style: "currency", currency }).format(value);
  } catch {
    return `${new Intl.NumberFormat("en-US", options).format(value)} ${currency}`;
  }
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

export function formatMultiple(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}×`;
}

export function formatStep(value: number, kind: StepKind, currency: string): string {
  switch (kind) {
    case "money":
      return formatMoney(value, currency);
    case "percent":
      return formatPercent(value);
    case "multiple":
      return formatMultiple(value);
    case "years":
      return `${value} years`;
  }
}

export function formatAssumption(value: number | null, unit: AssumptionUnit, currency: string): string {
  if (value === null) return "—";
  switch (unit) {
    case "currency":
      return formatMoney(value, currency);
    case "percent":
      return formatPercent(value);
    case "multiple":
      return formatMultiple(value);
    case "years":
      return `${value} ${value === 1 ? "year" : "years"}`;
  }
}

// Inputs show percentages as whole numbers (8.5 rather than 0.085).
export function toInputValue(value: number | null, unit: AssumptionUnit): string {
  if (value === null) return "";
  const display = unit === "percent" ? value * 100 : value;
  return String(Number(display.toFixed(unit === "currency" ? 2 : 4)));
}

export function fromInputValue(text: string, unit: AssumptionUnit): number | null {
  const trimmed = text.trim().replace(/,/g, "");
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return unit === "percent" ? parsed / 100 : parsed;
}
