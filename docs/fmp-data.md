# FMP data layer

All Financial Modeling Prep (FMP) access lives in `src/lib/fmp.ts` and runs only on the server. Every request goes through `fetchFmp(url, revalidate)`, which caches successful responses and turns failed ones into a typed reason the page can explain.

## Endpoints

Base URL: `https://financialmodelingprep.com/stable`. The key is sent as the `apikey` query parameter from `FMP_API_KEY`.

| Function | Endpoints | Required | Cached for |
| --- | --- | --- | --- |
| `getCompanyFundamentals` | `income-statement`, `balance-sheet-statement`, `cash-flow-statement`, `ratios` (annual, last 5) | Yes; the page shows an error if any fail | 24 hours |
| `getFinancialChartExtras` | `revenue-product-segmentation`, `revenue-geographic-segmentation`, `analyst-estimates` | No; each falls back to empty data on error | 24 hours |
| `getStockPriceHistory` | `historical-price-eod/full` (last 5 years) | No; the page shows a notice instead of the chart | 6 hours |
| `getCompanyProfile` | `profile` (price, beta, sector, industry) | No; projections ask the user for a price | 1 hour |
| `getRiskFreeRate` | `treasury-rates` (latest 10-year yield) | No; projections fall back to 4.25% | 24 hours |

An uncached Financials page costs about 9 FMP requests for the statements and quote (see [`financials.md`](./financials.md)), plus the segment and estimate requests for the charts below them, a projections page 6 (it shares the 4 statement requests with Financials), and an overview 11 (see [`stock-overview.md`](./stock-overview.md)). A cached page costs none until its window expires.

## Caching

`fetchFmp` calls `fetch(url, { next: { revalidate } })`, so responses go into Next's data cache. The windows are set at the top of `fmp.ts`:

- `STATEMENTS_REVALIDATE_SECONDS` (24 hours). Annual statements change about once a year.
- `PRICES_REVALIDATE_SECONDS` (6 hours). End-of-day prices change once per trading day.
- `PROFILE_REVALIDATE_SECONDS` (1 hour). The profile carries the latest quote used by projections.

Error responses are never cached. Next only stores responses with status 200, so after a 429 the next request goes to FMP again.

## Error reasons

A non-OK response throws `FmpRequestError` with an `FmpFailureReason`. The page turns each reason into a message with `providerFailureMessage` in `src/lib/fmp-messages.ts`, shared by the stock and projections pages.

| FMP status | Reason | What the page tells the user |
| --- | --- | --- |
| 429 | `rate-limited` | The plan's request limit is reached; it resets daily, so try later or upgrade. |
| 401 | `invalid-key` | FMP rejected the key; check `FMP_API_KEY` and restart the dev server. |
| 402, 403 | `plan-restricted` | The plan doesn't include this data; upgrade or try another company. |
| other, timeout, bad JSON | `provider-error` | FMP couldn't return the data; try again in a moment. |
| no key set | `not-configured` | Add `FMP_API_KEY` to the environment file and restart. |
| empty result | `no-data` | No statements were found; check the ticker or plan access. |

When fundamentals fail, the page shows only the error (plus the price chart, if prices loaded). The AI analysis panel is hidden, because it needs fundamentals to run.

## Troubleshooting

To see FMP's raw answer, call an endpoint directly with your key:

```bash
KEY=$(grep '^FMP_API_KEY=' .env | cut -d= -f2-)
curl -s -w "\nHTTP %{http_code}\n" \
  "https://financialmodelingprep.com/stable/income-statement?symbol=AAPL&limit=5&period=annual&apikey=$KEY"
```

A 429 response reads `Limit Reach`; a 401 reads `Invalid API KEY`. Use `.env.local` in the command instead of `.env` if that's where your key lives.
