"use client";

/*
TradingView Lightweight Charts™
Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/
*/

import { useEffect, useMemo, useRef, useState } from "react";
import { AreaSeries, ColorType, createChart } from "lightweight-charts";
import type { StockPricePoint } from "@/lib/fmp";

type PricePeriod = "1M" | "6M" | "1Y" | "5Y";

const periods: PricePeriod[] = ["1M", "6M", "1Y", "5Y"];

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
}

function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function rgba(hexColor: string, alpha: number): string {
  const match = /^#([\da-f]{6})$/i.exec(hexColor);
  if (!match) return hexColor;

  const color = Number.parseInt(match[1], 16);
  const red = (color >> 16) & 255;
  const green = (color >> 8) & 255;
  const blue = color & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getRangeStart(latestDate: string, period: PricePeriod): number {
  const date = new Date(`${latestDate}T00:00:00Z`);
  const days = period === "1M" ? 30 : period === "6M" ? 182 : period === "1Y" ? 365 : 1825;
  date.setUTCDate(date.getUTCDate() - days);
  return date.getTime();
}

export function PriceHistoryChart({
  symbol,
  currency,
  prices,
}: {
  symbol: string;
  currency: string;
  prices: StockPricePoint[];
}) {
  const [period, setPeriod] = useState<PricePeriod>("1Y");
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const latestDate = prices[prices.length - 1]?.date ?? "";

  const visiblePrices = useMemo(() => {
    if (!latestDate) return prices;
    const rangeStart = getRangeStart(latestDate, period);
    const filtered = prices.filter(
      (price) => new Date(`${price.date}T00:00:00Z`).getTime() >= rangeStart,
    );
    return filtered.length > 0 ? filtered : prices;
  }, [latestDate, period, prices]);

  const firstPrice = visiblePrices[0];
  const lastPrice = visiblePrices[visiblePrices.length - 1];
  const change = firstPrice && lastPrice ? lastPrice.close - firstPrice.close : 0;
  const changePercent = firstPrice && firstPrice.close !== 0
    ? (change / firstPrice.close) * 100
    : 0;
  const isPositive = change >= 0;

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || visiblePrices.length === 0) return;

    const root = document.documentElement;
    const getThemeColors = () => {
      const styles = getComputedStyle(root);
      return {
        background: styles.getPropertyValue("--card").trim() || "#ffffff",
        text: styles.getPropertyValue("--muted-foreground").trim() || "#4b5563",
        border: styles.getPropertyValue("--border").trim() || "#e5e7eb",
        positive: styles.getPropertyValue("--positive").trim() || "#15803d",
        negative: styles.getPropertyValue("--negative").trim() || "#dc2626",
      };
    };
    const colors = getThemeColors();
    const lineColor = isPositive ? colors.positive : colors.negative;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: 12,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: colors.border },
        horzLines: { color: colors.border },
      },
      rightPriceScale: { borderColor: colors.border },
      timeScale: {
        borderColor: colors.border,
        rightOffset: 2,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      localization: {
        priceFormatter: (price: number) => formatMoney(price, currency),
      },
    });

    const priceSeries = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: rgba(lineColor, 0.2),
      bottomColor: rgba(lineColor, 0.01),
      lineWidth: 2,
      priceLineVisible: false,
    });

    priceSeries.setData(
      visiblePrices.map((price) => ({ time: price.date, value: price.close })),
    );
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }
    });
    resizeObserver.observe(container);

    const themeObserver = new MutationObserver(() => {
      const nextColors = getThemeColors();
      chart.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: nextColors.background },
          textColor: nextColors.text,
        },
        grid: {
          vertLines: { color: nextColors.border },
          horzLines: { color: nextColors.border },
        },
        rightPriceScale: { borderColor: nextColors.border },
        timeScale: { borderColor: nextColors.border },
      });
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      chart.remove();
    };
  }, [currency, isPositive, visiblePrices]);

  if (!firstPrice || !lastPrice) return null;

  return (
    <section className="stock-price-section" aria-labelledby="price-history-title">
      <div className="stock-price-heading">
        <div>
          <p className="section-label">PRICE HISTORY</p>
          <h2 id="price-history-title">Stock price</h2>
          <p className="stock-price-caption">Daily closing price · Up to 5 years</p>
        </div>
        <div className="stock-price-summary">
          <span>Latest close</span>
          <strong>{formatMoney(lastPrice.close, currency)}</strong>
          <small className={isPositive ? "positive-value" : "negative-value"}>
            {formatMoney(change, currency)} ({formatPercent(changePercent)}) · {period}
          </small>
        </div>
      </div>

      <div className="stock-price-toolbar">
        <span className="stock-price-symbol">{symbol}</span>
        <div className="stock-price-periods" role="group" aria-label="Price history range">
          {periods.map((option) => (
            <button
              key={option}
              className={period === option ? "stock-price-period-active" : ""}
              type="button"
              aria-pressed={period === option}
              onClick={() => setPeriod(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={chartContainerRef}
        className="stock-price-chart"
        role="img"
        aria-label={`${symbol} daily closing prices for the last ${period}`}
      />
      <p className="stock-price-footnote">
        Daily end-of-day prices from Financial Modeling Prep. Prices are historical and may be delayed.
      </p>
    </section>
  );
}
