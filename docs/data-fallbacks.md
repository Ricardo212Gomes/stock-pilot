# Data fallbacks: SEC filings and Finnhub

FMP is the main data source. Its free plan doesn't cover every company (CrowdStrike and Cloudflare return "not available under your current subscription") and allows a limited number of requests a day. When an FMP request fails for either reason, the app takes the same data from free sources instead of showing an error:

| What | Fallback | Where |
| --- | --- | --- |
| Income statement, balance sheet, cash flow (annual, quarterly, TTM) | SEC EDGAR company facts | Financials, Intrinsic Value, Jeremy's and Plumas projections, DCF Calculator |
| Trailing valuation ratios (P/E, P/S, P/B, P/FCF, dividend yield) | Finnhub `stock/metric` | Ratios tab (TTM column only) |
| Quote: price, change, open, day and 52-week range, market cap | Finnhub `quote`, `stock/profile2`, `stock/metric` | Every company page |
| Revenue, net income and EPS over the trailing twelve months | SEC quarterly rows | Overview |
| Daily closing prices | Tiingo end-of-day prices, adjusted for splits and dividends (needs `TIINGO_API_KEY`) | Overview chart, Recommendations, Forecast chart |
| Largest companies | A bundled snapshot ranked by FMP's `market-capitalization-batch` (see [`stock-overview.md`](./stock-overview.md)) | Stocks |

Only `plan-restricted` and `rate-limited` failures fall back (`canUseFallback` in `src/lib/fmp.ts`); an invalid key or a missing company still shows its error. Pages say where their figures came from when it isn't FMP.

Not available without FMP: historical (per-year) valuation ratios, analyst ratings, price targets and estimates (so forward P/E), dividend history, revenue segments and volume.

## Tiingo prices

`src/lib/tiingo.ts` reads `https://api.tiingo.com/tiingo/daily/{ticker}/prices` with the key in an `Authorization: Token` header, so it never appears in URLs or logs. Tiingo's free plan covers every US stock but allows 50 requests an hour, 1,000 a day and 500 different stocks a month, so the app asks for five years at once and keeps the answer for a day: the Overview chart (`getStockPriceHistory` in `fmp.ts`) asks Tiingo first, to save FMP's daily requests, and the year of closes behind Recommendations and the Forecast chart (`getDailyCloses` in `daily-closes.ts`) asks only when FMP fails; all three share that one request. The closes are adjusted for splits and dividends, so a split doesn't show as a crash; the latest one equals the actual close.

For the one-year closes, Tiingo stands in when FMP says the plan doesn't cover the company (402), its daily limit is reached (429) or it has no prices; an invalid FMP key is still reported. Without `TIINGO_API_KEY`, those cases behave as before. The Overview's footnote says when the chart comes from Tiingo. Tiingo has no analyst data, so Recommendations still screens only the companies FMP's plan has price targets for.

## SEC company facts

`src/lib/sec.ts` reads `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`, every XBRL value a company has filed, after looking its CIK up in `https://www.sec.gov/files/company_tickers.json` (cached for a day). Both are free and need no key. The SEC asks for a User-Agent that identifies the app; set `SEC_USER_AGENT` (for example `StockPilot your@email.com`) to override the default. Company-facts files are 2–10 MB, over the Next.js data cache's 2 MB limit, so the converted rows are kept in memory for 12 hours (up to 30 companies).

The facts are turned into rows with FMP's field names, so the statement tables and valuation code use them unchanged:

- **Concepts.** Each field lists the us-gaap concepts that can carry it, most common first, and each period takes the first that has a value. Revenue, for example, is `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax` or `…IncludingAssessedTax` depending on the company and year.
- **Forms.** Only 10-K and 10-Q (and amendments) are read. For each period, the latest filing wins, so restatements apply.
- **Periods.** Annual values span 350–380 days, quarters 80–100 days, and balance-sheet items are values at the period end. Cash flows (and the fourth quarter) are often only given year to date, so a quarter is the year to date minus the year to date three months earlier.
- **Fiscal years.** The SEC's own fiscal-year field is inconsistent between filings, so only the newest 10-K's is used: earlier years count back from it, and a quarter belongs to the fiscal year that ends next. CrowdStrike's year ending January 31, 2026 is FY 2026, and the quarter ending July 31, 2026 is Q2 FY 2027.
- **Stock splits.** `StockholdersEquityNoteStockSplitConversionRatio1` gives each split. Share counts and per-share figures filed before the first filing on the new basis are restated, as FMP does (CrowdStrike's 4-for-1 in 2026, Apple's in 2020).
- **Signs and totals.** Payments (capex, acquisitions, dividends, buybacks) are negative, as in FMP. Gross profit, free cash flow, total debt, cash and short-term investments, receivables and net debt issuance are derived when a company doesn't report them. A derived fourth quarter's EPS is its net income over the year's diluted shares.
- **Limits.** Five years and five quarters, the same as FMP's free plan, so averages and growth rates in the valuation tools mean the same thing for every company. Total debt leaves out lease liabilities (FMP includes them). Only US GAAP filers in US dollars are covered; foreign filers (20-F) aren't.

Checked against FMP for Apple's fiscal 2025, every income, balance sheet and cash flow line is within 1% except total debt (leases) and intangible assets (Apple reports $13.3B that FMP leaves out).

## Files

- `src/lib/sec.ts`: CIK lookup, company facts, conversion and cache.
- `src/lib/financial-statements.ts`: `secStatementTable` and Finnhub TTM ratios.
- `src/lib/fmp.ts`: `canUseFallback` and the fundamentals fallback.
- `src/lib/stock-overview.ts`: the Finnhub quote and SEC trailing figures.
- `src/lib/tiingo.ts`: Tiingo's daily prices.
