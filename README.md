# StockPilot

StockPilot is a free US stock research app. Search a company by name or ticker for its quote, financial statements and ratios, earnings call transcripts with AI summaries, SEC filings and news, then estimate its value with four calculators. Market maps, news and earnings and dividend calendars cover the wider market, and signed-in users can keep favorites and a portfolio. Data comes from Financial Modeling Prep (FMP), SEC EDGAR, Finnhub, Tiingo, Alpha Vantage and FINVIZ, on their free plans, with the ECB's euro rates from Frankfurter.

## Configure FMP

FMP authenticates requests with an API key. No separate API secret is needed for these endpoints.

1. Copy `.env.example` to `.env.local` (or `.env`) in the project root.
2. Set `FMP_API_KEY` to the key from your FMP account.
3. Set `GEMINI_API_KEY` to your Gemini API key to enable AI analysis and the AI chat. `GOOGLE_GENERATIVE_AI_API_KEY` is also accepted if you already use that name. Optionally set `GEMINI_MODEL` to override the default model.
4. Set `FINNHUB_API_KEY` to your [Finnhub](https://finnhub.io) API key to enable the News page. The Finnhub secret is not needed.
5. Optionally set `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `AUTH_TRUST_HOST=true` to enable **Sign in with Google**; see [`docs/auth.md`](./docs/auth.md) for creating the Google OAuth client.
6. Optionally set `ALPHAVANTAGE_API_KEY` to an [Alpha Vantage](https://www.alphavantage.co) key to enable earnings call **Transcripts**; see [`docs/transcripts.md`](./docs/transcripts.md).
7. Optionally set `TIINGO_API_KEY` to a free [Tiingo](https://www.tiingo.com) key, so price charts and the price signals work for companies FMP's free plan doesn't cover, and when it hits its daily limit, and the Portfolio gets its chart, splits and dividends; see [`docs/data-fallbacks.md`](./docs/data-fallbacks.md).
8. Optionally set `DATABASE_URL` to a Postgres database (Neon, Supabase or any other) and run `npm run db:setup` to enable **Favorites** and the **Portfolio**; see [`docs/favorites.md`](./docs/favorites.md) and [`docs/portfolio.md`](./docs/portfolio.md).
9. Optionally set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` to send favorites' upcoming earnings, earnings call summaries, relevant news and SEC filing analyses to Telegram; see [`docs/notifications.md`](./docs/notifications.md).
10. Restart the Next.js development server after changing the environment file.

All keys are read only by server code and are not exposed to the browser. Do not commit your environment file.

FMP responses are cached (24 hours for statements, 6 hours for prices) to stay within your plan's daily request limit. See [`docs/fmp-data.md`](./docs/fmp-data.md). When FMP's plan doesn't cover a company, or its daily limit is reached, statements come from SEC filings and the quote from Finnhub instead; see [`docs/data-fallbacks.md`](./docs/data-fallbacks.md).

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the home page, which links to every tool, and type a company name or ticker, such as `Nvidia` or `NVDA`, in its search or the top bar's; pick a suggestion or press Enter for the best match. The search runs in the browser over a bundled list of about 5,900 US stocks, so it makes no API requests; refresh the list with `npm run symbols:update` (see [`docs/stock-overview.md`](./docs/stock-overview.md#search)). Each company has eight tabs: **Overview** at `/stock?symbol=AAPL` (quote, key statistics, chart and profile), **Financials** at `/stock/financials?symbol=AAPL`, **Forecast** at `/stock/forecast?symbol=AAPL` (analysts' price targets, ratings, revenue and EPS estimates, earnings surprises and rating changes), **News**, **Transcripts** at `/stock/transcripts?symbol=AAPL` (earnings calls, speaker by speaker), **Filings** at `/stock/filings?symbol=AAPL` (SEC reports, earnings releases and other filings), **Insiders** at `/stock/insiders?symbol=AAPL` (what executives and directors bought and sold, with their roles and 10b5-1 plans) and **Valuation**, whose sub-tabs are the four calculators below.

