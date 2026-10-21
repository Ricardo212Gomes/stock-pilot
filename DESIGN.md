# StockPilot design system

StockPilot follows a restrained financial-research style based on the supplied Dividend Data references: a warm paper background, crisp typography, compact tables and color reserved for meaningful financial states. The explicit token table is canonical; the separately inferred palette is not applied where it differs from these tokens. The PocketUI scrape supports the use of Geist and restrained green/red financial cues, but its broad color list also captures embedded widgets and unrelated content, so it does not add tokens to this system.

## Color tokens

| Role | Light | Dark | Use |
|---|---|---|---|
| `background` | `#f5f4ee` | `#1a180f` | Page canvas |
| `foreground` | `#0f0e0c` | `#f8f8f6` | Default text |
| `card` | `#ffffff` | `#232115` | Raised panels and cards |
| `card-foreground` | `#0f0e0c` | `#f8f8f6` | Text on cards |
| `primary` | `#0f0e0c` | `#ccc7bf` | Primary actions and selected states |
| `primary-foreground` | `#ffffff` | `#111111` | Text on primary |
| `secondary` | `#ffffff` | `#33301f` | Secondary controls |
| `secondary-foreground` | `#0f0e0c` | `#f8f8f6` | Text on secondary |
| `muted` | `#eceae2` | `#33301f` | Subtle fills and table stripes |
| `muted-foreground` | `#3c3a35` | `#b0ad9b` | Captions and supporting text |
| `accent` | `#047857` | `#047857` | Positive movement, links and highlights |
| `accent-foreground` | `#ffffff` | `#ffffff` | Text on accent |
| `destructive` | `#dc2626` | `#dc2626` | Negative movement and errors |
| `border` | `#d4d0c8` | `#393622` | Borders and dividers |
| `input` | `#d4d0c8` | `#393622` | Form control borders |
| `ring` | `#0f0e0c` | `#ccc7bf` | Focus indicators |

Use colors through their role variables. Do not add one-off colors or opacity variants.

## Type, shape and spacing

- Body font: `Geist, "Geist Fallback"`.
- Font sizes: `8.5px`, `9.5px`, `10px`, `10.5px`, `11px`, `11.5px`, `12px`, `13px`, `16px`, `44px`.
- Font weights: `400`, `500`, `600`, `700`.
- Line heights: `19.5px`, `18px`, `16.5px`, `12.75px`, `15px`.
- Corner radii: default `3px`; use `2px`, `3px`, `4px`, `6px` or `9999px` for pills.
- Spacing scale: `4px`, `8px`, `12px`, `16px`, `20px`, `28px`, `32px`, `112px`.
- Shadows: use only the three recipes below. The first is a fine border-like lift, the second a subtle control shadow, and the third a prominent panel shadow.

| Token | Recipe |
|---|---|
| Border lift | `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0 0 0 / 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0) 0px 0px 0px 0px` |
| Subtle | `rgba(15, 23, 42, 0.04) 0px 1px 2px 0px, rgba(15, 23, 42, 0.06) 0px 1px 3px 0px` |
| Panel | `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.02) 0px 1px 0px 0px, rgba(15, 14, 12, 0.04) 0px 2px 4px 0px, rgba(15, 14, 12, 0.06) 0px 8px 16px -8px` |

## Components and behavior

- Use a persistent sidebar for Company research. It is the only active tool today; the sidebar may grow as more features are built. On narrow screens, keep a compact icon rail visible.
- Keep the top bar compact, with ticker search, a visible keyboard hint and a theme toggle. Also provide the theme toggle at the bottom of the sidebar; both controls stay synchronized.
- Place an AI analysis action alongside a concise, clearly separated generated report on the company fundamentals page. Show loading and configuration/provider errors inline, and keep the report grounded in the supplied metrics.
- Use editorial headings and concise copy. Avoid decorative gradients, large illustrations and oversized rounded cards.
- Keep financial summaries compact. Align numeric columns to the right, use tabular numerals, mute table labels and separate rows with thin borders or muted stripes.
- Use the accent token for positive values and the destructive token for negative values. Include a signed number or text label so color is never the only signal.
- Use square, factual issuer identifiers when company identity data is available. Do not fabricate a logo or issuer details from a ticker.
- The current StockPilot data view covers annual fundamentals. Navigation should link only to sections backed by available data; do not imply that quote, dividend or valuation data is present until it is fetched.
- Ship both themes. Either theme toggle stores the selection and applies or removes `.dark` on the document `<html>` element.

The PocketUI extraction is useful as a cross-check for the overall visual direction, not as a source of additional one-off colors. Use the canonical token table above for the sidebar, header and all data views.

## Theme tokens

```css
:root {
  --background: #f5f4ee;
  --foreground: #0f0e0c;
  --card: #ffffff;
  --card-foreground: #0f0e0c;
  --primary: #0f0e0c;
  --primary-foreground: #ffffff;
  --secondary: #ffffff;
  --secondary-foreground: #0f0e0c;
  --muted: #eceae2;
  --muted-foreground: #3c3a35;
  --accent: #047857;
  --accent-foreground: #ffffff;
  --destructive: #dc2626;
  --border: #d4d0c8;
  --input: #d4d0c8;
  --ring: #0f0e0c;
  --radius: 3px;
  --font-sans: Geist, "Geist Fallback";
}

.dark {
  --background: #1a180f;
  --foreground: #f8f8f6;
  --card: #232115;
  --card-foreground: #f8f8f6;
  --primary: #ccc7bf;
  --primary-foreground: #111111;
  --secondary: #33301f;
  --secondary-foreground: #f8f8f6;
  --muted: #33301f;
  --muted-foreground: #b0ad9b;
  --accent: #047857;
  --accent-foreground: #ffffff;
  --destructive: #dc2626;
  --border: #393622;
  --input: #393622;
  --ring: #ccc7bf;
}
```
