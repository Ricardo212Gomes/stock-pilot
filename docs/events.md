# Market events

`/events` (Markets › Events) is a timeline of what's scheduled that can move US markets: Federal Reserve decisions, the main economic reports, US elections and deadlines, elections in major economies, and, on request, events found in the news by AI.

## Page

- **Up next:** four cards give the next Fed decision (with the current target range, the last move, and whether projections are due), the next CPI report, the next jobs report and the next major election, each with a countdown.
- **Timeline:** events grouped by month on a vertical line. Each shows the weekday and day, the category (an outline icon and its name), the time in Eastern time, a High impact badge, tags such as Projections or Trade, a countdown for the next 30 days, a one-line explanation and a link to its source. High-impact events have a filled dot. Past Fed decisions say what they decided ("Raised by 0.25 pt to 3.75–4.00%").
- **Filters:** a toggle per category (Fed & rates, Economic data, US politics, Global) with its count, how far ahead (3 months, the default, 12 months or All), High impact only, and the last 45 days.
- **Find events in the news:** the AI scan below. Its events join the timeline with a spark icon and "Found by AI in" the publisher.

## Sources

| Category | Events | Source | Cached |
| --- | --- | --- | --- |
| Fed & rates | FOMC decisions (2:00 PM ET), with Projections on the meetings marked * | [Fed meeting calendar](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm), parsed from its HTML | 24 hours |
| Fed & rates | Minutes, three weeks after each decision (the Fed's rule) | Worked out from the meetings | — |
| Fed & rates | The target range, its last change, and what past meetings decided | FRED's `DFEDTARU` and `DFEDTARL` CSV, no key | 6 hours |
| Economic data | CPI, the jobs report, PPI, JOLTS, the Employment Cost Index | BLS's [`bls.ics`](https://www.bls.gov/schedule/news_release/bls.ics) calendar | 24 hours |
| Economic data | GDP (advance, second and third estimates), PCE inflation (Personal Income and Outlays) | BEA's [release calendar](https://www.bea.gov/news/schedule) `.ics` | 24 hours |
| Economic data | Retail sales, durable goods orders | Census's [economic indicator calendar](https://www.census.gov/economic-indicators/calendar-listview.html), this year's page and the newest one | 24 hours |
| US politics | Federal elections, the new Congress (January 3), inaugurations (January 20), the September 30 funding deadline | Set by law (2 U.S.C. § 7, the 20th Amendment, 31 U.S.C. § 1102), worked out for four years | — |
| Global | National elections in the G20 and a few other major economies; the G7's are high impact | Wikipedia's [national electoral calendar](https://en.wikipedia.org/wiki/2027_national_electoral_calendar) for this year and next, through its API | 24 hours |

High impact: Fed decisions, CPI, the jobs report, PCE, the advance GDP estimate, US elections and inaugurations, and G7 elections. Everything else is medium.

Every source is optional. When one fails, its events are missing and the footnote says which. BLS, FRED and Census turn away some clients, so requests send the app's `StockPilot/1.0` User-Agent, which all of them accept from the server.

The timeline keeps 45 days of past events, so recent decisions and their outcomes stay in view.

### Limits

- BLS publishes the next year's dates late in the year, so its releases can stop at December until then. BEA's calendar runs further ahead.
- FOMC outcomes come from FRED's daily target range, which updates the day after a decision. An unscheduled move between meetings isn't shown as an event.
- The funding deadline is the end of the fiscal year. A stopgap that runs to another date only shows up if the AI scan finds it in the news.
- State elections, primaries and the State of the Union aren't on a calendar the page can read; the AI scan picks them up when the news dates them.

## AI scan: events in the news

Summits, trade and tariff deadlines, shutdown deadlines, OPEC+ meetings, court rulings and the like aren't on any free calendar. **Find events in the news** asks Gemini to find them in recent headlines (`src/lib/news-events.ts`):

1. The server collects about 300 headlines: Finnhub's market news (the last few days) and six Google News RSS searches over the last 14 days, for tariffs and trade deals, summits, funding and debt-limit deadlines, OPEC+, the Supreme Court, and ceasefires or talks. Duplicate titles are dropped.
2. Gemini (`GEMINI_MODEL`, by default the app's flash-lite model) returns up to 15 events as JSON: date, optional end date, `monthOnly` when only the month is known, title, kind (US politics, geopolitics, trade or energy), importance, a one-line reason and the id of the headline that gives the date.
3. The answer is checked before anything is shown: the date must be well formed, not past (a month-only event counts until its month ends) and no more than about 13 months out; the headline id must be one that was sent and have a link; duplicates are dropped. US politics goes in the US politics category, the rest in Global with a Trade, Energy or Geopolitics tag.

The prompt tells Gemini to use only dates the headlines give, never ones it knows from elsewhere, and to skip company, local and single-industry news, data releases and Fed meetings. The page reminds readers that AI can misread a headline and links every event to its article.

A scan is cached in memory for six hours (per server process), and the page shows a cached scan straight away. The button takes nothing from the browser, so the prompt only contains the headlines. Without `GEMINI_API_KEY` the button is hidden.

Gemini's Google Search grounding would find more, but it isn't available on the free tier and Google's terms require showing its search suggestions with the results, so the scan reads headlines instead. Google News RSS is meant for personal use, as in this app.

## Files

- `src/lib/event-sources.ts`: fetching and parsing each official source (FOMC HTML, FRED CSV, iCalendar, Census HTML, Wikipedia wikitext).
- `src/lib/market-events.ts`: the event model, categories, turning sources into events, the dates set by law, and `getMarketEvents`.
- `src/lib/news-events.ts`: the AI scan.
- `src/app/events/page.tsx`: the page and the Up next cards.
- `src/app/events/events-timeline.tsx`: filters and the timeline (client).
- `src/app/events/actions.ts`: the scan's server action.
