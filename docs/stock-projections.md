# Stock projections

The `/projections?symbol=…` page estimates a company's intrinsic value with six valuation models. It first works out what kind of stock it is, then recommends the models that fit. It fills every assumption from the filings, and an optional AI autofill can suggest forward-looking values instead. Everything recalculates in the browser as the user edits.

## Files

| File | Role |
| --- | --- |
| `src/app/projections/page.tsx` | Server page: loads data, shows errors, renders the workbench |
| `src/app/projections/data.ts` | `loadProjectionData`: fundamentals, profile and Treasury yield, then classification and defaults |
| `src/app/projections/actions.ts` | `autofillAssumptions` server action (Gemini) |
| `src/app/projections/projection-workbench.tsx` | Client state, layout and derived results |
| `src/app/projections/projection-parts.tsx` | Assumption field, model card, football field, projection chart and tables |
| `src/lib/valuation/assumptions.ts` | Every assumption: label, unit, allowed range, short and long explanations |
| `src/lib/valuation/models.ts` | The models, scenarios, reverse DCF, sensitivity grid, verdict and blended value |
| `src/lib/valuation/classify.ts` | Stock type detection and which models suit each type |
| `src/lib/valuation/defaults.ts` | Data-derived starting values and assumptions, each with a note on its source |
| `src/lib/valuation/autofill.ts` | Autofill prompt, response schema and parsing |
| `src/lib/gemini.ts` | Shared Gemini request helper, also used by the AI analysis |

The math in `src/lib/valuation` is pure TypeScript with no React or network code, and is covered by unit tests.

## Stock types

The classifier checks these rules in order and stops at the first match:

| Type | Rule | Recommended | Cross-checks |
| --- | --- | --- | --- |
| Bank or financial | Sector "Financial Services" and a bank, insurance, credit or asset-management industry | Residual income | DDM, earnings |
| Real estate (REIT) | Sector "Real Estate" and a REIT industry | DDM | DCF |
| Unprofitable | Latest net income or EPS at or below zero | Revenue and margin | DCF |
| Cyclical | Energy or Basic Materials sector, or a cyclical industry (oil, steel, autos, airlines…) | DCF on average FCF | Earnings, Graham |
| High growth | Revenue growing 15% a year or more | Earnings, DCF | Revenue |
| Cyclical (earnings) | Net income varying more than 50% around its average | DCF on average FCF | Earnings, Graham |
| Dividend payer | Dividend yield of 2.5% or more | DDM, DCF | Graham |
| Stable compounder | Everything else | DCF | Earnings, Graham |

High growth is checked before earnings swings, because fast growth also makes earnings vary a lot.

## Models

All values are per share. r is the discount rate, g the terminal growth, and n the projection length.

| Model | Formula | Best for |
| --- | --- | --- |
| DCF | Σ FCFₜ/(1+r)ᵗ + [FCFₙ(1+g)/(r−g)]/(1+r)ⁿ | Steady cash generators |
| Earnings and exit multiple | Σ EPSₜ·payout/(1+r)ᵗ + EPSₙ·exit P/E/(1+r)ⁿ | Profitable growth companies |
| Revenue and target margin | Revenueₙ · target margin · exit P/E/(1+r)ⁿ | Unprofitable or early-stage companies |
| Dividend discount (two-stage) | Σ Dₜ/(1+r)ᵗ + [Dₙ(1+g)/(r−g)]/(1+r)ⁿ | Mature dividend payers, REITs, utilities |
| Residual income | Book₀ + Σ (ROE−r)·Bookₜ₋₁/(1+r)ᵗ + [(ROE−r)·Bookₙ/(r−g)]/(1+r)ⁿ | Banks and insurers |
| Graham formula | EPS · (8.5 + 2g) · 4.4 / Y | A quick sanity check |

Implementation notes:

- **DCF** discounts free cash flow after interest (operating cash flow minus capex) at the cost of equity, so it does not subtract net debt. It is a simplified FCFE model.
- **Residual income** retains earnings each year (book value grows by ROE × book × (1 − payout)). Excess returns continue after the projection, growing at the terminal rate. With constant ROE and growth it reduces to the justified price-to-book formula: Book × (ROE − g)/(r − g).
- **Graham** uses Graham's revised 1974 formula. g is in percent and capped at 15%, because the formula overstates fast growers. Y is the AAA corporate bond yield in percent.
- Models that need positive inputs (FCF, EPS, dividends, book value, revenue) say why they can't run instead of showing a number. Perpetuity models refuse a discount rate at or below terminal growth.

