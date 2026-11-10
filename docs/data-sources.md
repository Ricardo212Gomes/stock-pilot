# Data sources: which API, when

StockPilot runs on free plans, and each provider's free plan is tight in a different way: FMP allows 250 requests a day and only a sample of large companies, Finnhub 60 a minute but no analyst targets or estimates, Tiingo 50 an hour but only prices, Alpha Vantage 25 a day. So each kind of data comes from the source that gives it for free, everything is cached for as long as it stays true, identical requests are shared between pages, and a fallback stands in when a source can't answer. This page is the map; each feature's own doc has the details.

## The providers

| Provider | Free plan | Key | Use it for | Not for |
| --- | --- | --- | --- | --- |
| [Financial Modeling Prep](https://site.financialmodelingprep.com) | 250 requests a day; statements, targets and estimates for a sample of popular large companies (36 of the 100 largest) | `FMP_API_KEY` | What only it gives free: price targets, annual estimates, rating changes, ratios, segments, dividends, the Overview's full quote (with volume), the VIX quote, statements for the companies it covers | Quotes on headers and lists, ratings, earnings dates, prices when Tiingo is set up: free elsewhere |
| [Finnhub](https://finnhub.io) | 60 requests a minute (30 a second), every US stock | `FINNHUB_API_KEY` | Quotes (headers, lists, the Portfolio, fallback), company profile and share count, TTM metrics and growth, analyst ratings (four months), the earnings calendar and surprises, insider trades, news, a US ISIN's ticker (statement imports) | Price targets, estimates, upgrades and candles (paid); foreign ISINs (paid) |
| [SEC EDGAR](https://www.sec.gov/edgar) | Free, no key, 10 requests a second, an identifying User-Agent | `SEC_USER_AGENT` (optional) | Filings, Form 4 insider filings, statements when FMP doesn't cover a company | Anything needing a price |
| [Tiingo](https://www.tiingo.com) | 50 requests an hour, 1,000 a day, 500 stocks a month | `TIINGO_API_KEY` (optional) | Five years of daily closes with splits and dividends: the Overview chart first, the Portfolio's history, splits and dividends, any price history FMP can't give | Bulk screening (the hourly cap) |
| [Frankfurter](https://frankfurter.dev) | Free, no key | — | The European Central Bank's daily euro rates, for portfolios in euros or with trades in euros | Anything else |
| [Alpha Vantage](https://www.alphavantage.co) | 25 requests a day | `ALPHAVANTAGE_API_KEY` (optional) | Earnings call transcripts, each fetched once and saved | Anything else: its company overview with analyst targets is now paid |
| Google Gemini | The free tier's per-minute and daily limits | `GEMINI_API_KEY` | AI reviews and summaries, valuation autofill, the events news scan, notification digests and the AI chat, always on request or once per item | Facts: it only reads data the app gives it |
| Official calendars: Federal Reserve, FRED, BLS, BEA, Census Bureau, Wikipedia | Free, no key | — | The events timeline | — |
| Cboe | Free, no key | — | The VIX's daily history since 1990 | — |
| Google News RSS | Free, for personal use | — | Headlines for the events news scan | — |
| FINVIZ | Free embed | — | Market maps | — |

## Rules of thumb

1. **Spend FMP only on what's FMP's alone.** Its 250 daily requests are the scarcest budget, so anything another source gives free comes from there: header and list quotes, ratings, earnings dates and the share count from Finnhub, the Overview chart's prices from Tiingo.
2. **Quotes:** Finnhub first wherever only the price, name and market cap are shown (company headers, Favorites, Compare, the valuation tools). The Overview asks FMP first because its quote has the day's volume, and falls back to Finnhub. Without an FMP key, quotes still work from Finnhub.
3. **Price history:** the Overview chart takes Tiingo's five years first, then FMP's. Recommendations and the Forecast chart take FMP's one year first (Recommendations needs 36 at once, which would use most of Tiingo's hourly allowance), then Tiingo's. All three share Tiingo's one request a company a day, and so does the Portfolio, whose request also carries each split and dividend.
4. **Statements:** FMP for the companies it covers, cached a day; SEC company facts otherwise (2–10 MB each, so converted in memory and kept 12 hours).
5. **Analysts:** ratings from Finnhub for every company, one request shared by the Overview, the Forecast tab and Recommendations, so all three show the same consensus. Targets, estimates and rating changes only exist for FMP's covered companies on the free plans.
6. **Calendars:** earnings from Finnhub (the week view, the Overview's next report and Transcripts' latest share requests), dividends from FMP's calendar, macro events from the official calendars.
7. **Insiders:** Finnhub's Form 4 trades, enriched with roles and 10b5-1 plans from the SEC filings, which never change and are cached for a month.
8. **AI only on request,** never on a page load: reviews, summaries, the news scan and the chat run when asked, are cached or saved, and only see data the app fetched. The chat's look-ups go through the pages' own loaders and caches.

## Caching and failures

Every request goes through Next's data cache with a window matched to how often the data changes:

| Window | Data |
| --- | --- |
| 1 minute | Quotes (FMP, Finnhub), the VIX quote |
| 15 minutes | News, leaderboards of movers |
| 1 hour | FMP company profile, the earnings calendar week, Google News searches |
| 6 hours | Price history (FMP), SEC filings lists, FRED's target range, Finnhub's insider trades and company calendar, the largest companies' market caps |
| 24 hours | Statements, ratios, targets, estimates, ratings, rating changes, daily closes, Tiingo's prices, release calendars |
| 30 days | Each Form 4 filing (they never change), Tiingo's fund names |

Identical requests share one cached answer across pages, so parameters are kept the same on purpose: the price target, annual income statement and estimates requests are shared by the Overview, Financials, Compare, Forecast and Recommendations; the one-year closes by Recommendations and Forecast; Tiingo's five years by the Overview chart and the Portfolio; Finnhub's ratings by three pages, its company calendar by two, and its quotes and company profiles by the company headers, Favorites and the Portfolio.

Next only caches successful responses, so failures need their own handling:

- **What a plan refuses (FMP 402)** never changes until the plan does, so `fetchFmp` remembers each refusal for a day in memory: a whole endpoint (like the company screener), a company outside the sample per endpoint, or an exact request. Without this, every visit to a company outside FMP's sample re-sent about nine refused requests.
- **A daily or rate limit (429)** is recorded for the Data sources card but not skipped: requests keep going through Next's cache, which still answers what it has, while fallbacks fill the rest (Finnhub quotes, SEC statements, Tiingo prices).
- **An invalid key (401)** is reported, never covered up by a fallback.

Settings › Data sources shows each source's status since the server started: limits reached, recent failures, how many FMP refusals are remembered and how often Tiingo stood in.

## What a page costs

FMP requests for a first, uncached view; repeat views within the cache windows cost nothing, and shared requests are counted once.

| Page | Sources | FMP requests |
| --- | --- | --- |
| Overview | FMP quote, profile, quarterly income, price target, dividends, estimates; Finnhub metrics, ratings, company calendar, profile; Tiingo prices (FMP without a key); SEC when FMP doesn't cover the company | 6 (7 without Tiingo) |
| Financials | FMP statements, ratios, estimates and segments; Finnhub TTM ratios; SEC fallback | about 9 |
| Forecast | FMP target, target summary, estimates, annual income, grades, earnings, closes; Finnhub ratings and surprises | up to 7, about 3 after the Overview and Recommendations |
| Insiders, Filings, News, Transcripts | Finnhub, SEC, Alpha Vantage | 0 |
| Valuation tools | FMP statements, ratios, estimates, profile, treasury rates (shared with Financials); Finnhub quote and shares | about 6 |
| Compare | Per stock: FMP quarterly and annual income, estimates; Finnhub quote and metrics | 3 per stock |
| Recommendations | FMP coverage check, then a price target and a year of closes per covered company; Finnhub ratings | about 73 a day |
| Stocks | FMP leaderboard (the largest list from the snapshot and one market-cap batch on plans without the screener) | 1 per list |
| Favorites | Finnhub quotes | 0 |
| Portfolio | Finnhub quotes and company profiles; Tiingo prices, splits and dividends (and SPY's for the comparison); Tiingo names for funds; Frankfurter's euro rates when needed. A statement import looks up only the companies held (Finnhub profiles by ISIN, Tiingo prices for foreign ones), once each; companies sold off are kept without prices and cost nothing | 0 |
| Events | Official calendars; Gemini, Google News and Finnhub for the news scan | 0 |
| AI chat (each question) | Gemini, plus the look-ups the answer asks for (see [`chat.md`](./chat.md)), through the same cached requests as the pages | Usually 0 for the company on screen; otherwise what that company's pages cost |
| VIX | FMP's VIX quote, Cboe's history | 1 a minute at most |
| Earnings, Dividends | Finnhub; FMP's dividend calendar | 0; 1 per month shown |
| Notifications (GitHub Actions) | Finnhub, SEC, Alpha Vantage, Gemini | 0 |

A company looked at closely (Overview, Financials and Forecast) costs about 15 FMP requests the first time each day, so about fifteen such companies a day fit in the free plan, alongside a Recommendations screen. Beyond that, pages keep working from the fallbacks and the cache until FMP's limit resets; FMP's paid plans lift both the daily limit and the company sample.
