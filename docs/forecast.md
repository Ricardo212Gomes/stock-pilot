# Forecast

`/stock/forecast?symbol=AAPL` is a company's Forecast tab, after Financials: what analysts expect for the stock and the business.

## Page

Each part is a card, shown when its data is there:

- **Price target:** the average (consensus) target and how far it is from today's price, the low, median and high targets, and a bar from the lowest to the highest target with today's price and the average marked. Beside it, the average of the targets set in the last month, quarter and year with how many, to show which way targets are moving. Below, a chart of the last year's closes with dashed lines from the latest close to the high, average and low targets a year out, labelled at their ends (just the value on phones).
- **Analyst ratings:** the consensus (from the average rating on a 1 Strong Buy to 5 Strong Sell scale, in the usual bands), the share rating it Buy, and the split for each of the last four months as a bar with the counts (phones keep the bar). The colours and legend are the ones Recommendations uses.
- **Revenue and EPS estimates:** the last two reported fiscal years (shaded), then analysts' average estimate for up to four years ahead with the lowest and highest, growth on the year before, and how many analysts. Phones hide the analyst count.
- **Earnings:** the next report's date with its EPS and revenue estimates, then the last four reports with the estimate, the result and "Beat by" or "Missed by".
- **Rating changes:** upgrades, downgrades and reiterations over the last 90 days, then the latest 25 actions with the firm and the rating (old → new).

## Data

| What | Source | Cached |
| --- | --- | --- |
| Consensus, median, high and low targets | FMP `price-target-consensus` (shared with the overview and Recommendations) | 24 hours |
| Average target by period | FMP `price-target-summary` | 24 hours |
| The last year of closes | FMP `historical-price-eod/light`, the same request as Recommendations (`src/lib/daily-closes.ts`) | 24 hours |
| Ratings by month | Finnhub `stock/recommendation` (shared with Recommendations; its free plan has four months) | 24 hours |
| Revenue and EPS estimates | FMP `analyst-estimates`, annual (shared with the overview and Compare) | 24 hours |
| Reported revenue and EPS | FMP annual `income-statement` (shared with Financials and Compare) | 24 hours |
| Next report and the last four, with revenue | FMP `earnings` (limit 5, shared with the overview) | 24 hours |
| EPS surprises when FMP has none | Finnhub `stock/earnings` (the last four quarters, by quarter end) | 24 hours |
| Rating changes | FMP `grades` (every action since about 2012, about 300 KB) | 24 hours |

FMP's free plan only covers its forecasts for a few dozen large companies (the 36 of the 100 largest that Recommendations screens). For the rest, the tab shows Finnhub's ratings and earnings surprises and says why the rest is missing. The same happens for a while each day once FMP's daily limit is used up, until it resets: parts already cached still show. Quarterly estimates, individual price targets and Finnhub's upgrades need paid plans.

An uncached visit costs up to seven FMP requests, most of them shared with the company's other tabs and with Recommendations, so a company already looked at today costs one or two (the target summary and the rating changes).

## Files

- `src/lib/analyst-forecast.ts`: loading and parsing.
- `src/lib/daily-closes.ts`: the year of closes, shared with Recommendations.
- `src/app/stock/forecast/page.tsx`: the tab.
- `src/app/stock/forecast/price-target-chart.tsx`: the price target chart (Recharts, client).
