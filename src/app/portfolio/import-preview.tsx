"use client";

import { BROKER_NAMES } from "@/lib/statements";
import { formatMoney } from "@/lib/valuation/format";
import type { ImportPreview } from "./actions";

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

function formatShares(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${new Intl.NumberFormat("en-US").format(count)} ${count === 1 ? word : many}`;
}

const CURRENCY_NAMES = { USD: "dollars", EUR: "euros" } as const;

// "IREN (AU0000185993), VWCE (IE00BK5BQT80)".
function codes(items: { code: string; isin: string }[]): string {
  return items.map((item) => `${item.code} (${item.isin})`).join(", ");
}

function mismatched(holding: ImportPreview["holdings"][number]): boolean {
  return Math.abs(holding.shares - holding.tradedShares) > 1e-6;
}

type PanelProps = {
  preview: ImportPreview;
  // Whether to show the portfolio in the statement's currency, when it's another.
  switchCurrency: boolean;
  onSwitchCurrency: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

// What a statement would add, with what's left out and why, and the buttons to import it or not.
export function ImportPreviewPanel({ preview, switchCurrency, onSwitchCurrency, onConfirm, onCancel }: PanelProps) {
  const { currency } = preview;
  const payments = preview.dividends + preview.interest;
  const heldTrades = preview.holdings.reduce((total, holding) => total + holding.trades, 0);
  const signed = (value: number) => `${value > 0 ? "+" : ""}${formatMoney(value, currency)}`;
  const nothingNew = preview.newTrades === 0 && payments === 0;
  const brokerName = BROKER_NAMES[preview.broker];
  return (
    <div className="portfolio-import-preview">
      <p>
        From {brokerName}: <strong>{plural(preview.newTrades, "trade")}</strong>
        {payments > 0 && <> and <strong>{plural(payments, "dividend and interest payment", "dividend and interest payments")}</strong></>}
        {preview.from && preview.to && <>, from {formatDay(preview.from)} to {formatDay(preview.to)}</>}, in {CURRENCY_NAMES[currency]} with fees included:
      </p>
      <ul className="portfolio-import-summary">
        {preview.holdings.length > 0 && (
          <li>
            {plural(heldTrades, "trade")} for the {plural(preview.holdings.length, "company", "companies")} you hold, below
            {preview.holdings.some((holding) => !holding.priced) ? "" : ", followed with live prices"}.
          </li>
        )}
        {preview.sold.instruments > 0 && (
          <li>
            {plural(preview.sold.trades, "trade")} for {plural(preview.sold.instruments, "company you've sold", "companies you've sold")}. They&apos;re
            kept without prices: their gains come from the trades.
          </li>
        )}
        {payments > 0 && (
          <li>
            {plural(preview.dividends, "dividend")}, after withholding tax, and {plural(preview.interest, "interest payment")} on cash.
          </li>
        )}
        <li>
          Realized gains: <strong className="portfolio-amount">{signed(preview.realized.afterFees)}</strong> after fees.
          {preview.realized.broker !== null && (
            <>
              {" "}{brokerName}&apos;s Return column comes to <span className="portfolio-amount">{signed(preview.realized.broker)}</span>: it leaves
              out the currency conversion and government fees on what was sold.
            </>
          )}
        </li>
      </ul>
      {preview.holdings.length > 0 && (
        <div className="table-scroll">
          <table className="financial-table portfolio-table portfolio-import-table">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col" className="portfolio-optional">In the statement</th>
                <th scope="col">Trades</th>
                <th scope="col">Shares</th>
              </tr>
            </thead>
            <tbody>
              {preview.holdings.map((holding) => (
                <tr key={holding.isin}>
                  <th scope="row">
                    <strong>{holding.symbol}</strong>
                    {holding.name !== holding.symbol && <small className="portfolio-optional">{holding.name}</small>}
                    {!holding.priced && <small>No prices: valued at its last trade</small>}
                  </th>
                  <td className="portfolio-optional">{holding.codes.join(", ")}</td>
                  <td>{holding.trades}</td>
                  <td>
                    {formatShares(holding.shares)}
                    {mismatched(holding) && <small className="negative-value">The trades add up to {formatShares(holding.tradedShares)}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className="portfolio-import-notes">
        {preview.unchecked.length > 0 && (
          <li className="portfolio-import-warning">
            <strong>{codes(preview.unchecked)} couldn&apos;t be looked up just now.</strong> Finnhub or Tiingo is at its free limit or
            not answering (Tiingo&apos;s allows 50 requests an hour), so {preview.unchecked.length === 1 ? "it's" : "they're"} imported
            without prices. Choose the statement again later to give {preview.unchecked.length === 1 ? "it its ticker" : "them their tickers"}; nothing is
            added twice.
          </li>
        )}
        {preview.incomplete.length > 0 && (
          <li className="portfolio-import-warning">
            <strong>The statement starts after some buys:</strong> it sells more {preview.incomplete.map((item) => item.code).join(", ")} than it buys.
            Import a statement from when you opened the account (or the earlier ones too), or add those buys by hand.
          </li>
        )}
        {preview.holdings.some(mismatched) && (
          <li>Where the trades don&apos;t add up to what you hold, the statement starts after your first buys: add those by hand, or import a statement from when you opened the account.</li>
        )}
        {preview.unresolved.length > 0 && (
          <li>No US listing found for {codes(preview.unresolved)}, so {preview.unresolved.length === 1 ? "it's" : "they're"} imported without prices, at {preview.unresolved.length === 1 ? "its" : "their"} last trade&apos;s price.</li>
        )}
        {preview.addsTo.length > 0 && (
          <li>You entered trades in {preview.addsTo.join(", ")} by hand, and these are added to them. If some are the same trades, delete yours first.</li>
        )}
        {preview.withoutTotal > 0 && <li>{plural(preview.withoutTotal, "trade")} without a total in {CURRENCY_NAMES[currency]} left out.</li>}
        {preview.splits > 0 && <li>{plural(preview.splits, "stock split")} applied to the trades before {preview.splits === 1 ? "it" : "them"}.</li>}
        {preview.duplicates > 0 && <li>{plural(preview.duplicates, "trade or payment was", "trades and payments were")} imported before and won&apos;t be added again.</li>}
        {preview.otherCash > 0 && <li>Left out: {plural(preview.otherCash, "card payment, deposit, withdrawal or transfer", "card payments, deposits, withdrawals and transfers")}, which aren&apos;t returns.</li>}
      </ul>
      {preview.blocked && <p className="ai-analysis-error" role="alert">{preview.blocked}</p>}
      {currency !== preview.portfolioCurrency && (
        <label className="settings-toggle">
          <input type="checkbox" checked={switchCurrency} onChange={(event) => onSwitchCurrency(event.target.checked)} />
          <span>
            <strong>Show the portfolio in {CURRENCY_NAMES[currency]}</strong>
            <small>Like the statement. You can switch back at the top of the page.</small>
          </span>
        </label>
      )}
      <div className="settings-actions">
        <button type="button" className="settings-button" onClick={onConfirm} disabled={nothingNew || Boolean(preview.blocked)}>
          {nothingNew ? "Nothing new to import" : payments > 0 ? `Import ${plural(preview.newTrades, "trade")} and ${plural(payments, "payment")}` : `Import ${plural(preview.newTrades, "trade")}`}
        </button>
        <button type="button" className="settings-button settings-button-quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
