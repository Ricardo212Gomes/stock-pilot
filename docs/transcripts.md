# Earnings call transcripts

`/stock/transcripts?symbol=AAPL` shows a company's earnings calls, speaker by speaker, as the **Transcripts** company tab. Transcripts come from [Alpha Vantage](https://www.alphavantage.co)'s `EARNINGS_CALL_TRANSCRIPT` endpoint, which covers companies the free FMP plan doesn't, such as CrowdStrike.

## Setup

Set `ALPHAVANTAGE_API_KEY` in the environment file. With `DATABASE_URL` set, run `npm run db:setup` once so the `transcripts` table exists (see [`favorites.md`](./favorites.md)).

## Free-key limits

The free key allows **25 requests a day** and **one a second**. Alpha Vantage answers both limits with status 200 and an `Information` message instead of data, so the app reads that as "rate limited" and never saves it.

To stay within the limit, every answer is saved:

- In Postgres (`transcripts` table: symbol, quarter, segments as JSON, fetched_at) when `DATABASE_URL` is set, otherwise in server memory until a restart.
- A transcript, once loaded, is never requested again.
- A quarter Alpha Vantage has no transcript for is saved as empty and asked again after a day for the newest quarter, or a week for older ones.
- Requests are spaced at least 1.1 seconds apart.

Opening a company the first time costs one request for its latest quarter, plus up to four more if Alpha Vantage doesn't have the most recent calls. Opening another quarter costs one request. Revisits cost nothing.

## Fiscal quarters

Quarters follow the company's fiscal year, as Alpha Vantage labels them: `2026Q2` is fiscal 2026's second quarter. For CrowdStrike, whose year ends in January, that's the call in August 2025.

The latest reported quarter comes from Finnhub's free earnings calendar for the company (`calendar/earnings?symbol=…`), which gives the next report's fiscal year and quarter; the one before it is the latest reported. Without it, the calendar quarter before today's is used. The page lists that quarter and the seven before it.

By default the page opens the latest quarter. If Alpha Vantage doesn't have it, it walks back up to four quarters to the most recent one it has, and says so. Quarters known to be missing are struck through in the list.

## Page

- A participants card lists everyone who speaks, with their title, and a link that jumps to the questions and answers. The Q&A starts at the operator's first mention of questions after the prepared remarks.
- Each turn shows the speaker, their title and the text. Alpha Vantage scores each passage's sentiment from -1 to 1; scores of 0.3 or more show a "Positive tone" pill, -0.3 or less "Negative tone".
- When FMP's plan doesn't cover the company, the header uses its name from the bundled stock list.

## AI summary

**Summarize with AI**, above the participants, asks Gemini to read the whole call (`summarizeTranscript` in `src/app/stock/transcripts/actions.ts`) and returns a short overview, up to five highlights, up to four outlook and guidance points, up to four themes analysts asked about with management's answers, and management's tone (positive, neutral, cautious or negative) with the reason. The answer is structured JSON (`SUMMARY_SCHEMA`), cleaned by `parseSummary`.

- Only the ticker and quarter come from the browser; the transcript is the server's saved copy, so the prompt never contains text from the browser.
- Calls over about 120,000 characters (~30,000 tokens) are cut, keeping the beginning of the Q&A.
- Each summary is saved in the transcript's row (`summary` column, added by `npm run db:setup`), or in memory without a database. A call is summarized once; anyone opening it later sees the summary straight away.

## Files

- `src/lib/transcripts.ts`: fiscal quarters, the latest reported quarter, fetching, parsing and saving transcripts.
- `src/lib/transcript-summary.ts` and `src/app/stock/transcripts/transcript-summary.tsx`: the AI summary's prompt, parsing, saving and card.
- `src/app/stock/transcripts/page.tsx`: the page.
- `db/schema.sql`: the `transcripts` table.

## Coverage

Alpha Vantage has most large US companies, but some recent calls are missing: in October 2026 it had CrowdStrike's calls up to fiscal 2026 Q4 (March 2026) but not the two since, while Apple's July 2026 call was there.
