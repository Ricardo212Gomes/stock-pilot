"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { indexStocks, searchStocks, type StockEntry, type StockMatch } from "@/lib/stock-search";

const TICKER_PATTERN = /^[A-Za-z0-9.-]{1,15}$/;

type StockIndex = ReturnType<typeof indexStocks>;
let indexRequest: Promise<StockIndex> | null = null;

// The stock list is a separate ~70 KB chunk, loaded the first time the search box is used.
function loadIndex(): Promise<StockIndex> {
  indexRequest ??= import("@/data/us-stocks.json").then((module) => indexStocks(module.default as StockEntry[]));
  return indexRequest;
}

// Search by company name or ticker. Matching runs in the browser against the bundled US stock
// list, so typing makes no requests. Without JavaScript the form submits what was typed.
export function TickerSearch({
  value = "",
  compact = false,
  action = "/stock",
}: {
  value?: string;
  compact?: boolean;
  action?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(value);
  const [index, setIndex] = useState<StockIndex | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const results: StockMatch[] = useMemo(() => (index ? searchStocks(index, query) : []), [index, query]);

  function prepare() {
    if (!index) loadIndex().then(setIndex, () => setIndex([]));
  }

  function go(symbol: string) {
    setOpen(false);
    setQuery(symbol);
    router.push(`${action}?symbol=${encodeURIComponent(symbol)}`);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    if (active >= 0 && results[active]) return go(results[active].symbol);
    // The best match (an exact ticker always ranks first), else whatever was typed as a ticker.
    if (results[0]) return go(results[0].symbol);
    if (TICKER_PATTERN.test(text)) return go(text.toUpperCase());
    setOpen(true);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActive((current) => (current <= 0 ? results.length - 1 : current - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const inputId = compact ? "ticker-compact" : "ticker-home";
  const typed = query.trim().length > 0 && query.trim().toUpperCase() !== value;
  const showList = open && typed && index !== null;

  return (
    <form className={`ticker-search${compact ? " ticker-search-compact" : ""}`} action={action} method="get" onSubmit={onSubmit} role="search">
      <label className="visually-hidden" htmlFor={inputId}>Search by company name or ticker</label>
      <div className="search-input-wrap">
        <svg className="search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 4.2 4.2" />
        </svg>
        <input
          id={inputId}
          name="symbol"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Company or ticker (e.g. Nvidia)"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => {
            prepare();
            setOpen(true);
          }}
          // Let a click on a suggestion land before the list closes.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          maxLength={60}
          required
        />
        <span className="search-shortcut" aria-hidden="true">↵</span>
        {showList && (
          <ul className="search-suggestions" id={listId} role="listbox" aria-label="Matching companies">
            {results.length === 0 ? (
              <li className="search-suggestion-status" role="presentation">No US stock matches. Try the company&apos;s name or ticker.</li>
            ) : (
              results.map((item, position) => (
                <li
                  key={item.symbol}
                  id={`${listId}-${position}`}
                  role="option"
                  aria-selected={position === active}
                  className={position === active ? "search-suggestion-active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(position)}
                  onClick={() => go(item.symbol)}
                >
                  <strong>{item.symbol}</strong>
                  <span>{item.name}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <button type="submit">
        <span>{compact ? "Search" : "Explore company"}</span>
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M4 10h12M10 4l6 6-6 6" />
        </svg>
      </button>
    </form>
  );
}
