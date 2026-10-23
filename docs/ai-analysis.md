# AI analysis

The **Analyze with AI** button on the stock page sends the loaded annual fundamentals to Google Gemini and shows a plain-text summary. The panel only appears once FMP fundamentals have loaded.

## Files

- `src/app/stock/ai-analysis.tsx`: the client panel. It calls the server action and shows the pending, error and result states.
- `src/app/stock/actions.ts`: the `analyzeFundamentals` server action. It validates the input, builds the prompt and calls Gemini.
- `src/lib/ai-analysis-types.ts`: the `AIAnalysisResult` type shared by both.
- `src/lib/gemini.ts`: the shared Gemini request helper, also used by the projections AI autofill (see [`stock-projections.md`](./stock-projections.md)).

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Yes | | `GOOGLE_GENERATIVE_AI_API_KEY` is accepted as a fallback. |
| `GEMINI_MODEL` | No | `gemini-3.5-flash-lite` | Any model that supports `generateContent`. |

The key is read only on the server and sent in the `x-goog-api-key` header, never to the browser.

## What is sent

Server actions accept input from the client, so `cleanFundamentals` re-validates everything before it reaches the prompt:

- The ticker must pass `normalizeTicker`, and there must be 1 to 5 periods.
- Dates, fiscal years, period names and currency codes must match strict patterns, or they're replaced with safe placeholders.
- Only 18 numeric fields are kept (revenue, margins, debt, cash flow and similar). Non-finite values become `null`.
- Valuation and dividend fields are left out.

The request uses temperature 0.2, a 1,200-token output limit and a 45-second timeout. Responses are not cached.

## Prompt rules

The system instruction asks Gemini to:

- use only the supplied metrics and treat `null` as unavailable;
- compare periods with numbers and say when missing data limits a conclusion;
- give no buy/sell advice or price targets;
- answer under four headings: Revenue and profitability; Debt and liquidity; Cash generation; Strengths, risks, and limits.

## Errors

| Situation | Message shown |
| --- | --- |
| No usable metrics | There are no usable financial metrics to analyze. |
| No API key | Gemini is not configured. |
| 401 or 403 | Gemini rejected the API key. |
| 429 | Gemini's request limit was reached. |
| Empty response | Gemini returned an empty analysis. |
| Network failure or timeout | Gemini could not be reached. |
