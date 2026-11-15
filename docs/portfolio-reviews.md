# Portfolio reviews

The Portfolio page's **AI reviews** have [TradingAgents](https://github.com/TauricResearch/TradingAgents), an open-source multi-agent framework, review a user's own holdings: the ones worked out from the trades they recorded and the statements they imported (see [`portfolio.md`](./portfolio.md)). Each review ends in a rating (**Buy, Overweight, Hold, Underweight or Sell**), a plan, a price target and a time horizon, written against the user's actual position: the trader, the risk team and the portfolio manager see the shares and average cost.

They're off until the user turns them on, under AI reviews on the Portfolio page. The page says what's sent before they do: each holding's ticker, shares and average cost go to Google's Gemini API in TradingAgents' prompts. Reviews only recommend; nothing is traded. They don't involve the AI portfolio ([`ai-portfolio.md`](./ai-portfolio.md)), which is a separate paper account.

## What a review is

For one holding and day, TradingAgents runs its team on the market and news analysts:

1. The **market analyst** (price, moving averages, RSI, MACD, Bollinger bands, ATR) and the **news analyst** (company and global news, macro indicators, prediction markets) write their reports, with at most three rounds of look-ups each.
2. A **bull** and a **bear researcher** debate one round; the **research manager** weighs them into an investment plan.
3. The **trader** turns it into a plan for the position.
4. **Aggressive, conservative and neutral** risk analysts debate it one round.
5. The **portfolio manager** decides: the rating, an executive summary, the thesis, a price target and a horizon.

TradingAgents keeps a log of its decisions and, on later runs, settles the ones whose holding period has passed against what the price did, and learns from them.

## When they run

`.github/workflows/portfolio-review.yml` runs every day at 23:00 UTC, after the US close: `npm run portfolio:review -- --opted-in`. For each user who turned the reviews on, it reviews the **two holdings whose review is oldest**, holdings never reviewed first, skipping any reviewed that day. With 10 to 20 holdings, each is reviewed again every week or two, which suits the 1–3 month horizons the portfolio manager writes, and keeps within the free Gemini plan (below).

Running it by hand (Actions › Portfolio reviews › Run workflow) takes a user's id, and optionally one ticker.

### From the command line

Without waiting for the job, from the project root:

```bash
npm run portfolio:review -- --user <id> --ticker NVDA   # one holding now
npm run portfolio:review -- --user <id>                  # the two that are due
npm run portfolio:review -- --user <id> --all            # every holding now: one analysis each
npm run portfolio:review -- --user <id> --ticker NVDA --dry-run   # print it; read and save nothing in the database
```

`<id>` is the Google account id the trades are stored under (`user_id` in `portfolio_trades`). Each analysis takes about 8 minutes.

## Setting it up

