# Company charts

This note records which company charts StockPilot currently supports, where their data comes from, and what still depends on FMP coverage.

## Implemented

The stock page charts up to the five annual periods already loaded for its financial history. The charts use Recharts and follow the app’s light and dark theme colors.

| Chart | Data shown | Source / handling |
| --- | --- | --- |
| Revenue & profits | Revenue, gross profit, operating income, net income | Annual income statements; all series share the reported currency scale. |
| Cash, debt & net cash | Cash and short-term investments, total debt, net cash | Annual balance sheets. Net cash is cash less debt, or the inverse of FMP net debt when the two inputs are unavailable. |
| Cash flow & investment | Operating cash flow, capital expenditure, free cash flow | Annual cash flow statements. Capital expenditure keeps FMP’s reported sign, which is usually negative. Free cash flow uses FMP’s field or operating cash flow plus capital expenditure as a fallback. |
| Profit margins | Gross, operating and net margin | Annual ratios, with statement-derived margins when a ratio is missing. |
| Valuation multiples | P/E, P/S and price / free cash flow | Annual FMP ratios. A current forward P/E callout is calculated from the latest daily close and the next annual consensus EPS estimate when both are available. |
| Dividends & yield | Dividend per share and dividend yield | Annual FMP ratios. This chart is omitted when neither metric is reported. |
| Revenue by segment | Product or geographic revenue, switchable when both are present | FMP product and geographic segmentation endpoints. The six largest latest-year categories get individual colors; remaining categories are grouped as “Other segments.” Labels are kept as reported. |

Missing values are not filled with zero. Optional segment and analyst-estimate requests fail independently, so unavailable optional data does not prevent the other charts from loading.

## FMP coverage and future work

- **Segment charts depend on plan access and company filings.** FMP documents the product and geographic segmentation endpoints as limited access, and not every issuer supplies both kinds of breakdown. If an endpoint is restricted or returns no records, that segment view is not shown. See [product segmentation](https://site.financialmodelingprep.com/developer/docs/stable/revenue-product-segmentation) and [geographic segmentation](https://site.financialmodelingprep.com/developer/docs/stable/revenue-geographic-segments).
- **Segment labels are not a stable taxonomy.** Issuers rename, add, combine or remove reportable segments. Current chart rows keep each period’s reported names; a category that is absent in a period has no value there. Future work could add an issuer-specific mapping layer and reconcile segment totals to consolidated revenue.
- **Forward P/E is a point-in-time estimate, not a historical series.** It requires FMP annual analyst estimates, access to that endpoint, a positive consensus EPS value and a latest stock close. The estimate is not plotted against past fiscal years because this endpoint does not supply a comparable historical forward-P/E series here. See [FMP financial estimates](https://site.financialmodelingprep.com/developer/docs/stable/financial-estimates).
- **Dividend data can be incomplete.** The annual ratio fields support per-share dividends and yield when FMP reports them. A dedicated dividend-payment history could support payment dates, cadence and trailing-twelve-month calculations in a later version.
- **Negative or undefined denominators affect valuation ratios.** P/E and price / free cash flow may be missing or economically difficult to interpret for loss-making companies or companies with negative free cash flow; the app leaves FMP’s missing values blank.
- **Quarterly views and estimate overlays are future additions.** The current stock page’s financial table and charts use annual periods. Quarterly toggles, revenue / EPS forecast overlays, and dividend-adjusted return comparisons would need separate data selection and chart controls.

## Relevant implementation files

- `src/lib/fmp.ts` maps annual statements and ratios, and fetches optional segment and estimate data.
- `src/app/stock/financial-charts.tsx` renders the responsive Recharts visualizations.
- `src/app/stock/page.tsx` loads the chart inputs and derives the current forward P/E callout.
