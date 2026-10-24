# Dividend calendar

`/dividends` shows a month of dividends from Financial Modeling Prep's dividend calendar, placed on either the ex-dividend date or the payment date. The sidebar links to it under Markets, after Earnings.

## Files

- `src/app/dividends/page.tsx`: loads the month on the server and builds the toolbar, summary and error messages.
- `src/app/dividends/dividend-board.tsx`: the month grid and the details dialog.
- `src/lib/dividend-calendar.ts`: months, the grid, loading and placing dividends.
- `src/app/components/company-logo.tsx`: the logo tile shared with the earnings calendar.

## URLs

| Parameter | Meaning | Default |
| --- | --- | --- |
| `month` | The month to show (`YYYY-MM`); anything else falls back to the default | The current month |
| `by=pay` | Place dividends on their payment date | Ex-dividend date |

"Today" is the date in New York, as on the earnings calendar.

## Data

| Source | Request | Cached |
| --- | --- | --- |
| FMP `dividends-calendar?from=…&to=…` | One per month and view | 6 hours |
| Finnhub `stock/symbol?exchange=US` | Company names, shared with the earnings calendar | 24 hours in server memory |

FMP filters the calendar by ex-dividend date. The payment view therefore asks for 60 extra days before the month, because a payment can follow its ex-dividend date by several weeks.

The free FMP plan has two limits:

- It covers about 25 large US companies, not every dividend payer. A paid plan returns them all.
- It refuses requests that start more than about four weeks ago. The look-back for the payment view stops 25 days before today, so the current and coming months always load. Older months show a message suggesting a more recent month or a paid plan.

The yield is FMP's figure, in percent. The annual dividend is the dividend times the payments a year for monthly, quarterly, semi-annual and annual payers, and is left empty for other frequencies.

## Layout

- A toolbar with previous, this-month and next buttons, the month name, and an **Ex-dividend date** / **Payment date** switch.
- A Monday-to-Friday grid covering the month. Days from the neighbouring months are shaded, and their dividends are shown but not counted. Today's date sits in a filled circle.
- Each dividend is a tile with the logo, ticker and amount, highest yield first within a day.
- Selecting a tile opens a dialog with the company name, dividend and frequency, yield, annual dividend, the declared, ex-dividend, record and payment dates, and a link to its Overview.
- At 900px and under, the grid becomes a list of the days that have dividends.

## Errors

A plan restriction gets the message above. Other failures (no key, invalid key, rate limit, another error) use the shared FMP messages.
