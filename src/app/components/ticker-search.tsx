export function TickerSearch({
  value = "",
  compact = false,
}: {
  value?: string;
  compact?: boolean;
}) {
  return (
    <form
      className={`ticker-search${compact ? " ticker-search-compact" : ""}`}
      action="/stock"
      method="get"
    >
      <label className="visually-hidden" htmlFor={compact ? "ticker-compact" : "ticker-home"}>
        Stock ticker symbol
      </label>
      <div className="search-input-wrap">
        <svg className="search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 4.2 4.2" />
        </svg>
        <input
          id={compact ? "ticker-compact" : "ticker-home"}
          aria-label="Stock ticker symbol"
          name="symbol"
          type="text"
          placeholder="Search ticker (e.g. AAPL)"
          defaultValue={value}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={15}
          pattern="[A-Za-z0-9.-]{1,15}"
          title="Use a ticker with letters, numbers, dots or hyphens."
          required
        />
        <span className="search-shortcut" aria-hidden="true">↵</span>
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
