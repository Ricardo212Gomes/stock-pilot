# News

The `/news` page shows global market news by category, and company news for a ticker, from [Finnhub](https://finnhub.io). It's a server component with no client JavaScript. The sidebar links to it under Markets, and the company tabs (see [`stock-overview.md`](./stock-overview.md)) include **News**.

## Files

- `src/app/news/page.tsx`: the page, category tabs, empty and error states, and pagination.
- `src/lib/finnhub-news.ts`: fetching, normalizing, cleaning and de-duplicating news, plus the failure messages.

## Configuration

Set `FINNHUB_API_KEY` in your environment file and restart the server. The key is sent in the `X-Finnhub-Token` header, so it never appears in URLs or logs. Finnhub's "secret" is only used to verify webhooks and isn't needed.

## Feeds

| View | Finnhub endpoint | Returns |
| --- | --- | --- |
| `/news` | `news?category=general` | About 100 latest business and markets headlines |
| `/news?category=merger` | `news?category=merger` | Deal news |
| `/news?category=forex` | `news?category=forex` | Currency and macro news (often only a few items) |
| `/news?category=crypto` | `news?category=crypto` | Crypto news |
| `/news?symbol=AAPL` | `company-news?symbol=AAPL&from=…&to=…` | Headlines for the last 14 days |

Each view is one request, cached for 15 minutes. Finnhub's free plan allows 60 requests a minute. Market news has no paging upstream, so the page splits each response into pages of 25. URLs count from 1 (`?page=2` is the second page).

Tickers are converted to Finnhub's format, so `BRK-B` becomes `BRK.B`. An unknown ticker returns no items, and the page shows an empty state with a link back to market news.

## Normalization

| `NewsItem` field | Finnhub field |
| --- | --- |
| `title` | `headline`, minus a trailing " - Source" (Google News wire copies) |
| `publishedAt` | `datetime` (Unix seconds), as UTC ISO 8601 |
| `summary` | `summary`, as plain text; empty when it only repeats the headline |
| `url` | `url`, only if http or https |
| `source` | `source` |
| `tickers` | `related`, comma-separated |

- Summaries sometimes contain HTML (Forexlive). `plainTextSummary` strips tags, scripts and styles, decodes entities and trims to 280 characters at a word boundary. Nothing from Finnhub is rendered as markup.
- Headlines in Chinese, Japanese or Korean are dropped. The merger feed mixes in translated BusinessWire copies, and the interface is English.
- Items are sorted newest first and de-duplicated by URL (or by headline when there's no URL).
- Times are shown in UTC, because the page renders on the server.
- Images are skipped. Most are generic publisher logos.

## Errors

| Finnhub status | Message |
| --- | --- |
| No key | Add `FINNHUB_API_KEY` to `.env` and restart |
| 401 | Finnhub rejected the API key |
| 402, 403 | Your Finnhub plan doesn't include this news |
| 429 | The request limit has been reached; it resets within a minute |
| Other, timeout, bad JSON | Finnhub could not return the news |