1. **Python.** TradingAgents needs Python 3.11 or later. Create the environment in `agents/.venv` and install it there: with [uv](https://docs.astral.sh/uv/), `uv venv --python 3.13 agents/.venv && uv pip install --python agents/.venv/bin/python -r agents/requirements.txt` (or `python3 -m venv agents/.venv && agents/.venv/bin/pip install -r agents/requirements.txt`). TradingAgents isn't on PyPI, so `agents/requirements.txt` installs its GitHub release wheel, pinned to a version.
2. **A Gemini key of its own.** Create a key in a **new** Google Cloud project at [aistudio.google.com](https://aistudio.google.com/apikey) and set it as `AGENTS_GOOGLE_API_KEY`, in `.env` and as a repository secret. Gemini's free limits apply per project and per model, so a separate project keeps the reviews from using up the app's own AI features (`GEMINI_API_KEY`).
3. **The tables.** `npm run db:setup` adds `portfolio_reviews` and the `ai_reviews` setting.
4. **Optional, for better reviews:** `SEC_USER_AGENT` (a name and an email: SEC asks callers of EDGAR, where the fundamentals come from, to identify themselves) and `FRED_API_KEY` (free, [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html): the Fed funds rate, the 10-year Treasury yield and the VIX for the news analyst, which has no other source for them). See #5.

## How it works

- **The holdings** come from StockPilot's own code, so splits, average cost and currencies are worked out exactly as on the page: `npm run -s portfolio:holdings -- --user <id>` (`scripts/portfolio-holdings.ts`) prints them as TradingAgents' portfolio, `{"currency": "USD", "positions": [{"ticker", "quantity", "average_price"}]}`. It's in dollars whatever the page is shown in, since TradingAgents' prices are. Instruments without prices (funds and companies kept under their ISIN, see [`portfolio.md`](./portfolio.md)) are left out. StockPilot doesn't record cash, so `cash` stays unset: TradingAgents then advises on each position without assuming a flat book.
- **The analysis** (`agents/review.py`) passes that portfolio to `TradingAgentsGraph.propagate(ticker, date, portfolio=…)`, with the date in New York.
- **The result:** the rating, summary, price target and horizon are read from the portfolio manager's decision, and the report's sections are TradingAgents' own saved report (`save_reports`), stored by section. A decision without a readable rating is saved as `Review` and shown as "No rating".
- **One failing holding** (the day's Gemini limit, a data gap) is reported and the others go on. Checkpoints are on, so an analysis cut off by the limit resumes from its last step the next time it runs, rather than starting over.

### Settings

`agents/review.py` sets TradingAgents for Gemini's free plan; any of them can be overridden in the environment.

| Setting | Value |
| --- | --- |
| Analysts | Market and news |
| Models | `gemini-3.6-flash` for the analysts, researchers, trader and risk team; `gemini-3.5-flash` for the research and portfolio managers |
| Debate and risk rounds | 1 each |
| Look-ups per analyst | 3 (`TRADINGAGENTS_MAX_TOOL_ROUNDS`) |
| Retries per request | 4: once the day's allowance is gone, waiting longer doesn't help |
| Checkpoints | On |

## On the Portfolio page

- **Holdings** gets an **AI review** column once the reviews are on: each holding's latest rating and its date, opening the report. A review older than 21 days is greyed out.
- **AI reviews**, under Holdings: every reviewed holding with its rating (and the rating before it, when it changed), target, horizon, date and plan, with Underweight and Sell first. Before they're on, it explains them and what's sent; the switch is at the bottom.
- **The report**, `/portfolio/review?symbol=NVDA`: the rating in its colour (green for Buy and Overweight, red for Underweight and Sell, amber for Hold), the target, the position as it was reviewed and the target against its average cost, the plan, then each agent's report on a card in its own colour, grouped as the decision, the research debate, the risk debate and the analysts' reports, with a contents list beside them. The decision, the trader's plan and the research manager are open; the debates and the analysts' reports are folded, showing their first sentence. The reports are read as Markdown into React elements (never HTML; links only to StockPilot's own pages). The analysts write some comparisons as LaTeX formulas (`$$\text{Price } (\$162.85) < \text{10 EMA } (\$180.56)$$`); they're read into plain text (Price ($162.85) < 10 EMA ($180.56)) and set apart as a formula, with `\frac`, `\times`, `\leq`, arrows and Greek letters as their symbols.
- In the AI reviews table, **the whole row** opens the report (Ctrl or ⌘-click in a new tab); the company stays a link for keyboards and screen readers.
- **On Sundays, in the bell and on Telegram**, for users who turn on "Weekly AI reviews of your portfolio" in Notifications › Settings (off by default): what changed this week and every holding's latest rating, Underweight and Sell first. See [`notifications.md`](./notifications.md).

The page reads the reviews from Postgres; without their table (before `npm run db:setup`), it leaves them out.

## Limits and costs

- **Gemini:** the free plan allows 20 requests a day per model and per project. One analysis makes about 15–20, split across the two models, so about one or two a day per pair of models. Without the cap on look-ups, the analysts alone used 20. A paid key, or more models, would review more holdings a day.
- **Time:** about 8 minutes an analysis; the job has 90 minutes.
- **Data:** TradingAgents reads Yahoo Finance prices and news, SEC EDGAR statements, FRED with a key and Polymarket, on its own; StockPilot's API keys aren't used for the analyses. The holdings script uses Finnhub and Tiingo, as the Portfolio page does.
- **Memory:** TradingAgents keeps its decision log, checkpoints and cache in `~/.tradingagents`; the workflow keeps that folder between runs with `actions/cache`.

## Database

`portfolio_reviews`: `user_id`, `symbol`, `analysis_date`, `rating` (`Buy`, `Overweight`, `Hold`, `Underweight`, `Sell` or `Review`), `summary`, `price_target`, `horizon`, `report` (jsonb: each section's Markdown, by id), `shares` and `average_cost` as reviewed, `model` and `created_at`, unique per user, symbol and day (a second review the same day replaces the first). `portfolio_settings.ai_reviews` is each user's switch, off by default.

## Files

- `agents/review.py`: the reviews; `agents/test_review.py` its tests (`agents/.venv/bin/python -m unittest discover agents`); `agents/requirements.txt`.
- `scripts/portfolio-holdings.ts`: the holdings as TradingAgents' portfolio.
- `src/lib/portfolio-reviews.ts`: reading the reviews and the setting, the summary, and the holdings' conversion.
- `src/app/portfolio/ai-reviews.tsx`, `ai-reviews-switch.tsx`: the column, the section and the switch; `src/app/portfolio/review/page.tsx`: the report.
