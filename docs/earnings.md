# Earnings calendar

`/earnings` lists the companies reporting results each day of a week, from Finnhub's free earnings calendar. Before a report it shows analysts' EPS and revenue estimates; after, the actual figures and the surprise against the estimate. The sidebar links to it under Markets.

## Files

- `src/app/earnings/page.tsx`: loads the week on the server and builds the navigation links and summary.
- `src/app/earnings/earnings-board.tsx`: the interactive week grid (search, "+N" expansion and the details dialog).
- `src/lib/earnings-calendar.ts`: dates, loading, company names, grouping and surprises.
- `src/lib/finnhub.ts`: the shared Finnhub client and its failure messages, also used by the news page.

## URLs

| Parameter | Meaning | Default |
| --- | --- | --- |
| `week` | Any date in the week to show (`YYYY-MM-DD`); the page snaps to its Monday | The current week, or the next one on Saturdays and Sundays |
| `all=1` | Show every company | Large companies only |

"Today" is the date in New York, where US companies report, so the default week and the Today badge match the market's calendar.

## Data

| Source | Request | Cached |
| --- | --- | --- |
| Finnhub `calendar/earnings?from=…&to=…` | One per week shown | 1 hour, so results reported during the day appear |
| Finnhub `stock/symbol?exchange=US` | Company names for all ~31,000 US symbols | 24 hours in server memory |

The symbol list is about 7 MB, over the Next.js data cache's 2 MB limit, so it is kept as a symbol-to-name map in memory instead. Without it the calendar still works and shows tickers only. Names are cleaned from Finnhub's upper-case form: "COCA-COLA CO/THE" becomes "Coca-Cola Co", "META PLATFORMS INC-CLASS A" becomes "Meta Platforms Inc", and vowelless words stay acronyms (RTX, AT&T).

## Layout

The page follows earnings-calendar sites such as Dividend Data: a week grid with one column per weekday (stacked on phones), today's date in a filled circle.

- Each day is split into **Before Open**, **During Market**, **After Close** and **Time TBA**. Weekend days appear only when something is scheduled.
- Each company is a tile with its logo and ticker, sorted by expected revenue, largest first. A section shows 11 tiles and a **+N** tile that reveals the rest.
- A green or red dot on a tile means the company has reported and beat or missed the EPS estimate.
- Selecting a tile opens a dialog with the company name, report time, quarter, EPS and revenue estimates, actual figures and surprises, and a link to its Overview.
- The search box filters every day by ticker or company name.
- Logos come from FMP's public `image-stock/<ticker>.png` URLs, which need no API key. A missing logo falls back to the ticker's first letters. The logo box stays white in dark mode because most logos are drawn for light backgrounds; a few white-on-transparent logos still look blank.
- **Large companies** (the default) are those expected to report at least $1B of quarterly revenue, about a third of a typical week's 400–950 reports. **All companies** shows every one.
- A summary line counts the week's reports and, once results are out, how many beat the EPS estimate.

Surprise is (actual − estimate) ÷ |estimate|, shown in green when results beat the estimate and red when they miss. Nothing is shown when the estimate is zero or missing.

## Errors

If the calendar request fails, the page explains why with the shared Finnhub messages: no key, invalid key, plan restriction, rate limit, or another error.
