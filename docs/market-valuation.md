# Market valuation

`/market-valuation` (Markets › Market valuation) answers one question: is the S&P 500 or the Nasdaq-100 cheap or expensive compared with its own history? It shows ready-made figures from free sources rather than adding up 500 companies' earnings. A daily job stores them in Postgres, and the page only reads the database, so opening it makes no outside requests.

## Sources

| Source | What it gives | Notes |
| --- | --- | --- |
| [Robert Shiller's dataset](https://shillerdata.com) (`ie_data.xls`) | The S&P 500 every month since 1871: price, dividends, earnings, CPI, the 10-year rate, CAPE | Free, no key. The download link is read from the page, which changes it with every update; the old Yale address (`econ.yale.edu/~shiller/data/ie_data.xls`) is the fallback. Prices are the month's average close, and the latest six months with earnings are marked **provisional**: Shiller fills them from S&P's estimates and revises them later. |
| [Siblis Research](https://siblisresearch.com) free API (`/api/v1/NDX/<ratio>`) | The Nasdaq-100's trailing P/E (`pe-trailing`), forward P/E (`pe-forward`) and CAPE (`cape`) | Free, no key, but month-end snapshots only: 9 from December 2023 when this was built (half-yearly, then quarterly). Its NDX dividend yield comes back empty, and the S&P 500 isn't in the free tier. Each snapshot is kept, so the history grows. |
| FRED public CSV | `SP500` and `NASDAQ100` closes (kept as each month's last close and the latest day), `DGS10` (10-year Treasury yield), `NCBEILQ027S` (market value of US corporate equities) and `GDP` | Free, no key. FRED only has the last ten years of `SP500`. |

Ruled out when this was built: S&P Dow Jones Indices' `sp-500-eps-est.xlsx` answers 403 to scripts; GuruFocus and multpl would mean scraping against their terms; building the P/E from EDGAR filings and prices would take thousands of requests.

Shiller's file is an old-format Excel `.xls`. `src/lib/xls.ts` reads it (the OLE2 compound file, the shared strings, numbers and formulas' last values), so no spreadsheet library is needed. Its Data sheet's columns are found by their header (`Date`, `P`, `D`, `E`, `Rate GS10`, `CAPE`), and a decimal date like `2026.1` is October 2026.

## Stored series

`market_valuations` (in `db/schema.sql`) holds one row per market, metric and month-end date:

| Market | Metric | From |
| --- | --- | --- |
| `sp500` | `pe` (price over earnings), `earnings_yield` and `dividend_yield` (percent), `cape`, `ten_year`, `price`, `earnings` | Shiller |
| `sp500`, `ndx` | `level` (the index close) | FRED |
| `ndx` | `pe`, `pe_forward`, `cape` | Siblis |
| `us` | `ten_year` (DGS10), `buffett` (equities ÷ GDP, percent, quarterly) | FRED |

`market_valuation_summaries` keeps the latest AI summary for each index, with the data it was written from (`basis`).

## The job

`npm run market-valuation:update` (`scripts/update-market-valuation.ts`) fetches the three sources and upserts every series. A source that fails is reported and leaves its stored rows as they are; the job exits with an error then, but the others are still stored. `--dry-run` fetches and prints what it would store, without a database.

When `GEMINI_API_KEY` is set, it then writes each index's AI summary (`src/lib/market-valuation-summary.ts`): three or four sentences from the stored numbers only, plain text, no advice. A summary is rewritten only when a new month's P/E, CAPE or Buffett indicator has arrived (`--force-summary` rewrites it anyway), so the daily run costs no Gemini requests most days.

GitHub Actions runs it on weekdays at 22:30 UTC (`.github/workflows/market-valuation.yml`), with `DATABASE_URL` and optionally `GEMINI_API_KEY`. A manual run can be a dry run. Scheduled workflows only run from the default branch.

## The page

- **S&P 500 tab.** Today's P/E is an estimate: the latest close from FRED over Shiller's latest trailing earnings (marked when those are still provisional). Its zone comes from its percentile among every month's P/E since 1871. Then and now compares the monthly P/E with 1, 5, 10 and 20 years ago. Cards show the monthly P/E, CAPE, the earnings yield minus the 10-year yield, the dividend yield and the Buffett indicator, each against its own history. The chart switches between those measures over 10 years, 30 years or everything, with the average and one standard deviation either side.
- **Nasdaq-100 tab.** Today's trailing and forward P/E move the latest snapshot with the index since then: the close today divided by the earnings the snapshot implies (its close that month over its P/E). With under ten years of history there's no zone; the tab compares it with the S&P 500 instead.
- **Zones** (`ZONES` in `src/lib/market-valuation.ts`), by percentile of the index's own history, shown only with at least ten years (120 months) of it:

| Zone | Percentile |
| --- | --- |
| Cheap | below 25 |
| Fair | 25 to 75 |
| Expensive | 75 to 90 |
| Very expensive | 90 and above |

- **Home.** The Market valuation card in Markets shows today's S&P 500 P/E and its zone when the data is stored (`sp500Snapshot`).
- Without a database, or before the job has run, the page says what to run.

## Caveats

- Shiller's earnings are GAAP ("as reported"). Headlines often quote operating earnings, which leave out one-off costs, so their P/E is lower.
- The trailing P/E spikes when earnings collapse in a recession (123 in May 2009), which pulls its average up. CAPE smooths that out.
- The Buffett indicator here uses the market value of US corporate equities (FRED) over GDP; versions built on other market measures give different levels. It has trended up for decades.
- Valuation has said something about the next ten years' returns, and little about the next few months.
