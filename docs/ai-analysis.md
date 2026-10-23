# AI review

On the Financials page, the **Income Statement**, **Balance Sheet**, **Cash Flow** and **Ratios** tabs have a spark icon in front of their title. Clicking it asks Google Gemini to explain that tab in plain language, for the selected period (annual or quarterly). The answer opens in a box under the title and subtitle; clicking the icon again, or ×, closes it. The charts-only Financials tab has no AI review.

Each tab and period keeps its own review, open or closed, while you move around Financials: switching to another tab or period and back shows the same answer again without a new request. Leaving Financials (for the Overview, Projections or News) clears them.

Each statement has its own focus in the prompt:

| Statement | What the review concentrates on |
| --- | --- |
| Income statement | Revenue growth; gross, operating and profit margins; R&D and SG&A against revenue; EPS against net income as the share count changes |
| Balance sheet | Cash and short-term investments against short-term debt and current liabilities; total debt and net cash (debt); equity and book value per share; anything unusual in assets |
| Cash flow | Operating cash flow against net income; capital expenditures; free cash flow and its margin; dividends, buybacks and debt; large stock-based compensation |
| Ratios | Valuation (PE, PS, PB, P/FCF, dividend yield) against their own history; profitability (margins, ROE, ROA); financial health (current ratio, debt to equity, interest coverage), with a short meaning for each ratio mentioned |

## Files

- `src/app/stock/financials/ai-review.tsx`: `AiReviewProvider` (the review store), `useAiReview`, `AiReviewButton`, `AiReviewPanel`, and `AiHeading` for server-rendered titles.
- `src/app/stock/financials/layout.tsx`: wraps Financials in `AiReviewProvider`. A Next.js layout stays mounted while only the URL's search parameters change, so reviews survive tab and period switches and are cleared when leaving Financials.
- `src/app/stock/financials/actions.ts`: the `reviewFinancials` server action.
- `src/lib/financial-review.ts`: which statements are reviewed, the per-statement instructions, the prompt, figure formatting and response cleanup.
- `src/lib/gemini.ts`: the shared Gemini request helper, also used by the projections AI autofill (see [`stock-projections.md`](./stock-projections.md)).
- `src/app/components/spark-icon.tsx`: the spark icon used on every AI action.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Yes | | `GOOGLE_GENERATIVE_AI_API_KEY` is accepted as a fallback. |
| `GEMINI_MODEL` | No | `gemini-3.5-flash-lite` | Any model that supports `generateContent`. |

The key is read only on the server and sent in the `x-goog-api-key` header, never to the browser.

## What is sent

`reviewFinancials(symbol, statement, period)` takes only the ticker, the statement and the period. It reloads the statement table on the server with `getStatementTable`, so the prompt never contains figures sent by the browser. Those requests are usually already cached from loading the page.

The statement goes to Gemini as its column labels with period-end dates, and its rows with values formatted the way the page shows them ("$466.8B", "+6.4%", "$8.73"). Formatted figures keep the answer readable; with raw numbers the model quoted values like 466823000000 and 0.0643.

The request uses temperature 0.2, a 700-token limit and a 45-second timeout. Answers are stored per company, tab and period in `AiReviewProvider`, so reopening a review doesn't call Gemini again. A review still loading when you switch tabs finishes in the background and is there when you come back. Leaving Financials or reloading the page clears them; a failed review is requested again the next time it's opened.

## Prompt rules

The system instruction asks Gemini to:

- explain the statements in plain language, addressing the reader directly, using only the supplied figures and quoting them as written;
- compare the newest period with the previous one and the oldest instead of listing every period, using at most six figures;
- write about 120 words of plain text in three short paragraphs: what the statement shows, the main trends, and what to watch;
- give no buy/sell advice or price targets.

`reviewParagraphs` strips any Markdown the model adds anyway (bold, headings, bullets) and splits the answer into paragraphs.

## Errors

| Situation | Message shown |
| --- | --- |
| Invalid ticker or tab | There is nothing to review for this tab. |
| FMP failure | The FMP message for the reason, e.g. its request limit |
| No Gemini key | Gemini is not configured. |
| 401 or 403 | Gemini rejected the API key. |
| 429 | Gemini's request limit was reached. |
| Empty response | Gemini returned an empty review. |
| Network failure or timeout | Gemini could not be reached. |
