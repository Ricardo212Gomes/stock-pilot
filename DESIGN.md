# StockPilot design system

StockPilot uses a plain, data-first financial-research style modelled on StockAnalysis.com. The page is white (or neutral charcoal in dark mode), the type is the system UI stack, tables are dense with crisp grey rules, links and tabs are blue, and colour is otherwise reserved for gains and losses. The values below were read from StockAnalysis.com's live CSS in October 2026. Only the visual language is borrowed: StockPilot uses its own name, mark and copy, and never their logo, wordmark or icons.

## Color tokens

| Role | Light | Dark | Use |
|---|---|---|---|
| `background` | `#ffffff` | `#262626` | Page canvas |
| `foreground` | `#111827` | `#f5f5f5` | Default text |
| `card` | `#ffffff` | `#262626` | Panels and cards (separated by borders, not fills) |
| `card-foreground` | `#111827` | `#f5f5f5` | Text on cards |
| `primary` | `#2c6288` | `#2c6288` | Primary buttons, brand mark, active sidebar rule |
| `primary-foreground` | `#ffffff` | `#ffffff` | Text on primary (6.5:1) |
| `secondary` | `#f3f4f6` | `#404040` | Secondary controls, toggles |
| `secondary-foreground` | `#1f2937` | `#f5f5f5` | Text on secondary |
| `muted` | `#f6f7f8` | `#313131` | Table header and sticky label column, subtle fills |
| `muted-foreground` | `#4b5563` | `#a3a3a3` | Captions, labels, nav items |
| `accent` | `#1e73ba` | `#8bb4f7` | Links, unselected tabs, dots and small highlights |
| `accent-foreground` | `#ffffff` | `#111827` | Text on accent |
| `positive` | `#15803d` | `#71c996` | Gains and positive growth |
| `negative` | `#dc2626` | `#e28b81` | Losses and negative growth |
| `destructive` | `#dc2626` | `#e28b81` | Errors |
| `border` | `#e5e7eb` | `#3d3d3d` | Card borders and dividers |
| `border-strong` | `#d1d5db` | `#525252` | Table rules, control borders |
| `input` | `#d1d5db` | `#525252` | Form control borders |
| `input-background` | `#f9fafb` | `#404040` | Search field fill |
| `ring` | `#2c6288` | `#8bb4f7` | Focus outline |
| `highlight` | `#f2f9ff` | `#404040` | Table row hover |
| `selected` | `#eeeeee` | `#dfdfdf` | Hovered or selected tab block |
| `selected-foreground` | `#111827` | `#242b39` | Text on `selected` |
| `title-rule` | `#2c6288` | `#6b7280` | 2px top rule on featured panels and cards |
| `chart-1` … `chart-6` | `#2c6288` `#15803d` `#c17a18` `#d04b56` `#7653c7` `#168caa` | `#8bb4f7` `#71c996` `#f0b44d` `#ff7f87` `#b49aff` `#5bc7e2` | Chart series, in order; `chart-1` leads with the brand blue |

Use colours through their role variables; do not add one-off colours. Gains and losses always carry a sign (`+6.4%`, `-2.8%`), so colour is never the only signal.

Known contrast exceptions, kept from the source: in dark mode, the search placeholder (`#a3a3a3` on `#404040`, 4.1:1) and negative values on a hovered row (`#e28b81` on `#404040`, 4.1:1) fall just under 4.5:1. If you need strict AA, change the dark `highlight` to `#313131`.

## Type

- Family: `ui-sans-serif, system-ui, sans-serif` plus the emoji fallbacks. No web font for text; Geist Mono stays available as `--font-mono`.
- Body: 16px / 24px, weight 400.
- Page title (`h1`): 26px / 32px, bold; 20.8px / 28px on phones. Landing hero: 36px / 40px.
- Section headings (`h2`): 20px / 24px, bold.
- Large figures: latest close 36px / 40px bold; metric cards 20px semibold. Always tabular numerals.
- Chart titles: 16px / 24px bold; axis ticks and legends 10–12px in `muted-foreground`.
- Table cells: 15.2px / 24px (14px on phones). Table headers: 14.4px / 20.8px, semibold, in `foreground` (not muted).
- Nav items and controls: 14px / 20px, semibold.
- Small labels and footnotes: 12–13px.

## Shape and spacing

- Radius: `--radius` 6px for buttons, cards and sidebar items; the search field is a 24px pill with a fully round button; tables are square.
- Buttons: 6px 10px padding, 16px semibold, `0 1px 2px rgba(0,0,0,0.05)` shadow.
- Tabs: 8px 16px blocks in `accent` text; hover or selected turns into a `selected` block with semibold text. No underline.
- Spacing steps: 4, 6, 8, 10, 16, 24, 32px. Table cells pad 5px 10px; header cells 7px 10px.
- Shadows: only `--shadow-subtle` (`0 1px 2px 0 rgba(0,0,0,0.05)`). Panels rely on borders.

## Components and behavior

- Persistent sidebar (Company research, Projections, Markets › Maps), collapsing to an icon rail on narrow screens. The active item gets a `muted` fill and a 2px `primary` left rule.
- Compact top bar with the pill ticker search, a keyboard hint and a theme toggle. A synced toggle sits at the bottom of the sidebar.
- Financial tables: sticky left label column on a `muted` fill, numbers right-aligned in tabular numerals, `border-strong` rules between rows, and a `highlight` fill on row hover. No zebra striping on statements.
- Price history: area chart drawn in `positive` when the period is up and `negative` when down, with a signed change and percentage beside the latest close. Period buttons (1M, 6M, 1Y, 5Y) and chart view switches use the tab treatment: `accent` text, `selected` block when active.
- Fundamental charts sit in bordered cards with no shadow; series use `chart-1` onward. Missing values stay blank, never zero.
- Market maps: the third-party embed sits in a bordered panel; the live dot uses `positive`, plan notices use an `accent` left rule.
- The AI analysis panel sits beside the fundamentals with a `title-rule` top border; loading and errors show inline.
- Projections: a sticky assumptions panel on the left (stacked under 1100px) and results on the right. Each input shows its source (From filings, AI suggestion, Your value) and a "What is this?" disclosure. Recommended models get a `title-rule` top border and a `primary` badge, cross-checks an `accent` outline badge. The football field uses `chart-1` bars, a `foreground` base marker and a dashed `negative` price line; the sensitivity table colours values above the price `positive` and below it `negative`.
- Keep copy concise and headings factual. Avoid decorative gradients, illustrations and oversized rounded cards.
- Do not fabricate company logos or details from a ticker; link only to sections backed by fetched data.
- Ship both themes. Either toggle stores the choice and adds or removes `.dark` on `<html>`.

## Theme tokens

The canonical values live in `src/app/globals.css` (`:root` and `.dark`), and are mapped to Tailwind colours in its `@theme inline` block (`bg-primary`, `text-positive`, `border-border-strong`, and so on).
