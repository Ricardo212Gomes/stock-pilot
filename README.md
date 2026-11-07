# StockPilot

StockPilot is a free US stock research app. Search a company by name or ticker for its quote, financial statements and ratios, earnings call transcripts with AI summaries, SEC filings and news, then estimate its value with four calculators. Market maps, news and earnings and dividend calendars cover the wider market, and signed-in users can keep favorites. Data comes from Financial Modeling Prep (FMP), SEC EDGAR, Finnhub, Alpha Vantage and FINVIZ, on their free plans.

## Configure FMP

FMP authenticates requests with an API key. No separate API secret is needed for these endpoints.

1. Copy `.env.example` to `.env.local` (or `.env`) in the project root.
2. Set `FMP_API_KEY` to the key from your FMP account.
3. Set `GEMINI_API_KEY` to your Gemini API key to enable AI analysis. `GOOGLE_GENERATIVE_AI_API_KEY` is also accepted if you already use that name. Optionally set `GEMINI_MODEL` to override the default model.
4. Set `FINNHUB_API_KEY` to your [Finnhub](https://finnhub.io) API key to enable the News page. The Finnhub secret is not needed.
5. Optionally set `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `AUTH_TRUST_HOST=true` to enable **Sign in with Google**; see [`docs/auth.md`](./docs/auth.md) for creating the Google OAuth client.
6. Optionally set `ALPHAVANTAGE_API_KEY` to an [Alpha Vantage](https://www.alphavantage.co) key to enable earnings call **Transcripts**; see [`docs/transcripts.md`](./docs/transcripts.md).
7. Optionally set `DATABASE_URL` to a Postgres database (Neon, Supabase or any other) and run `npm run db:setup` to enable **Favorites**; see [`docs/favorites.md`](./docs/favorites.md).
8. Optionally set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` to send favorites' upcoming earnings, earnings call summaries, relevant news and SEC filing analyses to Telegram; see [`docs/notifications.md`](./docs/notifications.md).
9. Restart the Next.js development server after changing the environment file.

All keys are read only by server code and are not exposed to the browser. Do not commit your environment file.

FMP responses are cached (24 hours for statements, 6 hours for prices) to stay within your plan's daily request limit. See [`docs/fmp-data.md`](./docs/fmp-data.md). When FMP's plan doesn't cover a company, or its daily limit is reached, statements come from SEC filings and the quote from Finnhub instead; see [`docs/data-fallbacks.md`](./docs/data-fallbacks.md).

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the home page, which links to every tool, and type a company name or ticker, such as `Nvidia` or `NVDA`, in its search or the top bar's; pick a suggestion or press Enter for the best match. The search runs in the browser over a bundled list of about 5,900 US stocks, so it makes no API requests; refresh the list with `npm run symbols:update` (see [`docs/stock-overview.md`](./docs/stock-overview.md#search)). Each company has six tabs: **Overview** at `/stock?symbol=AAPL` (quote, key statistics, chart and profile), **Financials** at `/stock/financials?symbol=AAPL`, **News**, **Transcripts** at `/stock/transcripts?symbol=AAPL` (earnings calls, speaker by speaker) **Filings** at `/stock/filings?symbol=AAPL` (SEC reports, earnings releases and other filings) and **Valuation**, whose sub-tabs are the four calculators below.

FMP data access depends on the endpoints and history included in your subscription. When FMP can't return the statements, the page says why: rate limit, invalid key, plan restriction or another provider error.

Each company's **Valuation** tab (after Filings) holds four calculators, as sub-tabs. **Intrinsic Value** at `/valuation/intrinsic-value?symbol=AAPL` estimates intrinsic value with DCF, dividend, earnings, revenue, residual income and Graham models; it picks the models that suit the type of company, fills assumptions from the filings (or with AI), and explains each input and result. **Jeremy's Projection** at `/valuation/jeremy-projection` follows Jeremy Lefebvre's (1000xStocks) sheet: bull, base and bear cases from this year's analyst consensus, with revenue and net income growth and a P/E range, best for growth stocks. **Plumas Projection** at `/valuation/plumas-projection` projects revenue, margins, EPS, the share price and the yearly return five years past the last report, in three or five scenarios, with a Simple mode and an Advanced one (costs, interest, buybacks and a low, mid and high P/E), next to analysts' estimates, best for mature, dividend, cyclical and loss-making companies. Both pages say which of the two suits the company. **DCF Calculator** at `/valuation/dcf-calculator` discounts ten years of free cash flow plus a terminal value to a value per share, optionally from a year 1 forecast, and runs it backwards: the reverse DCF shows the growth today's price implies, next to the free cash flow history.

The **Market maps** page at `/maps` embeds the FINVIZ one-day heat maps of the S&P 500, the Nasdaq 100 and the largest cryptocurrencies.

The **Earnings** page at `/earnings` shows which companies report each day of the week, with analysts' estimates and, once results are out, the actual figures and surprises.

The **Dividends** page at `/dividends` shows a month of dividends on their ex-dividend or payment date, with the amount, yield and key dates. On the free FMP plan it covers about 25 large US companies, from about four weeks ago onward.

The **Compare** page at `/compare?symbols=CELH,MNST,KO` puts up to five stocks side by side: P/E, expected EPS and revenue growth and margins, next to the range many established companies trade at.

The **Favorites** page at `/favorites` lists the companies you've starred from their overview, with the latest price and links to each tool. It needs Google sign-in and a Postgres database.

The **News** page at `/news` shows global market, deal, forex and crypto headlines from Finnhub; `/news?symbol=AAPL` shows the company's headlines from the last 14 days.

## Documentation

| Doc | Covers |
| --- | --- |
| [`docs/fmp-data.md`](./docs/fmp-data.md) | FMP endpoints, response caching, error reasons and troubleshooting |
| [`docs/data-fallbacks.md`](./docs/data-fallbacks.md) | SEC filings and Finnhub when FMP can't provide a company: what's covered and how filings become statements |
| [`docs/financials.md`](./docs/financials.md) | Income statement, balance sheet, cash flow and ratios: columns, TTM, growth and the chart |
| [`docs/stock-overview.md`](./docs/stock-overview.md) | The stock overview page, company tabs, and where each statistic comes from |
| [`docs/compare.md`](./docs/compare.md) | The Compare page: each metric's calculation and source, fiscal-year matching and free-plan gaps |
| [`docs/valuation.md`](./docs/valuation.md) | The four valuation tools: intrinsic value models, stock types, default assumptions, scenarios, AI autofill, Jeremy's and the Plumas projections (their differences and which stocks each suits) and the DCF calculator |
| [`docs/ai-analysis.md`](./docs/ai-analysis.md) | The AI review buttons on financial sections: configuration, what's sent, prompt rules and errors |
| [`docs/earnings.md`](./docs/earnings.md) | The earnings calendar: data, company names, filters and surprises |
| [`docs/dividends.md`](./docs/dividends.md) | The dividend calendar: data, free-plan limits and the two date views |
| [`docs/news.md`](./docs/news.md) | Finnhub news feeds, categories, and how headlines are cleaned and filtered |
| [`docs/market-maps.md`](./docs/market-maps.md) | The FINVIZ market map embed and its limits |
| [`docs/auth.md`](./docs/auth.md) | Google sign-in: setup, session cookie and the top bar menu |
| [`docs/filings.md`](./docs/filings.md) | The Filings tab: SEC EDGAR filings, filters, 8-K descriptions and press releases |
| [`docs/transcripts.md`](./docs/transcripts.md) | Earnings call transcripts: Alpha Vantage, fiscal quarters, saving them in Postgres and the free-key limits |
| [`docs/notifications.md`](./docs/notifications.md) | Telegram notifications: the bot, linking a chat, the four commands and the GitHub Actions schedule |
| [`docs/favorites.md`](./docs/favorites.md) | Favorites: the Postgres database, schema setup, the star button and the list |
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

See [`DESIGN.md`](./DESIGN.md) for the project tokens and component rules. The sidebar groups the pages into Workspace (Home, Stocks, Compare, Favorites) and Markets, and can collapse to an icon rail; the valuation calculators are a company's Valuation tab. The light/dark theme switch is in the top bar; it follows the system preference until a choice is saved.

On the Financials page, the spark button beside each section title asks Gemini to explain that section's figures in plain language. Intraday prices and a dedicated dividend history are not included yet.
