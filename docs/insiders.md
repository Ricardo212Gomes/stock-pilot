# Insiders

`/stock/insiders?symbol=AAPL` is a company's Insiders tab: what its executives, directors and holders of 10% or more bought and sold over the last year. Each of them must report every transaction on an SEC Form 4 within two business days.

## Page

- **Three cards:** dollars bought in the market (with the number of buys and buyers), dollars sold (with the part sold under Rule 10b5-1 plans), and the net, signed and coloured.
- **Trades in the market by month:** a bar per month for the last twelve, buys above zero in `positive` and sales below in `negative`, with a legend and a tooltip giving both figures.
- **Who's trading:** each insider who bought or sold in the market, with their role, number of trades, dollars bought and sold, shares held after their latest filing and its date, biggest traders first. A line counts the insiders who only received awards, exercised options, had shares withheld or gave gifts.
- **Transactions:** the latest 100, newest first, with Buys and sales (the default) and All transactions as tabs (`view=all`). Each row has the trade date (and the filing date when later), the insider and role, the transaction with a 10b5-1 plan tag when it applies, signed shares, price, value, shares held after and a link to the Form 4 on EDGAR. Phones hide the price, holdings and link.

Buys and sales are trades in the market at the insider's own choosing, so they're the ones counted in the cards, chart and Who's trading. Everything else (Form 4 codes A, M, X, C, F, G and the rest) comes with pay, options and estate planning and says little about the price. A sale under a 10b5-1 plan was scheduled months ahead, so the page tags it.

## Data

| What | Source | Cached |
| --- | --- | --- |
| Every Form 4 transaction since a year ago: name, dates, code, shares, price, holdings after, accession number | Finnhub `stock/insider-transactions` (free for every US stock) | 6 hours |
| The company's filings, to find each Form 4 by its accession number | SEC EDGAR submissions (shared with the Filings tab) | 6 hours |
| Each insider's role and the 10b5-1 flag | The Form 4 XML, for the 40 newest filings | 30 days (filings never change) |

Finnhub's derivative rows (the options themselves) are left out: an exercise also shows up as shares acquired, which is what holdings follow. Names filed in capitals are shown in title case.

The role comes from the filing's `reportingOwnerRelationship`: the officer title, Director, 10% owner, or the filer's own description, joined ("CEO, Director"). An insider's role from one filing fills in their older rows. The 10b5-1 flag is the form's `aff10b5One` box, added in April 2023; on older forms a footnote naming a 10b5-1 plan counts. Trades in filings that weren't read show no tag, so the planned share is a floor.

A first visit reads up to 40 small XML files from the SEC, four at a time (the SEC allows 10 requests a second), so the tab streams in under the company header in a second or two. Later visits come from the cache. FMP's insider endpoints need a paid plan, so the tab doesn't use FMP.

## Files

- `src/lib/insiders.ts`: Finnhub parsing, transaction codes, Form 4 reading, and the cards', chart's and table's figures.
- `src/app/stock/insiders/page.tsx`: the tab.
- `src/app/stock/insiders/insider-chart.tsx`: the monthly chart (Recharts, client).
- `src/lib/concurrency.ts`: `mapLimit`, shared with Recommendations.
