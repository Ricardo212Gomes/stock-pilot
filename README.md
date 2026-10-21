# StockPilot

StockPilot looks up a stock ticker and displays up to five annual periods of company fundamentals from Financial Modeling Prep (FMP): income statement metrics, balance sheet figures, cash flow and financial ratios.

## Configure FMP

FMP authenticates requests with an API key. No separate API secret is needed for these endpoints.

1. Copy `.env.example` to `.env.local` in the project root.
2. Set `FMP_API_KEY` to the key from your FMP account.
3. Restart the Next.js development server after changing the environment file.

The key is read only by server code and is not exposed to the browser. Do not commit `.env.local`.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a ticker such as `AAPL`, and select **Explore company**. The fundamentals page is available at `/stock?symbol=AAPL`.

FMP data access depends on the endpoints and history included in your subscription. The page reports when FMP cannot return a requested set of statements.
