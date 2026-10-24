# Market maps

The `/maps` page embeds FINVIZ heat maps of the **S&P 500** (`/maps`, the default), the **Nasdaq 100** (`/maps?index=ndx`) and the **largest cryptocurrencies** (`/maps?index=crypto`), showing one-day performance. Tabs switch between them. It needs no API key and makes no server requests.

## Files

- `src/app/maps/page.tsx`: the index tabs, page layout, free-plan notice and attribution link.
- `src/app/maps/finviz-market-map.tsx`: the client component that renders the iframe for a given map type.

## How it works

The iframe loads `https://finviz.com/widgets/map?t=<map type>&st=d1&theme=<light|dark>&wid=99lau70j`:

- `t`: the map type, `sec` for the S&P 500, `sec_ndx` for the Nasdaq 100 and `crypto` for cryptocurrencies priced in US dollars (sized by market cap: price × circulating supply). FINVIZ's own code also defines `crypto_usdt`, `crypto_eur`, `crypto_btc`, `sec_dji` (Dow Jones), `sec_rut` (Russell 2000), `sec_comp` (Nasdaq Composite), `sec_all` (all stocks), `geo` (world) and `etf`, so more tabs only need a new entry in `INDEXES` in `page.tsx`.
- `st=d1`: one-day performance.
- `wid`: the FINVIZ widget ID for this embed.

The component watches the `dark` class on `<html>` with a `MutationObserver`. When the theme toggle changes it, the iframe reloads with the matching `theme` parameter.

## Limits

- The free FINVIZ embed only supports 1-day maps. Other periods need a FINVIZ Elite plan. The page says so and links to the upgrade.
- The map's data and rendering come from FINVIZ, so StockPilot can't style or inspect it.
- The page must keep the "Market map by FINVIZ" attribution link.
