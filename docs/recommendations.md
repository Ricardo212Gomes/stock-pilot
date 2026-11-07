# Recommendations

`/recommendations` (Workspace › Recommendations) screens large US stocks for three things at once: trading well below the analysts' consensus price target, rated Buy by most analysts, and pulled back below their 12-week average. Three more signals about the price trend and the ratings help tell a dip in a strong stock from a slide. It's a screen, not advice, and the page says so.

## Signals

| Signal | Rule | Default |
| --- | --- | --- |
| Analyst upside | The consensus price target is at least the chosen percentage above the last close (10, 15, 20 or 30%) | Required, 15% |
| 75%+ Buy ratings | At least 75% of analysts rate it Buy or Strong Buy, with 5 or more analysts | Required |
| Below 12-week average | The last close is under the average of the last 60 closes | Required |
| Above 200-day average | The last close is over the 200-day average: still in a long-term uptrend | Optional |
| RSI under 40 | The 14-day RSI (Wilder's) is under 40 | Optional |
| Ratings improving | The share of Buy ratings is up at least 2 points on three months earlier | Optional |

The Criteria card has a checkbox per signal: the table shows the stocks that meet every checked one, ranked by how many of the six they meet and then by upside. **Show all** lists every screened stock, with the ones that don't match dimmed. **Compare the top 5** opens them in Compare. Everything re-scores in the browser, so changing a filter makes no requests.

The table shows, for each stock, the last close, the consensus target with the upside (hover for the analysts' range), the average rating with a thin bar of the split from Strong Buy to Strong Sell and the share rating it Buy, the close against the 12-week and 200-day averages, RSI, the distance from the 52-week high, and the signals as six dots. Phones keep the company, target, ratings, the 12-week figure and the signals.

The rating label is the average on a 1 (Strong Buy) to 5 (Strong Sell) scale in the usual bands: up to 1.5 Strong Buy, 2.5 Buy, 3.5 Hold, 4.5 Sell. A stock can be labelled Buy and still pass the 75%+ Buy signal (Nvidia at 1.7, with 96% Buy). The bar uses the fear gauge's scale, blue through grey to red, with one legend above the table.

## Data

| What | Source | Cached |
| --- | --- | --- |
| Which companies to screen | The bundled 100 largest US companies (`src/data/largest-us-companies.json`, see [`stock-overview.md`](./stock-overview.md)), kept to those FMP's plan covers with one `market-capitalization-batch` request | 6 hours (shared with the Stocks page) |
| Consensus price target, high and low | FMP `price-target-consensus` (shared with the overview) | 24 hours |
| Daily closes for the last 400 days | FMP `historical-price-eod/light`, or Tiingo when FMP's limit is reached (see [`data-fallbacks.md`](./data-fallbacks.md)) | 24 hours |
| Analyst ratings by month | Finnhub `stock/recommendation` (free for every US stock) | 24 hours |

On FMP's free plan, that's 36 of the 100 (Apple, Nvidia, Microsoft, Alphabet, Amazon, Meta, Tesla, JPMorgan and so on); a paid plan covers more. FMP's technical indicators and Finnhub's price targets and candles need paid plans, so the averages and RSI are worked out from the closes (`src/lib/technicals.ts`): 12 weeks is 60 sessions, a year 252.

A screen costs one FMP request for the coverage check plus two per covered company (about 73 on the free plan), once a day, out of FMP's 250. Companies load four at a time, which keeps Finnhub under its 30-a-second limit. The first load of the day takes a few seconds, so the table streams in under the heading; later loads come from the cache.

A company without closes is skipped; one without a target or ratings stays in, failing those signals. If nothing can be screened (FMP's daily limit, say), the page explains why.

## Files

- `src/lib/recommendations.ts`: the universe, coverage check and loading.
- `src/lib/recommendation-signals.ts`: the rules, rating summary and ranking, shared with the browser.
- `src/lib/technicals.ts`: moving averages, RSI and the 52-week range.
- `src/lib/daily-closes.ts`: the year of closes, shared with the Forecast tab.
- `src/app/recommendations/page.tsx`: the page.
- `src/app/recommendations/recommendations-table.tsx`: the criteria and the table (client).
