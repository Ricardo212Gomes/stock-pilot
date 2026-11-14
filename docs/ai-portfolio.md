# AI portfolio

`/ai-portfolio` (Workspace › AI portfolio) is a model portfolio that Gemini manages from StockPilot's own data. Once a week it reviews the holdings and the Recommendations screen's best candidates and proposes target weights, with a reason for each move. StockPilot checks the proposal against fixed rules, then places the orders on an **Alpaca paper trading account**: real market prices, virtual money. The same account can be watched and managed live from Claude through the **Alpaca MCP server**.

It's one account, not each user's: the page is read only and visible to everyone. It's a paper portfolio managed by AI, not investment advice, and the page says so. The Telegram notifications and the AI chat don't use it.

## The weekly run

`npm run ai-portfolio:rebalance` (`scripts/ai-portfolio.ts`, `src/lib/ai-portfolio/rebalance.ts`) runs from GitHub Actions on Mondays at 15:00 UTC (`.github/workflows/ai-portfolio.yml`), with the market open in both winter and summer time, so a start delayed by hours still trades. Tuesday at the same time is the fallback for a Monday holiday; a week already done is skipped.

1. **Earlier fills.** Orders from earlier runs whose fills weren't known yet are looked up and recorded.
2. **One run a week.** If this week (Monday to Sunday, New York time) already has a placed or recorded run, it stops. A rejected or failed run doesn't count, so Tuesday tries again.
3. **The market is open.** With trading on, a closed market (a holiday, or GitHub starting the job after the close) stops the run before anything else; the next scheduled run tries again.
4. **The account.** Cash, equity and positions from Alpaca.
5. **Candidates.** The Recommendations screen's companies (the largest US companies FMP's plan covers, see [`recommendations.md`](./recommendations.md)), ranked by the screen's six signals: the best 30, plus every holding. A holding outside the screen gets the same figures with `loadCandidate`; one whose figures can't load at all is kept as it is that week.
6. **Headlines.** The three latest from Finnhub's company news (last 14 days) for each candidate.
7. **Gemini's proposal.** One request with a JSON schema (`responseMimeType: "application/json"`, `src/lib/ai-portfolio/prompt.ts`), retried once. It gets the week, the portfolio's value and cash, and for each candidate: the price, the upside to the analysts' consensus target and its range, the analysts' count, rating and Buy share now and three months ago, the close against the 12-week and 200-day averages, RSI, the distance from the 52-week high, the 3-month return, how many screen signals it meets, its weight and gain when held, and the headlines. A stock more than 10% under its 200-day average with over 40% upside to the target is flagged `targetMayBeStale`: after a fall, analysts' targets lag the price, so the instructions say not to buy on that upside, to weigh the trend, the direction of the ratings and the headlines instead, and to size such a position smaller. It answers with a summary, target weights in percent with a reason each, and exits for the holdings it drops.
8. **The checks** (`src/lib/ai-portfolio/rules.ts`). A proposal that fails any of them is recorded as rejected, with what failed, and nothing is traded.
9. **The orders.** Sales first, then the buys.

### The rules

| Rule | Limit |
| --- | --- |
| Positions | 10 to 20 |
| One stock | At most 10% of the portfolio |
| Cash | At least 5%, so the buys never borrow |
| Selling | At most 30% of the portfolio sold or trimmed in a week; buying with cash that was idle doesn't count |
| Tickers | Only the candidates offered |
| Small changes | A holding within 1 point of its target is held, not traded |

### Moves