FMP data access depends on the endpoints and history included in your subscription. When FMP can't return the statements, the page says why: rate limit, invalid key, plan restriction or another provider error.

Each company's **Valuation** tab (after Insiders) holds four calculators, as sub-tabs. **Intrinsic Value** at `/valuation/intrinsic-value?symbol=AAPL` estimates intrinsic value with DCF, dividend, earnings, revenue, residual income and Graham models; it picks the models that suit the type of company, fills assumptions from the filings (or with AI), and explains each input and result. **Jeremy's Projection** at `/valuation/jeremy-projection` follows Jeremy Lefebvre's (1000xStocks) sheet: bull, base and bear cases from this year's analyst consensus, with revenue and net income growth and a P/E range, best for growth stocks. **Plumas Projection** at `/valuation/plumas-projection` projects revenue, margins, EPS, the share price and the yearly return five years past the last report, in three or five scenarios, with a Simple mode and an Advanced one (costs, interest, buybacks and a low, mid and high P/E), next to analysts' estimates, best for mature, dividend, cyclical and loss-making companies. Both pages say which of the two suits the company. **DCF Calculator** at `/valuation/dcf-calculator` discounts ten years of free cash flow plus a terminal value to a value per share, optionally from a year 1 forecast, and runs it backwards: the reverse DCF shows the growth today's price implies, next to the free cash flow history.

The **Market maps** page at `/maps` embeds the FINVIZ one-day heat maps of the S&P 500, the Nasdaq 100 and the largest cryptocurrencies.

The **Earnings** page at `/earnings` shows which companies report each day of the week, with analysts' estimates and, once results are out, the actual figures and surprises.

The **Dividends** page at `/dividends` shows a month of dividends on their ex-dividend or payment date, with the amount, yield and key dates. On the free FMP plan it covers about 25 large US companies, from about four weeks ago onward.

The **Recommendations** page at `/recommendations` screens the largest US companies for stocks well below the analysts' consensus target, rated Buy by at least 75% of analysts and below their 12-week average, with the 200-day average, RSI and the ratings trend beside them.

The **Compare** page at `/compare?symbols=CELH,MNST,KO` puts up to five stocks side by side: P/E, expected EPS and revenue growth and margins, next to the range many established companies trade at.

The **Portfolio** page at `/portfolio` tracks what you own and have made, from the buys and sales you record or from Trading 212 and Trade Republic statements (PDFs, previewed before anything is saved, with every trade, dividend and interest payment): value, today's change, the profit with its parts, dividends, weights by industry and a chart of your return against the S&P 500, with splits and dividends from Tiingo. It's shown in dollars or euros, converted at the ECB's rate for each day. It needs Google sign-in and a Postgres database.

The **Favorites** page at `/favorites` lists the companies you've starred from their overview, with the latest price and links to each tool. It needs Google sign-in and a Postgres database.

The **Fear gauge** page at `/vix` shows the VIX as a fear and greed gauge, compares it with a week, month and year ago, and charts its history, from FMP and Cboe's free daily history.

The **Events** page at `/events` is a timeline of what can move US markets: Fed decisions and their outcomes, the CPI, jobs, PCE and GDP reports, US elections and deadlines, and elections in major economies, from the Fed, FRED, BLS, BEA, Census and Wikipedia. On request, AI adds summits, trade and funding deadlines it finds in the news.

The **News** page at `/news` shows global market, deal, forex and crypto headlines from Finnhub; `/news?symbol=AAPL` shows the company's headlines from the last 14 days.

The **AI chat** is the round spark button at the bottom right of every page. Ask about any US stock, the market or your portfolio in plain language; Gemini looks the figures up in StockPilot's data (quotes, statements, forecasts, news, filings, insider trades, earnings calls, the calendars and, when you're signed in, your portfolio and favorites), and each answer links to the pages it read. On a company's pages, a question that names no company is about that one.

## Documentation

