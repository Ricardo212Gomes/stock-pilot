# Market maps

The `/maps` page embeds the FINVIZ S&P 500 heat map, showing one-day performance by sector. It needs no API key and makes no server requests.

## Files

- `src/app/maps/page.tsx`: the page layout, the free-plan notice and the attribution link.
- `src/app/maps/finviz-market-map.tsx`: the client component that renders the iframe.

## How it works

The iframe loads `https://finviz.com/widgets/map?t=sec&st=d1&theme=<light|dark>&wid=99lau70j`:

- `t=sec`: the S&P 500, grouped by sector.
- `st=d1`: one-day performance.
- `wid`: the FINVIZ widget ID for this embed.

The component watches the `dark` class on `<html>` with a `MutationObserver`. When the theme toggle changes it, the iframe reloads with the matching `theme` parameter.

## Limits

- The free FINVIZ embed only supports 1-day maps. Other periods need a FINVIZ Elite plan. The page says so and links to the upgrade.
- The map's data and rendering come from FINVIZ, so StockPilot can't style or inspect it.
- The page must keep the "Market map by FINVIZ" attribution link.
