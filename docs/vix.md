# VIX fear gauge

`/vix` (Markets › Fear gauge) shows the VIX, the Cboe Volatility Index, as a fear and greed gauge. The VIX is the 30-day volatility the S&P 500 options market expects. When it's high, investors are paying up for protection (fear). When it's low, they're relaxed (greed). It's one indicator, not a composite index like CNN's Fear & Greed.

## Zones

The zones follow the usual rules of thumb:

| Zone | VIX |
| --- | --- |
| Extreme greed | below 12 |
| Greed | 12 to 16 |
| Neutral | 16 to 20 (the long-run average is about 19) |
| Fear | 20 to 30 |
| Extreme fear | 30 and above |

A boundary belongs to the more fearful zone, so 20 is Fear. The dial gives each zone a fifth of its sweep, from extreme fear on the left to extreme greed on the right. Inside a zone the needle moves in a straight line, and readings below 10 or above 40 pin to the ends (`vixScore` in `src/lib/vix.ts`).

## Page

- **The gauge** shows today's reading: the zone in words, the VIX as the main figure with its signed change, the date and day's range, and what the zone usually means. Each zone's name sits beside its arc, and the current zone's name is in bold.
- **Then and now** shows the previous close, a week, a month and a year ago, each with its zone. Below them are the 52-week range, the 1-year average, the average since 1990, and how today's reading ranks against the past year's closes.
- **VIX history** charts daily closes over 1M, 6M, 1Y or 5Y. Thin lines mark where Fear (20) and Extreme fear (30) begin, and hovering shows the date, value and zone.
- **How to read the gauge** is a table of the zones, with the current one highlighted.

The zones run red (fear) through grey to blue (greed). A red and green scale would be hard to read for the most common forms of colour blindness. The colours are `negative`, `chart-1`, their 55% mixes with the card colour, and `border` for neutral, so both themes follow the tokens.

## Data

| What | Source | Cached |
| --- | --- | --- |
| Latest value, change and day's range | FMP `quote?symbol=^VIX` (on the free plan) | 1 minute |
| Daily closes since 1990 | Cboe's free `VIX_History.csv` (about 450 KB, no key) | 6 hours |

If FMP's quote fails (daily limit, no key), Cboe's latest close stands in, with its change from the close before. If Cboe fails, the history comes from FMP's `historical-price-eod/light` (five years), and the average since 1990 becomes an average over those years. The page only shows an error when both sources fail. A quote newer than the history's last close is added to the history, so the chart and comparisons include today.

Only the last five years of closes are sent to the browser for the chart; the averages and comparisons are worked out on the server from the full history.

## Files

- `src/lib/vix.ts`: zones, `vixScore`, `vixZone`, Cboe parsing, `getVix` and `vixStats`.
- `src/app/vix/page.tsx`: the page.
- `src/app/vix/vix-gauge.tsx`: the dial (server-rendered SVG).
- `src/app/vix/vix-chart.tsx`: the history chart (Recharts, client).
