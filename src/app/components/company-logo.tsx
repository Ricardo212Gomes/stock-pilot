"use client";

import { useState } from "react";

// FMP serves company logos at a public URL per ticker; unknown tickers fall back to initials.
export function CompanyLogo({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="earnings-logo earnings-logo-fallback" aria-hidden="true">{symbol.slice(0, 3)}</span>;
  return (
    // A plain img: dozens of small third-party logos don't need the Next.js image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="earnings-logo"
      src={`https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
