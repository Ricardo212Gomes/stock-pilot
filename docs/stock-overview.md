# Stock overview

`/stock?symbol=AAPL` is the landing page for each company, modelled on StockAnalysis's overview. It shows the latest quote, two columns of key statistics, a daily price chart and a short company profile. A tab bar under the header links to the company's other pages.

## Company tabs

`StockNav` (`src/app/components/stock-nav.tsx`) shows the same tabs on every page about one company:

| Tab | Route |
| --- | --- |
| Overview | `/stock?symbol=AAPL` |
| Financials | `/stock/financials?symbol=AAPL` (statements, ratios and the AI review; see [`financials.md`](./financials.md)) |
| News | `/news?symbol=AAPL` |
| Transcripts | `/stock/transcripts?symbol=AAPL` (earnings calls; see [`transcripts.md`](./transcripts.md)) |
| Filings | `/stock/filings?symbol=AAPL` (SEC filings; see [`filings.md`](./filings.md)) |

Search, the home page examples and breadcrumbs land on the Overview.

Every company tab shares the same header (`CompanyHeader`: the quote, or the company name from the bundled stock list when no quote is available) and tab bar, and is titled "AAPL Overview — StockPilot", "AAPL Financials — StockPilot" and so on (`companyMetadata`). The top bar reads "AAPL · Overview", and the footer credits the tab's source.

## Search

The top bar search (`src/app/components/ticker-search.tsx`) takes a company name or a ticker. Matching runs in the browser over `src/data/us-stocks.json`, a list of about 5,900 US-listed stocks, so typing makes no API requests. The list is a separate ~70 KB (compressed) chunk, loaded the first time the search box gets focus.

- Results, up to 8: an exact ticker first, then names starting with the query, tickers starting with it, a word starting with it, and names containing it. Ties go to Nasdaq Global Select and NYSE listings, then the shorter name, so "apple" lists Apple Inc. before Apple Hospitality REIT. Case and punctuation are ignored ("coca cola" finds Coca-Cola).
- A few brands listed under another name are mapped by hand: Google and YouTube to GOOGL and GOOG, Facebook, Instagram and WhatsApp to META, and so on (`BRAND_ALIASES` in `src/lib/stock-search.ts`).
- Arrow keys move through the suggestions; Enter opens the highlighted one, else the best match, else what was typed as a ticker.
- On the Valuation tools and News, the search stays on that page for the new ticker.

`npm run symbols:update` rebuilds the list from Nasdaq's public symbol directory (`nasdaqlisted.txt` and `otherlisted.txt`; no key needed). It keeps common stocks and ADRs, and drops ETFs, test issues, warrants, rights, units, preferred shares and notes. Share classes use a dash, as FMP does (BRK-B). Run it now and then to pick up new listings, and commit the updated file.

## Files

- `src/app/stock/page.tsx`: the overview page, stat tables and About section.
- `src/app/components/quote-header.tsx`: the name and price header, shared with Financials.
- `src/lib/stock-overview.ts`: `getStockOverview`, which loads and combines the data.
- `src/lib/finnhub.ts`: the shared Finnhub client, also used by the news page.
- `src/app/stock/price-history-chart.tsx`: the price chart. The overview uses its `compact` mode, which hides the chart's own title and latest close because the page header already shows them.

## Data

The quote is required; if it fails, the page explains why. Every other figure is optional: a restricted or failed endpoint leaves that row as "—" instead of failing the page.

| Statistic | Source | Cached for |
| --- | --- | --- |
| Price, change, volume, open, previous close, day and 52-week range, market cap | FMP `quote` | 1 minute |
| Revenue, net income and EPS (ttm) | Sum of the last 4 quarters from FMP `income-statement?period=quarter` | 24 hours |
| Revenue and EPS growth (ttm, year over year) | Finnhub `stock/metric` | 24 hours |
| Shares out | FMP `shares-float`, or market cap ÷ price | 24 hours |
| PE ratio | Price ÷ EPS (ttm), when EPS is positive | — |
| Forward PE | Price ÷ the next fiscal year's consensus EPS from FMP `analyst-estimates` | 24 hours |
| Dividend and yield | Latest FMP `dividends` payment × its yearly frequency (quarterly × 4, monthly × 12…), ÷ price | 24 hours |
| Ex-dividend date | Date of the latest FMP dividend, which may be announced for the future | 24 hours |
| Beta, sector, industry, CEO, employees, website, description | FMP `profile` | 1 hour |
| Analysts | FMP `grades-consensus` rating; the hover text gives the analyst count | 24 hours |
| Price target | FMP `price-target-consensus`, with the gap to today's price | 24 hours |
| Earnings date | The earliest upcoming FMP `earnings` date without reported EPS | 24 hours |

TTM uses quarterly statements because the free plan restricts FMP's TTM statement endpoint, and quarterly requests to 5 rows (enough for four quarters, not for year-over-year growth). That's why growth comes from Finnhub.

An uncached overview costs 11 FMP requests and 1 Finnhub request. The analyst estimates use the same parameters as the Financials page, so the two pages share that cached response.

## Display

- Large numbers use compact notation with two decimals (5.06T, 466.82B). Price-level figures have two decimals, growth one.
- Terms with a dotted underline explain themselves on hover, for example P/E, Beta and Forward PE.
- The quote time is shown in New York time, where US listings trade.
- The chart offers 5D, 1M, 6M, YTD, 1Y and 5Y from daily closes. Intraday prices need a paid FMP plan, so there's no 1-day intraday view, and the chart ends at the last daily close.

## Limits

- FMP's free plan doesn't quote every ticker. Some companies and most non-US listings (for example BRK-B and SAP) return 402, and so do tickers that don't exist. The page can't tell these apart, so its message covers both.
- Net income growth and market cap growth aren't shown, because they'd need eight quarters of history.
