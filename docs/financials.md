# Financials

`/stock/financials?symbol=AAPL` shows a company's statements in the style of StockAnalysis's Financials tab, under the company quote header and tabs. Its first sub-tab, **Financials**, shows charts only: the four statement charts, then the valuation, dividend and segment charts. The Income Statement, Balance Sheet, Cash Flow and Ratios titles have a spark icon in front that explains that tab with AI, and each tab keeps its review while you stay in Financials (see [`ai-analysis.md`](./ai-analysis.md)). The statement sub-tabs show one chart and the full statement table.

## URLs

| Parameter | Values | Default |
| --- | --- | --- |
| `statement` | `income`, `balance`, `cash-flow`, `ratios`; leave it out for the charts-only Financials tab | Financials (charts only) |
| `period` | `annual`, `quarterly` | `annual` |

For example: `/stock/financials?symbol=AAPL&statement=balance&period=quarterly`.

## Files

- `src/app/stock/financials/page.tsx`: the page, sub-tabs and server-rendered table.
- `src/app/stock/financials/statement-chart.tsx`: the client chart.
- `src/lib/financial-statements.ts`: loading, line items, TTM and growth calculations.
- `src/app/components/quote-header.tsx`: the name and price header shared with the Overview.

## Columns

| Column | Annual view | Quarterly view |
| --- | --- | --- |
| First | **TTM**: the last 4 quarters added up (income and cash flow). The balance sheet shows **Current**, the latest quarter, instead. | **TTM** (income and cash flow only; the balance sheet has no extra column) |
| Then | Last 5 fiscal years, newest first | Last 5 quarters, newest first |

Share counts in a TTM column are the latest quarter's, not a sum. Ratios use FMP's annual `ratios` and `key-metrics` (merged by date) and their TTM versions where FMP has a value, and otherwise calculate it from the statements, because quarterly ratios need a paid plan and statements from SEC filings come without them. Earnings and FCF yields fall back to the inverse of P/E and P/FCF. In quarterly columns, ratios that compare a quarter's flow with a balance (ROE, ROA, asset and inventory turnover, net debt to EBITDA) are annualized (×4), so they read like the yearly figures next to them; the page says so.

Growth rows compare each period with the same period a year earlier: the previous fiscal year, or the quarter four back. With only 5 quarters on the free plan, only the newest quarter has year-over-year growth, and TTM growth isn't shown.

## Rows

Amounts are in millions of the reporting currency, and per-share figures and ratios have two decimals.

- **Income:** revenue, cost of revenue, gross profit, R&D, SG&A, operating expenses, operating income, interest, pretax income, tax, net income, diluted shares and EPS, growth rows, margins, EBITDA and EBIT.
- **Balance:** cash and short-term investments, receivables, inventory, current assets, PP&E, goodwill, investments, total assets, payables, short- and long-term debt, liabilities, equity, net cash (debt) and book value per share.
- **Cash flow:** net income, D&A, stock-based compensation, working capital, operating, investing and financing cash flow, capex, acquisitions, dividends, buybacks, net debt issued, free cash flow, its growth and margin, and FCF per share.
- **Ratios**, in sections, as on StockAnalysis: **Valuation** (market cap, enterprise value, P/E, PEG, P/S, P/B, P/FCF, P/OCF, EV/Sales, EV/EBITDA, EV/FCF), **Yields** (earnings, FCF and dividend yield, payout ratio), **Returns** (ROE, ROA, ROIC), **Financial health** (current and quick ratio, debt to equity, net debt to EBITDA, interest coverage) and **Efficiency** (asset and inventory turnover). Margins are in the income statement.

Rows a company never reports are dropped, including rows FMP fills with zeros (such as Apple's acquisitions). A zero amount elsewhere shows as "—", since FMP uses 0 for items a company doesn't break out. Terms with a dotted underline explain themselves on hover.

## Charts

The Financials sub-tab loads all four statements (they share cached requests) and shows their charts in a grid: Revenue & Profits across the full width, the others two by two. A chart left alone on the last row also spans the full width.

Each statement has its own chart: Revenue & Profits, Cash & Debt, Cash Flow, or Valuation Ratios (P/E, P/S, P/B, P/FCF, EV/EBITDA). Without yearly prices (quarterly views, or statements from SEC filings) the valuation ratios have only a TTM value, so the Ratios chart shows Returns (ROE, ROA, ROIC) instead. Clicking a legend item shows or hides that series, and Area, Bars and Line switch the chart type. Amounts use the left axis; EPS or percentages get a right axis when they're mixed with amounts.

The chart runs oldest to newest with TTM last in the annual view. The quarterly chart leaves TTM out, because a year's total next to single quarters would dwarf them. On phones the point labels are hidden, and the tooltip still shows each value.

## Requests

An uncached annual view makes up to 8 statement requests (annual income, balance, cash flow and ratios; quarterly income, balance and cash flow; TTM ratios), plus the quote; the Ratios tab adds annual and TTM key metrics. They use the same URLs as the Overview and the fundamentals loader, so most are already cached after visiting those pages. Every response is cached for 24 hours, except the quote (1 minute).
