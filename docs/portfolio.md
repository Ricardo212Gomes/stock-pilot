# Portfolio

`/portfolio` keeps track of what a signed-in user owns and has made. They record each buy and sale (ticker, date, shares and price), or import everything from a Trading 212 or Trade Republic statement, and the page works out the rest:

- four cards: the value, today's change, the profit and the yearly dividends;
- a performance chart against the S&P 500;
- the holdings, closed positions, weights by industry, imported dividends and interest by month, and the list of trades.

The profit is the gain on what's held, plus the realized gains on everything sold, the dividends and the interest on cash. The card breaks it down into those four parts.

Trades belong to the Google account (see [`auth.md`](./auth.md)) and are stored in Postgres. Prices come from Finnhub and Tiingo, so a portfolio costs no FMP requests. The page is shown in dollars or euros (see [Dollars or euros](#dollars-or-euros)).

## Adding a trade

The form at the top of Trades takes:

- **Buy or Sell.**
- **Ticker:** suggestions come from the bundled stock list, the same as the search box's. Funds and ETFs aren't in that list, but any ticker with prices works, VOO or SPY included. Share classes are written with a dash (BRK-B), and BRK.B is accepted.
- **Date:** today in New York or earlier, back to 1980.
- **Shares:** fractions are fine.
- **Price per share:** optional, in dollars or euros (the menu beside it starts at the portfolio's currency). Left empty, it becomes that day's close from Tiingo (the latest close on or before a weekend or holiday), converted at that day's rate for a trade in euros. For a trade dated today, it becomes the live price.

The server action (`addTradeAction`) checks the trade against the market and the user's other trades before saving it:

- The ticker must have prices: Finnhub refuses tickers it doesn't know, and Tiingo answers them with a 404. If Finnhub is down and Tiingo has nothing, the message says to try again rather than that the ticker is wrong.
- A sale can't be of more shares than were held on its date. The message gives the shares held then.
- A sale dated before others can't leave a later sale short.
- A portfolio follows up to 30 tickers with prices, closed ones included, and holds up to 10,000 trades and 10,000 dividend and interest payments. Each ticker with prices costs a Tiingo request a day (50 an hour on the free plan) and two Finnhub requests. Imported instruments without prices (see below) cost none and don't count.

Each trade in the list has a delete button, which asks for confirmation. Deleting a buy that a later sale depends on is allowed: that sale is then flagged "More than you held then" and only counts the shares that were held. "Delete all trades", beside the Trades heading, empties the portfolio after a confirmation, imported dividends and interest included, to start over or import again. The list shows the latest 100 trades, with a link to all of them.

## Importing a broker statement

"Import a statement", under the trade form, reads a broker's PDF, ideally covering the time since the account was opened: Trading 212's activity statement (History, then Statements) or Trade Republic's account statement. Importing one from each broker shows both accounts together: a company held at both is one position. Nothing is saved until the user confirms.

1. **Preview.** Choosing the file sends it to a server action (`previewStatementAction`). The server reads the PDF's text with [unpdf](https://github.com/unjs/unpdf) (pdf.js without a worker) and rebuilds the tables' rows from each piece of text's position (`src/lib/statement-pdf.ts`). It then tells which broker's statement it is (`src/lib/parse-statement.ts`) and picks out the trades, open positions, dividends and interest (`src/lib/trading212.ts`, `src/lib/trade-republic.ts`; both give the same shape, `src/lib/statements.ts`). The preview counts what would be added, lists the companies held with their trades and shares, says what's left out and why, and checks the realized gains against Trading 212's own.
2. **Import.** Confirming sends the file again (`importStatementAction`), which reads it again rather than trusting trades sent back from the browser, and saves the trades and payments, each set in one statement. The PDF itself is never stored, only what's imported.

What's imported (`src/lib/portfolio-import.ts`):

- **Every trade.** The companies still held, at this broker or the other, are matched to US tickers and followed with prices, as trades entered by hand are.
- **Companies sold off, without prices.** A busy account has traded hundreds of instruments, more than the free price plans can follow, and many are European funds with no US prices. Their gains need none: a closed position's realized gain is what its sales brought in less what its buys cost. So they're saved under their ISIN with `priced` off, and cost no requests. They go by Trading 212's code (the dollar line's when there is one, a US ticker) and, for a US company traded in dollars, the bundled stock list's name; otherwise the ISIN shows under the code. The chart leaves them out and says so.
- **One company, one ticker.** Trading 212 can trade a company on a euro line (NVD) and a dollar line (NVDA). Both share the ISIN, so their trades are merged. A US ISIN gets its ticker from Finnhub's profile (`stock/profile2?isin=`). Finnhub's free plan refuses foreign ISINs (IREN's is Australian), so a dollar line's own code is tried on Tiingo instead, and accepted if it traded within 30% of the statement's price that day. A euro line's code isn't tried: Trading 212 names European funds after US ones (its SMH is a UCITS fund). A held company with no US listing is imported without prices, valued at its last trade's price.
- **What it cost, fees included.** Each trade's price is the statement's total in the account's currency divided by the shares: what a buy cost or a sale brought in, after the FX fee. The Portfolio's average cost then matches Trading 212's own.
- **Dividends after tax, and interest.** Each dividend as paid, after withholding tax, goes to its company's position. Interest on cash (on euros, and on dollars in its euro amount) and lending interest count in the profit. An imported company's dividends are only these: Tiingo's are for companies entered by hand. Card payments and cashback, deposits, withdrawals and transfers aren't returns, so they're counted in the preview and left out, and the crypto account isn't read.
- **Dates in New York.** The statement's times are in UTC; a trade's date is the New York date, as for the market. Trades are saved oldest first, so a buy and a sale on the same day keep their order. A payment keeps the statement's own date.
- **Splits.** A "Stock split" is a pair of entries, the old shares out and the new ones in at the same value. The pair is left out, and the trades before it are put in the new shares (a buy of 1 before a 4-for-1 split becomes 4 at a quarter of the price), as Tiingo's split factors would.
- **Never twice.** Each trade is saved with an id from Trading 212's order id, time, shares and price, and each payment with its own (the ISIN, pay date, shares and amount, or the time and amount as written). A unique index skips ids already saved, so importing a later statement only adds what's new, and importing the same one again adds nothing.
- **Earlier imports move with it.** A company held at the last import and sold off since is moved to its ISIN, without prices; one sold off then and held now gets its ticker, and one that couldn't be looked up gets it once it can. Their dividends move too. A ticker found once isn't looked up again.

### Trade Republic's statement

Trade Republic's account statement is one table of cash movements: date, type, description, money in, money out and balance. A trade is a description, "Buy trade US0231351067 AMAZON.COM INC. DL-,01, quantity: 5" or "Savings plan execution IE00B5BMR087 iShares … (Acc), quantity: 0.067899", with what it cost or brought in, fees included. Interest and dividends are their own rows; transfers and card payments are counted and left out.

- **Reading it.** Each row is a band of lines: the day and month above the year, the type and amounts between them, the description on one line or wrapped over two. The header's six capitalized column names, in whatever language, mark where each column starts, and one piece of text can hold two amounts (what went out, then the balance). Dates and amounts are read in Portuguese, English, German, Spanish, French or Italian ("16 out. 2026", "1 120,29 €", "€1,120.29"). On a real statement, every row's balance follows from the amounts read.
- **Names.** Trade Republic gives a name, not a code: "AMAZON.COM INC." without its par value ("DL-,01"), or a fund's own name.
- **What's held.** The statement lists no open positions, so what's held is what its trades add up to, on top of earlier Trade Republic statements already imported (less any trades both include). A sale of more than that means the statement starts after some buys; the preview says which, to import an earlier statement or add them by hand.
- **Ids.** There are no order ids, so a trade's id is its date, ISIN, side, shares and amount; two rows alike in every field (two savings plan buys of the same amount on one day) are numbered in the statement's order.
- **No return of its own.** The preview shows the realized gains after fees alone.

### Both brokers

Each trade and payment remembers its broker by its id. A company sold at one broker but still held at the other keeps its ticker and prices, and its trades at both make one position, at the average cost of all of them.

The realized gains count fees, and Trading 212's Return column doesn't: it's the gain at average cost before the currency conversion and government fees. The preview shows both. On a real statement (1,760 trades in 151 instruments), the gains before fees match Trading 212's for every instrument, to a cent in total.

The preview also says:

- when a company's trades don't add up to its open position, because the statement starts after the first buys;
- when a company has trades entered by hand, which the import adds to;
- when a lookup failed because Finnhub or Tiingo was at its limit or not answering. Those companies are imported without prices for now and listed as not looked up yet, rather than as having no listing; choosing the statement again later gives them their tickers.

Only accounts in dollars or euros are imported. A statement in euros offers to show the portfolio in euros as well.

The upload is a few megabytes (a 145-page statement is 1.6 MB), over Next's 1 MB default for server actions, so `next.config.ts` raises the limit to 10 MB. The action refuses files over 9.5 MB and anything that doesn't start like a PDF.

## Dollars or euros

The switch above the cards shows the whole page in dollars or euros, saved per user (`portfolio_settings`). Market prices are in dollars, and trades keep the currency they were paid in. Everything is converted at the European Central Bank's reference rate for the day each amount belongs to, from [Frankfurter](https://frankfurter.dev) (free, no key):

- a trade at its date's rate;
- a dividend at its ex-date's;
- each close in the chart at that day's;
- live prices at the latest rate.

Weekends and holidays take the business day before. So a portfolio in euros grows or shrinks with the dollar, and so does the S&P 500 it's measured against.

Rates are only fetched when needed: for a portfolio shown in euros, or with a trade in euros. If Frankfurter doesn't answer, the page says so instead of showing wrong figures, and the switch stays available.

## How it's worked out

All of this is in `src/lib/portfolio.ts`, as pure functions with tests.

- **Splits.** Tiingo's daily prices carry a split factor (10 on NVIDIA's June 10, 2024 split). Trades are kept as entered and put in today's shares when read: 10 NVIDIA shares bought at $1,200 before the split count as 100 at $120. A broker's history may already show trades after the split, so the price decides. If it's closer to that day's close divided by the splits since, the trade was entered in today's shares and is left alone. The list notes each adjustment ("100 after the 10-for-1 split on Jun 10, 2024").
- **Cost.** Average cost: a sale takes its shares at the average cost of those held, and the difference from its price is the realized gain, shown on the sale and as Sales in the Profit card.
- **Dividends.** Tiingo's prices also carry each dividend on its ex-dividend date. A dividend goes to the shares held the day before: a buy on the ex-date misses it, and a sale on it still gets it. They count in the profit, except for imported companies, whose dividends are the statement's. "Dividends a year" is the last 12 months' dividends per share times the shares held now, and the yield divides that by today's value. Both are adjusted for splits, as the shares are.
- **Today.** The day's change from Finnhub's quote, applied to every share held, including any bought today. A holding without a live quote is valued at its last close (or its last trade's price) and left out of today's change.
- **Performance.** Returns are time-weighted: each day's change on what was held at the previous close, from Tiingo's closes adjusted for dividends. So money put in or taken out isn't a gain or a loss, and dividends count as reinvested. The S&P 500 is the SPDR S&P 500 ETF (SPY), measured the same way over the same days. The Value view plots the holdings at each close against what they cost. Both series end at live prices when the market is open. The chart's periods (1M, 6M, YTD, 1Y, All) measure from the close before each period starts, and a Month by month table lists the same figures. The holdings' percentage in the Profit card is on what was paid, so it differs from the time-weighted return whenever money went in at different times.

The chart needs every ticker's prices. If Tiingo doesn't send one (its hourly limit, or a ticker it doesn't cover), the chart waits and says which. Without `TIINGO_API_KEY` there's no chart, no split adjustment and no dividends, but holdings and gains still work from Finnhub's quotes.

## Data and requests

| Data | Source | Cached |
| --- | --- | --- |
| Live price and the day's change | Finnhub quote, per ticker and for SPY | 1 minute |
| Company name and industry | Finnhub company profile, the same request the company pages make. Funds have none, so names come from the bundled stock list, then Tiingo's ticker details | 1 day (Tiingo's names 30 days) |
| Daily closes, splits and dividends | Tiingo, per ticker and for SPY: five years, the same request as the Overview chart, or from just before the first trade when that's older | 1 day |
| Euro exchange rates | Frankfurter (the ECB's daily reference rates), from the first trade, only for a portfolio in euros or with trades in euros | 6 hours |
| A statement's tickers | Finnhub company profile by ISIN for US companies; for others, the dollar line's Tiingo prices, the same five-year request | 30 days (Tiingo's 1 day) |

The first view of a day costs about two Finnhub requests and one Tiingo request per ticker. After that, prices are a minute old at most: Next serves the cached quote and refreshes it in the background. Industries are Finnhub's (Semiconductors, Banking, Retail…), and every fund counts as Funds, whatever it holds.

## Database

`npm run db:setup` creates the `portfolio_trades`, `portfolio_income` and `portfolio_settings` tables (from `db/schema.sql`, safe to run again: on an existing database it only adds what's missing):

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | bigint | Identity; the delete button's reference, always checked against the user |
| `user_id` | text | The Google account id |
| `symbol` | text | The ticker, upper case, share classes with a dash; the ISIN for an instrument without prices |
| `side` | text | `buy` or `sell` |
| `shares`, `price` | numeric | As entered, before any later split |
| `currency` | text | The price's currency, `USD` or `EUR` |
| `traded_on` | date | The trade's date |
| `external_id` | text | For an imported trade, its broker id (`t212:…`), unique per user; empty for a trade entered by hand |
| `isin` | text | For an imported trade, the instrument's ISIN |
| `priced` | boolean | Off for an instrument StockPilot keeps no prices for |
| `label`, `name` | text | What such an instrument goes by: the broker's code, and its name when known |
| `created_at` | timestamptz | When it was recorded |

`portfolio_income` keeps imported payments: `kind` (`dividend` or `interest`), the dividend's `symbol` (its position's) and `isin`, the `amount` after withholding tax, its `currency`, `paid_on`, and `external_id`, unique per user. `portfolio_settings` keeps each user's `currency`, `USD` until they choose.

## Files

- `src/lib/portfolio.ts`: splits, positions, dividends, history, the page's data (`getPortfolio`) and the checks on a new trade (`prepareTrade`).
- `src/lib/portfolio-trades.ts`: reading, adding, importing and deleting trades and payments, moving earlier imports, the currency setting, and checking the form's fields.
- `src/lib/fx.ts`: the ECB's rates from Frankfurter, and converting at each day's rate.
- `src/lib/statement-pdf.ts`: a PDF's text with its positions, and as rows.
- `src/lib/statements.ts`, `src/lib/parse-statement.ts`, `src/lib/trading212.ts` and `src/lib/trade-republic.ts`: a statement's trades, positions, dividends and interest, and which broker's reader a PDF needs.
- `src/lib/portfolio-import.ts`: what a statement adds to the portfolio.
- `src/lib/tiingo.ts`: Tiingo's daily prices with split factors and dividends, and fund names.
- `src/app/portfolio/page.tsx`: the page, its sign-in and setup notices, and the empty state.
- `src/app/portfolio/dashboard.tsx`: the cards, holdings and closed positions, industries, dividends and interest, and trades.
- `src/app/portfolio/performance-chart.tsx`: the chart, its views and periods, and the month table.
- `src/app/portfolio/trade-form.tsx`, `delete-trade-button.tsx`, `delete-all-trades.tsx` and `actions.ts`: adding and deleting trades. The actions take the user from the session cookie, never from the browser.
- `src/app/portfolio/import-statement.tsx` and `import-preview.tsx`: the import, and its preview.
- `src/app/portfolio/currency-switch.tsx`: dollars or euros.

## Limits

- Dollars or euros only, and no cash balance, separate fees (an import counts them in each trade's price) or short sales.
- Imports read Trading 212's activity statement (its invest account, not crypto) and Trade Republic's account statement. Trade Republic's dividend rows are recognized by "dividend" in their type or description, since the statement this was built from had none.
- An imported company's dividends after the statement's end come with the next statement; Tiingo's aren't used for it.
- The chart follows the companies with prices only; the others' gains are in the profit.
- A trade's intraday gain isn't counted in the return, which runs from the close of the trade's day.
- Splits and dividends from before Tiingo's history of a ticker aren't known.
- A spin-off or merger shows as the shares entered; record the new company's shares as a buy.
