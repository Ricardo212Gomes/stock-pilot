// Price-trend figures from daily closes: moving averages, RSI and the 52-week range. Trading days stand in
// for calendar time: 12 weeks is 60 sessions, 3 months 63 and a year 252.

export const SESSIONS = { twelveWeeks: 60, threeMonths: 63, fiftyTwoWeeks: 252, longAverage: 200 } as const;
export const RSI_PERIOD = 14;

// The average of the last `period` values; null when there aren't enough.
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let total = 0;
  for (let index = values.length - period; index < values.length; index++) total += values[index];
  return total / period;
}

// Wilder's relative strength index, 0 to 100: average gains against average losses, smoothed over `period`
// sessions. Below 30 is usually called oversold, above 70 overbought.
export function rsi(values: number[], period = RSI_PERIOD): number | null {
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = values[index] - values[index - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  for (let index = period + 1; index < values.length; index++) {
    const change = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export type PricePoint = { date: string; close: number };

export type PriceTrend = {
  close: number;
  // The day of that close.
  date: string;
  sma60: number | null;
  sma200: number | null;
  rsi14: number | null;
  high52: number;
  low52: number;
  // Change over the last three months, as a fraction.
  return3m: number | null;
};

// `points` in any order; null without any closes.
export function priceTrend(points: PricePoint[]): PriceTrend | null {
  const sorted = points.filter((point) => Number.isFinite(point.close) && point.close > 0).sort((left, right) => left.date.localeCompare(right.date));
  const last = sorted.at(-1);
  if (!last) return null;
  const closes = sorted.map((point) => point.close);
  const year = closes.slice(-SESSIONS.fiftyTwoWeeks);
  const threeMonthsAgo = closes.length > SESSIONS.threeMonths ? closes[closes.length - 1 - SESSIONS.threeMonths] : null;
  return {
    close: last.close,
    date: last.date,
    sma60: sma(closes, SESSIONS.twelveWeeks),
    sma200: sma(closes, SESSIONS.longAverage),
    rsi14: rsi(closes),
    high52: Math.max(...year),
    low52: Math.min(...year),
    return3m: threeMonthsAgo ? last.close / threeMonthsAgo - 1 : null,
  };
}