Each holding becomes a **hold**, **add**, **trim** or **sell** (a holding the proposal leaves out is sold, with the exit's reason when it gave one), and each new target a **buy**.

- **Sales** go first: a sell closes the position (`DELETE /v2/positions/{symbol}`), a trim sells its dollar amount. The run then waits up to a minute for them to fill.
- **Buys** spend what's there after the sales: the account's non-marginable buying power less 5% of its value. Paper accounts allow margin by default, and this never uses it. When the buys come to more, each is cut by the same factor, and the run says so.
- **Orders** are market orders for the day by dollar amount (fractional shares), the only kind Alpaca takes a dollar amount on. A stock Alpaca can't trade in fractions is bought in whole shares at the last close; under one share, it's skipped. Each order's client id is `aip-{run}-{symbol}`.
- A refused order (`insufficient buying power`, a ticker Alpaca can't trade) is recorded on its move with Alpaca's reason; the others go ahead.

### Switches

| | Effect |
| --- | --- |
| `AI_PORTFOLIO_TRADING_ENABLED=true` | Places the orders. Unset or anything else: the moves are recorded for the page as "Not placed: trading is off" |
| `--dry-run` | Prints the proposal and the moves; stores and places nothing, and doesn't need the database |
| `--force` | Runs again in a week that's already done |

In GitHub Actions, `AI_PORTFOLIO_TRADING_ENABLED` is a repository **variable** (Settings › Secrets and variables › Actions › Variables), so trading can be switched on and off without a commit. Running the workflow by hand (Actions › AI portfolio › Run workflow) is a dry run unless that box is unticked.

Weekly rather than daily: the moves are meant for weeks to months, a daily rebalance would mostly trade noise, and one Gemini request a week fits the free plan beside everything else.

## Setting it up

1. **A paper account.** Sign up free at [alpaca.markets](https://app.alpaca.markets/paper/dashboard/overview) (an email is enough for paper trading), open the paper account and generate its API keys. It starts with $100,000 of virtual money; the amount can be changed by resetting it in the dashboard.
2. **The keys.** Set `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` in `.env` for the page, and as repository secrets for the job. StockPilot only talks to the paper endpoint (`https://paper-api.alpaca.markets`), so a live key can't place real orders from it.
3. **The tables.** `npm run db:setup` adds `ai_portfolio_runs` and `ai_portfolio_moves`.
4. **The job's secrets.** Besides the Alpaca keys: `DATABASE_URL`, `GEMINI_API_KEY`, `FMP_API_KEY` and `FINNHUB_API_KEY` (the screen), and `TIINGO_API_KEY` (prices when FMP's plan doesn't cover a company).
5. **A first look.** `npm run ai-portfolio:rebalance -- --dry-run` prints what it would do. Then run it without `--dry-run` with trading still off: the page shows the moves, unplaced. Set the `AI_PORTFOLIO_TRADING_ENABLED` variable to `true` when they look right.

## Alpaca MCP: the account from Claude

Alpaca's official [MCP server](https://github.com/alpacahq/alpaca-mcp-server) (MIT) gives an AI assistant the same account: its balance, positions, portfolio history, orders, market data and news. It trades on paper unless `ALPACA_PAPER_TRADE=false` is set with live keys. To add it to Claude Code with the paper keys:

```bash
claude mcp add alpaca --scope user --transport stdio uvx alpaca-mcp-server \
  --env ALPACA_API_KEY=… --env ALPACA_SECRET_KEY=… \
  --env ALPACA_TOOLSETS=account,trading,stock-data,news
```

Then ask "how is the AI portfolio doing this week?", "why did NVDA drop today?" or "close the TSLA position"; it uses tools such as `get_account_info`, `get_all_positions`, `get_portfolio_history`, `place_stock_order` and `close_position`. Review an order it proposes before confirming it. A position changed by hand is simply part of the portfolio at the next weekly run.

StockPilot's job and page call Alpaca's Trading API directly, the API the MCP server is built on. MCP is a protocol for AI assistants: the server is a Python process over stdio, which a GitHub Actions job or the deployed app shouldn't drive, and placing orders from code is what keeps the rules above outside a model's hands.

## The page

`src/app/ai-portfolio/page.tsx`, with its data from `getAiPortfolio` (`src/lib/ai-portfolio/view.ts`). It renders for each request; Alpaca's reads are cached for a minute, the daily history for 30 minutes.

- **Cards:** the value, today's change from yesterday's closing equity, the return since the first day against the S&P 500, and the cash.
- **Performance:** the Portfolio page's chart (`PerformanceChart`), its line called AI portfolio: the account's daily closing equity from Alpaca's portfolio history, against SPY's from Tiingo (dividends included) over the same days. The paper account takes no deposits, so the return is the equity against the first day's, and the Value view's cost line is that first day's equity.
- **Positions:** shares, average cost, price, today, value, gain and weight, each linked to the company's pages.
- **This week's moves:** the run's outcome, its summary, what failed for a rejected run, and each move with its weights before and after, the amount, the order's status or fill, and the reason. Earlier weeks are under a disclosure.

Without the Alpaca keys the page says how to connect the account; without a database, the account still shows, with a note where the moves would be.

## Requests

| Source | Each weekly run | The page |
| --- | --- | --- |
| Alpaca | The clock, account (twice), positions, an asset lookup per order, the orders and their status | Account, positions, portfolio history |
| FMP | The Recommendations screen: about 73 (a coverage check, then a price target and a year of closes per covered company), plus 2 per holding outside the screen | 0 |
| Finnhub | Ratings per screened company, and company news per candidate (about 30) | 0 |
| Tiingo | Closes when FMP's plan doesn't cover a company | SPY's daily prices, shared with the Portfolio page |
| Gemini | One request, two if the first fails | 0 |

The job runs outside Next, so none of its requests are cached: the screen costs its full FMP requests once a week.

## Database

| Table | Columns |
| --- | --- |
| `ai_portfolio_runs` | `week` (its Monday), `status` (`placing`, `placed`, `recorded`, `rejected` or `failed`), `summary`, `model`, `problems` (what failed, or the orders Alpaca refused), the `equity` and `cash` at the start, the number of `candidates` |
| `ai_portfolio_moves` | `run_id`, `symbol`, `action`, `weight_before`, `weight_after`, `amount` (dollars, after any cut to fit the cash), `reason`, and the Alpaca `order_id`, `order_status`, `filled_qty`, `filled_price`, `filled_at`, or the `error` it was refused with |

## Not included

- **Live trading with real money.** Alpaca's [guide for non-US residents](https://alpaca.markets/learn/live-trading-account-non-us) lists Portugal, but it is several years old, and Alpaca now also runs [Alpaca Europe](https://alpaca.markets/blog/alpaca-expands-into-europe-and-launches-european-equities-trading/). It would need confirming with Alpaca, and its own switch.
- **Stop-losses between runs.** Positions change only at the weekly run (or by hand, through Alpaca's dashboard or the MCP server).
- **Valuation figures.** The candidates' Intrinsic Value estimates would cost about six FMP requests each; the analysts' targets and the price trend stand in.

## Files

- `src/lib/alpaca.ts`: the Trading API on the paper endpoint (account, positions, portfolio history, assets, clock, orders), with share classes converted (BRK-B ↔ BRK.B).
- `src/lib/ai-portfolio/rules.ts`: the rules, the checks, moves from target weights, fitting the buys to the cash, and the weeks.
- `src/lib/ai-portfolio/prompt.ts`: the instructions, schema, prompt and parsing (weights in percent or as fractions).
- `src/lib/ai-portfolio/rebalance.ts`: the weekly run, with its dependencies passed in so the tests run it without Alpaca, Gemini or a database.
- `src/lib/ai-portfolio/store.ts`: runs and moves in Postgres.
- `src/lib/ai-portfolio/view.ts`: the page's data, and the account's history against SPY.
- `src/lib/recommendations.ts`: `loadCandidate`, one company's screen figures, shared with the Recommendations screen.
