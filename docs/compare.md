# Compare

`/compare?symbols=CELH,MNST,KO` puts up to five stocks side by side, modelled on Jeremy Lefebvre's (1000xStocks) comparison sheet: valuation, expected EPS and revenue growth, and margins. A Typical column gives the range many established companies trade at. It's a rough yardstick, not a target.

Open it from the sidebar (Workspace › Compare), the home page's Compare card, or the "compare with other stocks" link at the bottom of a company's overview, which starts the list with that company.

## Adding and removing stocks

The search above the table works like the top bar's: matching runs in the browser, and choosing a company submits it as `add`. The page folds `add` into `symbols` and redirects, so the address always reads `?symbols=…` and can be bookmarked or shared. Duplicates are dropped, and the search is replaced by a notice once five stocks are listed. The compared tickers sit beside the search as pills, each with a × that removes it.

## Metrics

"This year" is the fiscal year after the last annual report, and "next year" the one after it. The estimates are FMP's `analyst-estimates` consensus averages, matched to fiscal years by date: an estimate counts as a later year when it ends more than 180 days after the previous one, so small date differences between estimates and reports don't matter. Each column header shows the years used (Est. FY2027 · FY2028).

| Row | Calculation | Source |
| --- | --- | --- |
| TTM P/E | Price ÷ EPS over the last four quarters | Quote, quarterly income statements |
| Forward P/E | Price ÷ this year's EPS estimate | FMP estimates |
| 2-year forward P/E | Price ÷ next year's EPS estimate | FMP estimates |
| TTM EPS and revenue growth | Last four quarters against the four before | Finnhub `stock/metric` (needs eight quarters, more than the free plans give) |
| This year (expected) | This year's estimate ÷ last year's reported figure − 1 | FMP estimates, annual statements |
| Next year (expected) | Next year's estimate ÷ this year's − 1 | FMP estimates |
| Gross and net margin | Gross profit and net income ÷ revenue, last four quarters | Quarterly statements |
| TTM P/S | Market cap ÷ revenue over the last four quarters | Quote, quarterly statements |
| Forward P/S | Market cap ÷ this year's revenue estimate | FMP estimates |
| Last fiscal year | Last reported year against the year before | Annual statements |
| TTM vs next 12 months | Next-twelve-month estimate ÷ TTM − 1. The next twelve months weight this year's estimate by the share of it still ahead, and next year's by the rest. | FMP estimates, quarterly statements |
| Latest quarter vs a year ago | The latest quarter against the fifth-latest, when they're 350–380 days apart | Quarterly statements; Finnhub when they aren't |
| 2-year expected (stacked) | Next year's estimate ÷ last year's reported figure − 1 | FMP estimates, annual statements |

Statements come from FMP, or from SEC filings when FMP's plan doesn't cover the company (see [`data-fallbacks.md`](./data-fallbacks.md)). When there are no statements at all, the TTM P/E, P/S and margins fall back to Finnhub's trailing figures.

A multiple of a loss and growth from a loss (or from zero) are left blank rather than shown as meaningless numbers.

The best value in each row, meaning the lowest multiple or the highest growth or margin, is bold and underlined when at least two stocks have a value. Growth rates carry a sign and are coloured `positive` or `negative`.

## Free-plan limits

- FMP's free plan doesn't give estimates or statements for every company (CELH, MNST and AVGO return 402). Such a company still gets its quote and TTM growth from Finnhub and its statements from SEC filings, but its forward P/E, forward P/S and expected growth rows stay blank. The footnote names those companies.
- Finnhub's trailing figures can lag a new report by a few days. Just after a company reports, its TTM growth may still cover the previous four quarters while the margins, which come from the statements, already include the new one.

## Requests

Each stock costs about four FMP requests (quote, quarterly and annual income statements, estimates) and one Finnhub request. The quarterly statements and estimates use the same parameters as the overview, and the annual statements the same as Financials, so they share cached responses (24 hours; the quote 1 minute).

## Files

- `src/lib/stock-comparison.ts`: the metric definitions and typical ranges (`METRIC_SECTIONS`), `computeComparison` (pure, tested), `bestIndex`, `parseSymbols` and `getComparedStock`, which loads one stock.
- `src/app/compare/page.tsx`: the page, the table and the footnotes.
- `src/app/components/ticker-search.tsx`: the shared search. `name` and `params` let Compare submit `add` while keeping the current list.
