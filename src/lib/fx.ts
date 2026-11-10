import { noteFailure } from "./provider-status";

// Euro and dollar amounts, converted at the European Central Bank's reference rate for each business day, from
// Frankfurter (free, no key). Market prices are in dollars; a portfolio kept in euros, or trades made in euros,
// are converted at the rate of the day each amount belongs to.

const FRANKFURTER_URL = "https://api.frankfurter.dev/v1";
// The ECB publishes once a day, around 16:00 in Frankfurt.
const REVALIDATE_SECONDS = 60 * 60 * 6;

export type Currency = "USD" | "EUR";
export const CURRENCIES: Currency[] = ["USD", "EUR"];

export function isCurrency(value: unknown): value is Currency {
  return value === "USD" || value === "EUR";
}

// How many euros a dollar bought on a business day.
export type FxRate = { date: string; eurPerUsd: number };

export function parseFrankfurter(payload: unknown): FxRate[] {
  const rates = payload && typeof payload === "object" ? (payload as { rates?: unknown }).rates : null;
  if (!rates || typeof rates !== "object") return [];
  return Object.entries(rates as Record<string, unknown>)
    .flatMap(([date, value]): FxRate[] => {
      const eur = value && typeof value === "object" ? (value as { EUR?: unknown }).EUR : null;
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof eur === "number" && Number.isFinite(eur) && eur > 0 ? [{ date, eurPerUsd: eur }] : [];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

// Every business day's rate from `from` (YYYY-MM-DD) to the latest, or null when Frankfurter fails.
export async function getEurPerUsd(from: string): Promise<FxRate[] | null> {
  try {
    const response = await fetch(`${FRANKFURTER_URL}/${from}..?base=USD&symbols=EUR`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      noteFailure("frankfurter", `HTTP ${response.status}`);
      return null;
    }
    const rates = parseFrankfurter(await response.json());
    return rates.length > 0 ? rates : null;
  } catch {
    noteFailure("frankfurter", "no response");
    return null;
  }
}

export type Fx = {
  // `amount` in `from` on `date`, in `to`.
  convert(amount: number, from: Currency, to: Currency, date: string): number;
};

// Converts nothing: for portfolios whose trades and display are all in the same currency.
export const SAME_CURRENCY: Fx = {
  convert(amount, from, to) {
    if (from !== to) throw new Error(`No exchange rates to convert ${from} to ${to}.`);
    return amount;
  },
};

// Converts at the rate of the business day on or before each date (weekends and holidays take the last one),
// and at the first rate for dates before it.
export function fxFrom(rates: FxRate[]): Fx {
  const rateOn = (date: string): number => {
    let low = 0;
    let high = rates.length - 1;
    let found = rates[0];
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (rates[middle].date <= date) {
        found = rates[middle];
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found.eurPerUsd;
  };
  return {
    convert(amount, from, to, date) {
      if (from === to) return amount;
      return from === "USD" ? amount * rateOn(date) : amount / rateOn(date);
    },
  };
}
