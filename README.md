# StockPilot

StockPilot looks up a stock ticker and displays up to five annual periods of company fundamentals from Financial Modeling Prep (FMP): income statement metrics, balance sheet figures, cash flow and financial ratios.

## Configure FMP

FMP authenticates requests with an API key. No separate API secret is needed for these endpoints.

1. Copy `.env.example` to `.env.local` (or `.env`) in the project root.
2. Set `FMP_API_KEY` to the key from your FMP account.
3. Set `GEMINI_API_KEY` to your Gemini API key to enable AI analysis. `GOOGLE_GENERATIVE_AI_API_KEY` is also accepted if you already use that name. Optionally set `GEMINI_MODEL` to override the default model.
4. Set `FINNHUB_API_KEY` to your [Finnhub](https://finnhub.io) API key to enable the News page. The Finnhub secret is not needed.
5. Restart the Next.js development server after changing the environment file.

All keys are read only by server code and are not exposed to the browser. Do not commit your environment file.

FMP responses are cached (24 hours for statements, 6 hours for prices) to stay within your plan's daily request limit. See [`docs/fmp-data.md`](./docs/fmp-data.md).

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a ticker such as `AAPL` in the top search, and select **Search**. Each company has four tabs: **Overview** at `/stock?symbol=AAPL` (quote, key statistics, chart and profile), **Financials** at `/stock/financials?symbol=AAPL`, **Projections** and **News**.

FMP data access depends on the endpoints and history included in your subscription. When FMP can't return the statements, the page says why: rate limit, invalid key, plan restriction or another provider error.

The **Projections** page at `/projections?symbol=AAPL` estimates intrinsic value with DCF, dividend, earnings, revenue, residual income and Graham models. It picks the models that suit the type of company, fills assumptions from the filings (or with AI), and explains each input and result. Its **3-Year Projection** tab estimates the price and annual return in a low and a high case from revenue growth, net margin and P/E, and its **DCF Calculator** tab discounts ten years of free cash flow plus a terminal value to a value per share.

The **Market maps** page at `/maps` embeds the FINVIZ one-day heat maps of the S&P 500 and the Nasdaq 100.

The **Earnings** page at `/earnings` shows which companies report each day of the week, with analysts' estimates and, once results are out, the actual figures and surprises.

The **News** page at `/news` shows global market, deal, forex and crypto headlines from Finnhub; `/news?symbol=AAPL` shows the company's headlines from the last 14 days.

## Documentation

| Doc | Covers |
| --- | --- |
| [`docs/fmp-data.md`](./docs/fmp-data.md) | FMP endpoints, response caching, error reasons and troubleshooting |
| [`docs/financials.md`](./docs/financials.md) | Income statement, balance sheet, cash flow and ratios: columns, TTM, growth and the chart |
| [`docs/stock-overview.md`](./docs/stock-overview.md) | The stock overview page, company tabs, and where each statistic comes from |
| [`docs/stock-projections.md`](./docs/stock-projections.md) | Intrinsic value models, stock types, default assumptions, scenarios, AI autofill, the 3-year projection and the DCF calculator |
| [`docs/ai-analysis.md`](./docs/ai-analysis.md) | The AI review buttons on financial sections: configuration, what's sent, prompt rules and errors |
| [`docs/earnings.md`](./docs/earnings.md) | The earnings calendar: data, company names, filters and surprises |
| [`docs/news.md`](./docs/news.md) | Finnhub news feeds, categories, and how headlines are cleaned and filtered |
| [`docs/market-maps.md`](./docs/market-maps.md) | The FINVIZ market map embed and its limits |
| [`grapgs.md`](./grapgs.md) | Company charts and price history: data sources and FMP coverage |
| [`DESIGN.md`](./DESIGN.md) | Design tokens and component rules |

## Check the project

```bash
npm test           # Vitest unit tests (FMP client, Finnhub news, valuation models, AI actions)
npm run typecheck  # TypeScript
npm run lint       # ESLint
npm run build      # production build
```

Tests live next to the code as `*.test.ts` and mock `fetch`, so they never call FMP or Gemini.

## Design system

See [`DESIGN.md`](./DESIGN.md) for the project tokens and component rules. The sidebar currently contains the Company research tool and a light/dark theme switch; the top bar keeps a synchronized copy. The theme selector follows the system preference until a choice is saved.

On the Financials page, the spark button beside each section title asks Gemini to explain that section's figures in plain language. Intraday prices and a dedicated dividend history are not included yet.
