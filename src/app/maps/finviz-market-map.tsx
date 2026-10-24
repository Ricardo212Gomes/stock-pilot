"use client";

import { useEffect, useState } from "react";

type MapTheme = "light" | "dark";

// FINVIZ map types: "sec" is the S&P 500 and "sec_ndx" the Nasdaq 100.
export function FinvizMarketMap({ mapType, label }: { mapType: string; label: string }) {
  const [theme, setTheme] = useState<MapTheme>("light");

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    };

    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  return (
    <iframe
      className="market-map-frame"
      key={mapType}
      src={`https://finviz.com/widgets/map?t=${mapType}&st=d1&theme=${theme}&wid=99lau70j`}
      title={`FINVIZ ${label} market map, 1-day performance, ${theme} theme`}
      width="100%"
      height="600"
      loading="lazy"
    />
  );
}
