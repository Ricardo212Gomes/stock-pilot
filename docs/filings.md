# SEC filings

`/stock/filings?symbol=AAPL` is the **Filings** company tab: the company's filings with the SEC, newest first, with links to the documents on sec.gov. It uses the SEC's free EDGAR submissions API, which needs no key and covers every company that files with the SEC.

## Filters

| Filter (`type`) | Forms |
| --- | --- |
| Important (default) | 10-K, 10-Q, 20-F, 40-F, 6-K, 8-K, proxies, and offerings and takeover filings (S-1, S-3, S-4, 424B4, SC 13D, SC TO-T) |
| Annual & quarterly (`reports`) | 10-K, 10-Q, 20-F, 40-F, 6-K and amendments |
| Earnings releases (`earnings`) | 8-Ks with item 2.02, "Results of Operations and Financial Condition" |
| Other events (`events`) | All other 8-Ks |
| Proxy (`proxy`) | DEF 14A, DEFA14A, PRE 14A, DEFM14A |
| Insider (`insider`) | Forms 3, 4 and 5, and Form 144 (planned sales) |

Thirty filings show at a time, with **Show more filings** below (`page`). The list covers the SEC's latest 1,000 filings for the company, usually several years; insider forms take up most of them for large companies.

## Rows

- **Filed** date and the **form**, highlighted for earnings releases.
- A plain description: the form's purpose ("Quarterly report", "Insider trade"), or for an 8-K its items ("Executive or director change · Regulation FD disclosure"). Item 9.01, which only lists exhibits, is left out.
- The period: "Quarter ended …" for a 10-Q, "Year ended …" for a 10-K, or the event date when it differs from the filing date.
- Links: **Document** (the main document), **All files** (the filing index) and, for earnings releases, **Press release**: exhibit 99.1, found in the filing's file list (`index.json`). Up to eight press releases are looked up per page shown.

## Requests and caching

- `https://www.sec.gov/files/company_tickers.json` for the ticker's CIK (cached for a day, shared with the statements fallback in [`data-fallbacks.md`](./data-fallbacks.md)).
- `https://data.sec.gov/submissions/CIK##########.json` for the filings (~150 KB, cached for 6 hours).
- A filing's `index.json` per press release (cached for 30 days; filings don't change).

The SEC limits automated clients to 10 requests a second and asks them to identify themselves in the User-Agent. Requests use `SEC_USER_AGENT` when set; the SEC recommends including a contact email, for example `StockPilot you@example.com`. Browsers opening the document links are unaffected, but the SEC can briefly block a network it sees sending heavy automated traffic.

## Files

- `src/lib/sec-filings.ts`: loading, parsing, descriptions, filters and press-release lookup.
- `src/app/stock/filings/page.tsx`: the page.