## Default assumptions

Starting values come from the latest annual filing, divided by diluted weighted-average shares. If the share count is missing, market cap ÷ price is used instead.

| Assumption | Default |
| --- | --- |
| Discount rate | CAPM: 10-year Treasury yield + beta × 4.25% equity risk premium. Beta is clamped to 0.6–2.5 and the result to 6–16%. |
| Equity risk premium | 4.25%, after Damodaran's mature-market implied premium of 4.23% (January 2026) |
| Risk-free rate | Latest 10-year Treasury yield from FMP; 4.25% if unavailable |
| Earnings growth | Average of revenue and EPS growth, capped at 15% (25% for high growth) |
| Revenue growth | Historical growth, capped between −10% and 25% |
| Dividend growth | Historical dividend growth, or earnings growth, capped at 10% |
| Projection length | 5 years; 10 for high-growth and unprofitable companies |
| Terminal growth | 2.5%, never above the risk-free rate |
| Exit P/E | Last year's P/E, clamped to 8–25×; 15× if unavailable |
| ROE | Average net income ÷ equity across the years shown |
| Target net margin | Latest net margin; 10% if not profitable |
| AAA bond yield | 10-year Treasury + 0.75% |
| Margin of safety | 25%; 35% for unprofitable and cyclical companies |
| FCF for cyclicals | Average across all years shown, instead of the latest year |

## Scenarios, reverse DCF and sensitivity

- **Bear and bull cases** move every forward-looking assumption against or in favour of the stock. Growth rates shift by 30% of their value (at least 2 percentage points), the discount rate by 1 point, and the exit P/E and target margin by 20%. ROE shifts by 15%.
- **Blended value** averages the recommended models (weight 2) and cross-checks (weight 1) that produce a positive value.
- **Verdict:** "Below buy price" when the price is under value × (1 − margin of safety), "Undervalued, thin margin" when it's under value but above the buy price, and "Above estimate" otherwise.
- **Reverse DCF** uses bisection to find the FCF growth rate that makes the DCF equal today's price.
- **Sensitivity** shows the DCF value for the discount rate ±2 points and terminal growth ±1 point.

## AI autofill

`autofillAssumptions(symbol)` takes only the ticker. It reloads the data on the server, so the prompt never contains figures sent by the browser. FMP responses are cached, so this costs no extra FMP requests after the page has loaded.

It sends Gemini the company profile, the stock type and its reasons, the per-share starting values, five years of history, and each AI-fillable field with its range and data-based default. The request uses `responseMimeType: "application/json"` with a schema.

`parseAutofillResponse` then:

- keeps only AI-fillable keys, so starting values are never changed;
- rescales whole-number percentages ("9" becomes 0.09) when only that reading fits the range;
- clamps every value to its allowed range;
- drops a terminal growth at or above the discount rate;
- trims rationales to 320 characters.

The UI marks each field as **From filings**, **AI suggestion** or **Your value**. Its "What is this?" panel shows either the data source or the AI's reason. **Reset** restores the filing-based values.

## FMP requests

A first visit to a ticker's page makes 6 requests: 4 statements, the profile and Treasury rates. Statements and Treasury rates are cached for 24 hours and the profile for 1 hour. On the free plan, some tickers' statements return 402 or 403, and the page shows the plan-restricted message.

## Known limits

- REITs are valued with dividends and FCF. FFO and AFFO multiples, which analysts also use, need real estate depreciation and gains on sales, and aren't implemented yet.
- Growth is constant during the projection rather than fading year by year. Shorten the projection or lower growth for companies whose growth will slow quickly.
- Annual data only. One unusual year (a one-off tax payment, an acquisition) moves the starting values; edit them in the starting point section.

## Sources

- Aswath Damodaran, [Country default spreads and risk premiums](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html), January 2026 (mature-market ERP 4.23%)
- CFA Institute, *Equity Asset Valuation*: free cash flow, dividend discount and residual income models
- Benjamin Graham, *The Intelligent Investor* (revised 1974 formula)
