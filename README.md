# StockPilot

StockPilot looks up a stock ticker and displays up to five annual periods of company fundamentals from Financial Modeling Prep (FMP): income statement metrics, balance sheet figures, cash flow and financial ratios.

## Configure FMP

FMP authenticates requests with an API key. No separate API secret is needed for these endpoints.

1. Copy `.env.example` to `.env.local` in the project root.
2. Set `FMP_API_KEY` to the key from your FMP account.
3. Set `GEMINI_API_KEY` to your Gemini API key to enable AI analysis. `GOOGLE_GENERATIVE_AI_API_KEY` is also accepted if you already use that name.
4. Restart the Next.js development server after changing the environment file.

Both keys are read only by server code and are not exposed to the browser. Do not commit `.env.local`.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a ticker such as `AAPL` in the top search, and select **Search**. The sidebar links to Company research; the fundamentals page is available at `/stock?symbol=AAPL`.

FMP data access depends on the endpoints and history included in your subscription. The page reports when FMP cannot return a requested set of statements.

## Design system

See [`DESIGN.md`](./DESIGN.md) for the project tokens and component rules. The sidebar currently contains the Company research tool and a light/dark theme switch; the top bar keeps a synchronized copy. The theme selector follows the system preference until a choice is saved.

The current dashboard is focused on annual fundamentals. The **Analyze with AI** action sends a compact version of the displayed annual metrics to Gemini and shows an objective summary. Live quotes, dividend data and valuation sections are not included yet.
