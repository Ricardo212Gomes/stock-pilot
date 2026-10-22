"use client";

import { useEffect, useState } from "react";

type MapTheme = "light" | "dark";

export function FinvizMarketMap() {
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
      src={`https://finviz.com/widgets/map?t=sec&st=d1&theme=${theme}&wid=99lau70j`}
      title={`FINVIZ S&P 500 market map, 1-day performance, ${theme} theme`}
      width="100%"
      height="600"
      loading="lazy"
    />
  );
}
