# Valuation tools

A company's **Valuation** tab, the last of its tabs, holds four separate calculators as sub-tabs:

| Tool | Route |
| --- | --- |
| Intrinsic Value | `/valuation/intrinsic-value?symbol=AAPL` |
| Jeremy's Projection | `/valuation/jeremy-projection?symbol=AAPL` |
| Plumas Projection | `/valuation/plumas-projection?symbol=AAPL` |
| DCF Calculator | `/valuation/dcf-calculator?symbol=AAPL` |

Each page has the company header and tabs with Valuation open, then the tools as sub-tabs for the same ticker (`ValuationHeader`); the Valuation tab opens Intrinsic Value. The sidebar has no valuation section: Stocks stays highlighted on these pages, and the top bar's search keeps you on the same tool for the new ticker. Without a ticker, each page shows a short start screen. They share `src/app/valuation/data.ts`, `actions.ts`, `calculator-input.tsx` and `valuation-parts.tsx` (the header with the sub-tabs, start screen and load error); `tools.ts` lists the tools for the sub-tabs. The old `/projections` page redirects to these (`?view=3y` to Jeremy's Projection and `?view=dcf` to the DCF Calculator), as do the old `/valuation/three-year-projection` (to Jeremy's Projection, whose template it followed) and `/valuation/financial-projections` (to the Plumas Projection).

## Intrinsic Value

The Intrinsic Value tool estimates a company's intrinsic value with six valuation models. It first works out what kind of stock it is, then recommends the models that fit. It fills every assumption from the filings, and an optional AI autofill can suggest forward-looking values instead. Everything recalculates in the browser as the user edits.

## Files

| File | Role |
| --- | --- |
| `src/app/valuation/intrinsic-value/page.tsx` | Server page: loads data, shows errors, renders the workbench |
| `src/app/valuation/data.ts` | `loadProjectionData`: fundamentals, profile and Treasury yield, then classification and defaults |
| `src/app/valuation/actions.ts` | `autofillAssumptions` server action (Gemini) |
| `src/app/valuation/projection-workbench.tsx` | Client state, layout and derived results |
| `src/app/valuation/projection-parts.tsx` | Assumption field, model card, football field, projection chart and tables |
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

## Price projections: Jeremy's or Plumas?

Both projections price a stock the same way: EPS × a low and a high P/E for each year, and the yearly return (CAGR) from today's price, without dividends. Jeremy's Projection follows Jeremy Lefebvre's (1000xStocks) sheet; the Plumas Projection follows the projection in the screenshots it was built from. With the same inputs, Jeremy's Projection and the Plumas Projection's Simple mode give the same revenue, net income, EPS and prices. They differ in where they start, how they count the CAGR years and how much of the income statement they model:

| | Jeremy's Projection | Plumas Projection |
| --- | --- | --- |
| Starts from | The fiscal year in progress, from analysts' consensus (else the last report), as year 0 | The last reported fiscal year, with the three before it beside it |
| Years shown | The starting year and the four after it | The five years after the last report |
| CAGR years | Counted from the starting year, so shown from its third column (2 years) | The first projected year counts as 1, up to 5 |
| Net income | Grows at its own rate | Simple: the same. Advanced: built from cost of revenue, operating expenses, interest & other and the last year's tax ratio |
| Share count | Today's, every year | Simple: today's. Advanced: falls each year by the buyback yield |
| P/E | Low and high, per year | Low and high (Simple), plus mid (Advanced), per year |
| Cases | Bull, base and bear, all three tables on the page, and one chart | 3 or 5 scenarios, one table at a time, with cards, a chart and a comparison table |
| Starting values | Base growth from analysts' consensus where at least 3 analysts cover the year; forward P/E ± 20% | Base growth from the company's own history; the historical P/E range |
| Analysts' estimates | The starting year, and the base growth they cover | Rows under revenue and EPS, and a button that fits a scenario to them |
| AI autofill | — | All five scenarios, year by year |

The differences matter:

- **The starting point.** When this year differs a lot from the last report (a fast grower, a turnaround), Jeremy's Projection starts from what analysts expect for it; the Plumas Projection has to get there with its first year's growth.
- **The CAGR years.** For the same price target in the same year, Jeremy's CAGR is higher, because it spreads the gain over one year fewer: a target 2.85 times today's price in 2030 is +30% a year over Jeremy's four years, but +23% over the Plumas Projection's five when the last report is fiscal 2025. Compare stocks with the same tool.
- **Buybacks and costs.** Only the Plumas Projection's Advanced mode counts buybacks, separates cost of revenue from operating expenses (operating leverage, margin recovery) and can start from a loss.

### Which to use

The **Which projection fits** card at the top of both pages names the better one for the company, with the reason, and what each is best for. `recommendProjection` (`src/lib/projection-fit.ts`) picks it from the stock type the Intrinsic Value tool also uses (`classifyStock`, here run on the income statement and ratio tables and the profile's sector), the average buyback yield of the years shown and the latest dividend yield:

| Stock type | Use | Why |
| --- | --- | --- |
| High growth | Jeremy's | Revenue growth drives the price, and this year's consensus is the best starting point |
| Bank or financial | Jeremy's | Valued on earnings and a P/E, with no cost of revenue for the Advanced mode to use; cross-check with the Intrinsic Value tool's residual income model |
| Stable compounder buying back 1.5% or more of its shares a year | Plumas | Buybacks lift EPS beyond profit growth, and only the Advanced mode counts them |
| Stable compounder otherwise | Jeremy's | Steady growth on a share count that barely moves: the simpler model is enough |
| Dividend payer | Plumas | Slow growth, so returns come from margins and buybacks. Neither projection counts dividends: add the yield to the CAGR, or use the Intrinsic Value tool's dividend discount model |
| Cyclical | Plumas | Margins swing with the cycle: four reported years show where it stands, and the Advanced mode sets cost of revenue and operating expenses on their own |
| Unprofitable | Plumas | A growth rate can't be applied to a loss; the Advanced mode builds profit from revenue and costs |
| REIT | Intrinsic Value | A P/E says little when depreciation shrinks earnings and most of the cash is paid out; the dividend model fits better |

In short: Jeremy's Projection for growth stories, the Plumas Projection for mature, dividend, buyback, cyclical and loss-making companies.

## Jeremy's Projection

`/valuation/jeremy-projection?symbol=AAPL` follows Jeremy Lefebvre's (1000xStocks) projection: bull, base and bear cases over the fiscal year in progress and the four after it. From the same inputs it gives the same revenue, net income, margins, EPS, prices and CAGRs as his sheet, to the dollar: `src/lib/jeremy-projection.test.ts` reproduces his AMD and Netflix bull, base and bear cases.

The page opens with the **Which projection fits** card, then a starting-point bar (the stock price, the market cap, and today's share count and the starting year's revenue and net income, all three editable), the three case tables stacked (bull, base, bear), each with its last year's price target and CAGR range, and the **Price projections** chart: each case's line runs through the middle of its range, with bars from the low to the high target, the current price as a dashed line, and the ranges with their CAGR when pointing at a year. **Adjust entry price** measures the CAGR from another price, in the chart and the tables; **Reset** next to it goes back to today's.

| Step | Formula |
| --- | --- |
| Starting year | Revenue and net income of the fiscal year in progress |
| Revenue | previous year × (1 + revenue growth), from the second year |
| Net income | previous year × (1 + net income growth), from the second year |
| Net income margin | net income ÷ revenue |
| EPS | net income ÷ today's shares outstanding, the same every year |
| Share price | EPS × P/E low, and EPS × P/E high |
| CAGR | (price ÷ today's or the entry price)^(1/n) − 1, with n = years after the starting year, from n = 2 |

Each year's revenue and net income are rounded to whole units before the next year grows from them, as on his sheet (this moves net income by a dollar now and then). A loss-making starting year can't be projected, since a growth rate can't be applied to a loss: the page says so, and the card points to the Plumas Projection.

| Input | Default |
| --- | --- |
| Starting year | The fiscal year in progress (the first one whose end is still ahead) with analysts' average revenue and net income (their EPS × today's shares without a net income estimate). Without a consensus, the last reported year |
| Revenue and net income growth (base) | Implied by the consensus for each year at least 3 analysts cover; after that, the Plumas Projection's base growth for the same fiscal year (the company's compound growth fading toward 3%), with net income growing as fast as revenue |
| P/E low and high | Today's price ÷ the starting year's consensus EPS (a forward P/E), minus and plus 20%; without one, the Plumas Projection's historical range. A range centred above 25× fades to 20× and 30× by the last year, as on Jeremy's own sheets: a fast grower's P/E usually shrinks as its growth slows |
| Bull / bear | Revenue and net income growth 5 points higher or lower, and the P/E range × 1.2 or × 0.8 |

Edits are saved in the browser per company and starting year (`localStorage`, key `stockpilot-jeremy:SYMBOL:YEAR`), including the starting revenue, net income and share count; **Reset** in the starting-point bar clears them. The entry price lasts only for the visit. There's no AI autofill, as on his sheet.

Files: `src/lib/jeremy-projection.ts` (math and defaults), `src/lib/projection-fit.ts` (which projection fits), `src/app/valuation/jeremy-projection.tsx` (the page's state), `src/app/valuation/jeremy-projection-parts.tsx` (case tables and chart), and the shared `projection-cells.tsx`, `saved-projection.ts` and `data.ts` (`loadPriceProjectionData`, which builds both projections and the fit from the same cached requests).

## Plumas Projection

`/valuation/plumas-projection?symbol=AAPL` projects the five fiscal years after the last reported one, year by year, in 3 or 5 scenarios, following the projection in the screenshots it was built from (Plumas). It shows the price range each year and the yearly return (CAGR) from today's price, not an intrinsic value, and doesn't discount anything. It was called Financial Projections; `/valuation/financial-projections` redirects here.

The page opens with the **Which projection fits** card (see above), then a starting-point bar (today's price and share count, both editable, with the market cap and trailing P/E), a Simple/Advanced switch, a 3/5 scenarios switch, **Autofill with AI** and **Reset**. Below it:

- **Scenario cards**, one per scenario, with the last year's price target (low–high) and CAGR range. Selecting one opens it in the table.
- **The table**: the last four reported fiscal years, then the five projected years. Boxed cells are that scenario's inputs, one per year; the arrow beside an input row copies the first projected year's value to every year. Decimal commas (`8,5`) are accepted.
- **All scenarios**: a chart of each scenario's mid price from today's price, with the selected scenario's low–high range shaded, and a table of every scenario's last year side by side.
- **Analysts' estimates**: when FMP has them, muted "Analysts' revenue" and "Analysts' EPS" rows under Revenue and EPS show the consensus average for each projected year (pointing at a value shows the low, the high and the number of analysts), and the starting-point bar adds a forward P/E: today's price ÷ the first projected year's EPS estimate. **Use analysts' estimates** fits the selected scenario to them (see below).

Scenarios are Bearish, Base and Bullish, or with five, Ultra bearish and Ultra bullish as well. Each has its own inputs; **Copy Base inputs** starts a scenario from the base case.

### Formulas

They reproduce the reference projections exactly (American Express, KLA and Nike: `src/lib/plumas-projection.test.ts`).

| Step | Simple | Advanced |
| --- | --- | --- |
| Revenue | previous year × (1 + revenue growth) | same |
| Cost of revenue | — | previous year × (1 + cost of revenue growth) |
| Gross profit | — | revenue − cost of revenue |
| Operating expenses | — | previous year × (1 + operating expenses growth), from the last year's gross profit − operating income |
| Operating income | — | gross profit − operating expenses |
| Interest & other | — | previous year × (1 + its growth), from the last year's pretax income − operating income |
| Net income | previous year × (1 + net income growth) | (operating income + interest & other) × the last year's net income ÷ pretax income |
| Shares | today's count, every year | previous year × (1 − buyback yield), starting from today's count |
| EPS | net income ÷ shares | same |
| Price | EPS × P/E low and high | EPS × P/E low, mid and high |
| Market cap (mid) | — | mid price × shares |
| CAGR | (price ÷ today's price)^(1/n) − 1, with n = 1 for the first projected year up to 5 | same |

Notes:

- The share count starts from **today's** shares outstanding (FMP's float data, or market cap ÷ price), not the last fiscal year's average; a positive buyback yield shrinks it, a negative one is dilution.
- Companies without a cost of revenue, such as banks, skip the gross profit rows: operating expenses are everything between revenue and operating income. Those without operating income use pretax income instead, so interest & other is zero.
- Net income keeps the last year's ratio to pretax income (taxes and minority interests). If that ratio isn't between 0 and 1, a 21% tax rate is used.
- A year with a loss has no price or CAGR. Simple mode needs the last year's net income to be positive; a loss-making company starts in Advanced mode.
- Reported EPS is the diluted EPS from the filings; the reported P/E row is each fiscal year's P/E.
- Simple mode is the same model as Jeremy's Projection; the two differ in where they start and how they count the CAGR years (see above).

### Analysts' estimates

`getAnalystEstimates` reads FMP's annual `analyst-estimates` (the same cached request as the overview's forward P/E): the low, average and high revenue, net income and EPS, and the number of analysts. Each projected year takes the estimate dated within two months of its expected fiscal year end, so 52- and 53-week years still line up. Companies FMP's plan doesn't cover (their statements come from the SEC) have none.

**Use analysts' estimates** (`fitToEstimates`) changes only the years the consensus covers:

| Input | Set to |
| --- | --- |
| Revenue growth | Whatever reaches the analysts' average revenue |
| Net income growth (Simple) | Whatever reaches their average EPS on today's share count, or their net income without an EPS estimate |
| Cost of revenue growth (Advanced) | The revenue growth, so the gross margin holds |
| Operating expenses growth (Advanced) | Whatever leaves the operating income their EPS needs on the scenario's share count, after interest & other and the net income ratio |

Other years, interest & other, buybacks and the P/E range keep their values. The AI autofill also gets the consensus, as a reference for the base case.

### Starting values

| Input | Default |
| --- | --- |
| Revenue growth (base) | The compound revenue growth across the fiscal years available (up to four), between −10% and 30%, fading halfway to 3% by the last year; 5% without history |
| Net income, cost of revenue and operating expenses growth | Same as revenue growth, so the last year's margins hold |
| Interest & other growth | 0% |
| Buyback yield | The average yearly fall in diluted shares over the years shown, between −5% and 5%. The first year only counts the part of it still ahead, since today's share count includes the rest |
| P/E low, mid, high | The lowest, median and highest fiscal-year P/E; else today's P/E −20%, as is, +20%; else 15×, 20× and 25×. Kept between 5× and 100× |
| Bearish / bullish | Revenue (and cost) growth 5 points lower or higher and the P/E range × 0.8 or × 1.2 |
| Ultra bearish / ultra bullish | 10 points and × 0.6 or × 1.4 |

The "Where the starting values come from" list under the table gives each one for the company.

### Saving, view and AI

- Edits are saved in the browser per company and fiscal year (`localStorage`, key `stockpilot-projection:SYMBOL:YEAR`), so they survive a reload; a new fiscal year starts fresh. **Reset** clears them. The Simple/Advanced and 3/5 choices are kept for every company (`stockpilot-projection-view`). Today's price and share count edits last only for the visit.
- **Autofill with AI** (`autofillPlumasProjection`) sends Gemini the reported history (growth, margins, interest & other, shares, buyback yield, EPS and P/E), today's price and share count, and how much of the first fiscal year is still ahead. The data defaults are left out, so it forms its own view instead of copying them. It returns all five scenarios, one value per year for every input, with a reason for each scenario and a summary. `parseProjectionResponse` clamps each value, rescales whole-number percentages, pads short lists and keeps each year's P/E in order.

Files: `src/lib/plumas-projection.ts` (math, history and defaults, also used by Jeremy's Projection), `src/lib/plumas-projection-autofill.ts` (prompt and parsing), `src/app/valuation/plumas-projection.tsx` (the page's state), `src/app/valuation/plumas-projection-parts.tsx` (table, cards, chart and comparison), `src/app/valuation/projection-cells.tsx` (cell formats and inputs shared with Jeremy's Projection) and `src/app/valuation/saved-projection.ts` (browser storage).

## DCF Calculator

`/valuation/dcf-calculator?symbol=AAPL` is a hands-on two-stage discounted cash flow calculator in the style used by investor YouTube channels such as Parkev Tatevosian's and by quote-site DCF tools. His exact spreadsheet is for paying channel members and isn't public, so this follows the standard structure rather than his file.

| Step | Formula |
| --- | --- |
| Free cash flow, years 1–5 | FCF today × (1 + early growth)^year; with a year 1 forecast, year 1 is the forecast and years 2–5 grow from it |
| Free cash flow, years 6–10 | year-5 FCF × (1 + late growth)^(year − 5) |
| Present value | FCF ÷ (1 + discount rate)^year |
| Terminal value (perpetual growth) | year-10 FCF × (1 + g) ÷ (discount rate − g) |
| Terminal value (exit multiple) | year-10 FCF × multiple |
| Enterprise value | sum of the present values, including the terminal value discounted like year 10 |
| Equity value | enterprise value + cash and short-term investments − total debt |
| Intrinsic value per share | equity value ÷ diluted shares |

It also shows the upside against the price, a buy-below price after the margin of safety, the growth the price implies (the reverse DCF), free cash flow history, the terminal value's share of the total, the ten projected years, and a sensitivity grid (discount rate ±2 points against early growth ±4 points).

**Reverse DCF.** `impliedDcfGrowth` finds the one growth rate for every projected year (years 2–10 after a year 1 forecast) that makes the value per share equal today's price, keeping the discount rate, terminal value, cash, debt and shares, by halving the range from −50% to +100% a year until they match; beyond it, the page says which side. The summary shows it, and its own section compares it with your two growth rates and the history: a price that needs much more growth than the business has delivered leaves little room for disappointment.

**History.** Free cash flow and its yearly growth for the fiscal years available (five on the free FMP plan and from SEC filings), then the trailing twelve months, with the compound growth between the oldest and the latest fiscal year (four years, rather than a five- or ten-year CAGR).

These three came from comparing the calculator with a reference spreadsheet that values a company from a year 1 forecast ($48,000 million against $26,900 million in the last year) growing 20% a year, a 9% discount rate and 3% perpetual growth. `src/lib/simple-dcf.test.ts` reproduces its cash flows, present values, terminal value, $516.43 a share and low and high cases. Its reverse DCF reads 12.20%, where its goal seek stopped (that rate gives $303.46, not the $306 price); the exact answer is 12.32%. Its low, medium and high growth table isn't repeated: the sensitivity grid already shows the value at growth ±2 and ±4 points, for five discount rates.

| Input | Default |
| --- | --- |
| Free cash flow | TTM operating cash flow minus capital expenditures |
| Year 1 free cash flow | Blank: year 1 grows today's free cash flow. Type a forecast (guidance or an analyst estimate) when next year will differ a lot from the last twelve months; it can be positive even when today's isn't |
| Cash, debt | The latest quarter's balance sheet |
| Shares | Latest diluted share count |
| Growth, years 1–5 | Fiscal-year revenue growth, between 0% and 25% (revenue is steadier than free cash flow) |
| Growth, years 6–10 | Half of the early growth, at least 2% |
| Discount rate | 10% |
| Terminal value | Perpetual growth at 2.5%, or a 15× free cash flow exit multiple |
| Margin of safety | 25% |

Companies with negative free cash flow, including banks and insurers whose lending runs through cash flow, get an explanation instead of a value, pointing to the residual income model in the Intrinsic Value tool.

**Autofill with AI** (`autofillDcf`) suggests both growth rates, the discount rate, terminal growth and the exit multiple from revenue, margin and free cash flow history, with a reason for each. `parseDcfResponse` clamps each value; the ranges also keep terminal growth (at most 4%) below the discount rate (at least 5%).

All three AI autofills only rescale a percentage written as a whole number (for example 9 for 9%) when it is above 1: an out-of-range decimal like 0.6 is capped at the field's maximum, not read as 0.6%.

Files: `src/lib/simple-dcf.ts` (math and defaults), `src/lib/simple-dcf-autofill.ts` (prompt and parsing), `src/app/valuation/dcf-calculator.tsx` (the calculator) and `src/app/valuation/calculator-input.tsx` (the number input shared with both projections).
