"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { loadStockIndex, type StockIndex } from "../components/ticker-search";
import type { Currency } from "@/lib/fx";
import { searchStocks } from "@/lib/stock-search";
import { addTradeAction } from "./actions";

const SIDES = [
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
] as const;

// Records a buy or a sale. The ticker field suggests companies from the bundled stock list (the search box's),
// and an empty price is filled with that day's close on the server, converted when the trade is in euros.
export function TradeForm({ today, defaultCurrency = "USD" }: { today: string; defaultCurrency?: Currency }) {
  const id = useId();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [symbol, setSymbol] = useState("");
  const [date, setDate] = useState(today);
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [index, setIndex] = useState<StockIndex | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const suggestions = useMemo(() => (index && symbol.trim() ? searchStocks(index, symbol) : []), [index, symbol]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    startTransition(async () => {
      try {
        const result = await addTradeAction({ side, symbol, date, shares, price, currency });
        if (!result.ok) {
          setStatus({ ok: false, text: result.error });
          return;
        }
        setStatus({ ok: true, text: result.message });
        // The side and date often repeat for the next trade; the rest doesn't.
        setSymbol("");
        setShares("");
        setPrice("");
      } catch {
        setStatus({ ok: false, text: "That didn't work. Please try again." });
      }
    });
  }

  return (
    <form className="portfolio-form" onSubmit={onSubmit} aria-label="Add a trade">
      <div className="portfolio-field">
        <span id={`${id}-side`}>Trade</span>
        <div className="chart-view-switch" role="group" aria-labelledby={`${id}-side`}>
          {SIDES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={side === option.id ? "chart-view-active" : ""}
              aria-pressed={side === option.id}
              onClick={() => setSide(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <label className="portfolio-field">
        <span>Ticker</span>
        <input
          value={symbol}
          onChange={(event) => setSymbol(event.target.value)}
          onFocus={() => {
            if (!index) loadStockIndex().then(setIndex, () => setIndex([]));
          }}
          list={`${id}-tickers`}
          placeholder="AAPL"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
        <datalist id={`${id}-tickers`}>
          {suggestions.map((match) => (
            <option key={match.symbol} value={match.symbol} label={match.name} />
          ))}
        </datalist>
      </label>
      <label className="portfolio-field">
        <span>Date</span>
        <input type="date" value={date} min="1980-01-01" max={today} onChange={(event) => setDate(event.target.value)} required />
      </label>
      <label className="portfolio-field">
        <span>Shares</span>
        <input type="number" inputMode="decimal" min="0" step="any" value={shares} onChange={(event) => setShares(event.target.value)} placeholder="10" required />
      </label>
      <div className="portfolio-field">
        <label htmlFor={`${id}-price`}>Price per share</label>
        <div className="portfolio-price">
          <input id={`${id}-price`} type="number" inputMode="decimal" min="0" step="any" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="That day's close" />
          <select aria-label="Currency" value={currency} onChange={(event) => setCurrency(event.target.value === "EUR" ? "EUR" : "USD")}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
      </div>
      <button type="submit" className="settings-button portfolio-submit" disabled={pending}>
        {pending ? "Adding…" : side === "buy" ? "Add buy" : "Add sale"}
      </button>
      {status && (
        <p className={status.ok ? "settings-status portfolio-form-status" : "ai-analysis-error portfolio-form-status"} role={status.ok ? "status" : "alert"}>
          {status.text}
        </p>
      )}
    </form>
  );
}