| Doc | Covers |
| --- | --- |
| [`docs/data-sources.md`](./docs/data-sources.md) | Which API is used when: each provider's free plan, the rules for choosing, caching and failures, and what each page costs |
| [`docs/fmp-data.md`](./docs/fmp-data.md) | FMP endpoints, response caching, error reasons and troubleshooting |
| [`docs/data-fallbacks.md`](./docs/data-fallbacks.md) | SEC filings and Finnhub when FMP can't provide a company: what's covered and how filings become statements |
| [`docs/financials.md`](./docs/financials.md) | Income statement, balance sheet, cash flow and ratios: columns, TTM, growth and the chart |
| [`docs/stock-overview.md`](./docs/stock-overview.md) | The stock overview page, company tabs, and where each statistic comes from |
| [`docs/recommendations.md`](./docs/recommendations.md) | The Recommendations screen: its signals, data sources, request budget and limits |
| [`docs/compare.md`](./docs/compare.md) | The Compare page: each metric's calculation and source, fiscal-year matching and free-plan gaps |
| [`docs/valuation.md`](./docs/valuation.md) | The four valuation tools: intrinsic value models, stock types, default assumptions, scenarios, AI autofill, Jeremy's and the Plumas projections (their differences and which stocks each suits) and the DCF calculator |
| [`docs/ai-analysis.md`](./docs/ai-analysis.md) | The AI review buttons on financial sections: configuration, what's sent, prompt rules and errors |
| [`docs/chat.md`](./docs/chat.md) | The AI chat: the button and panel, how answers look data up, what's sent to Gemini, limits and errors |
| [`docs/earnings.md`](./docs/earnings.md) | The earnings calendar: data, company names, filters and surprises |
| [`docs/dividends.md`](./docs/dividends.md) | The dividend calendar: data, free-plan limits and the two date views |
| [`docs/news.md`](./docs/news.md) | Finnhub news feeds, categories, and how headlines are cleaned and filtered |
| [`docs/events.md`](./docs/events.md) | The market events timeline: each source, how events are worked out, the AI news scan and its checks |
| [`docs/vix.md`](./docs/vix.md) | The VIX fear gauge: zones, the dial, data sources and fallbacks |
| [`docs/market-maps.md`](./docs/market-maps.md) | The FINVIZ market map embed and its limits |
| [`docs/auth.md`](./docs/auth.md) | Google sign-in: setup, session cookie and the top bar menu |
| [`docs/forecast.md`](./docs/forecast.md) | The Forecast tab: price targets and their trend, ratings by month, estimates, earnings surprises and rating changes, and where each comes from |
| [`docs/insiders.md`](./docs/insiders.md) | The Insiders tab: Finnhub's Form 4 trades, roles and 10b5-1 plans from the SEC filings, and what each figure counts |
| [`docs/filings.md`](./docs/filings.md) | The Filings tab: SEC EDGAR filings, filters, 8-K descriptions and press releases |
| [`docs/transcripts.md`](./docs/transcripts.md) | Earnings call transcripts: Alpha Vantage, fiscal quarters, saving them in Postgres and the free-key limits |
| [`docs/notifications.md`](./docs/notifications.md) | Telegram notifications: the bot, linking a chat, the four commands and the GitHub Actions schedule |
| [`docs/portfolio.md`](./docs/portfolio.md) | The Portfolio: recording trades and importing statements, the profit, dollars or euros, how splits, average cost, dividends and returns are worked out, its data and limits |
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

See [`DESIGN.md`](./DESIGN.md) for the project tokens and component rules. The sidebar groups the pages into Workspace (Home, Stocks, Compare, Recommendations, Portfolio, Favorites) and Markets, and can collapse to an icon rail; the valuation calculators are a company's Valuation tab. The light/dark theme switch is in the top bar; it follows the system preference until a choice is saved.

On the Financials page, the spark button beside each section title asks Gemini to explain that section's figures in plain language; the spark button at the bottom right of every page opens the AI chat. Intraday prices and a dedicated dividend history are not included yet.
