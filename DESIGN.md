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
- Body: 16px / 24px, weight 400. Descriptions and supporting copy: 15px; nothing a reader needs is below 13px.
- Content column: up to 1200px wide, as on StockAnalysis.
- Page title (`h1`): 26px / 32px, bold; 20.8px / 28px on phones. Landing hero: 36px / 40px.
- Section headings (`h2`): 20px / 24px, bold.
- Large figures: latest close 36px / 40px bold; metric cards 20px semibold. Always tabular numerals.
- Chart titles: 17px / 24px bold; axis ticks 12px and legends and tooltips 13px, in `muted-foreground`.
- Table cells: 15.2px / 24px (14px on phones). Table headers: 14.4px / 20.8px, semibold, in `foreground` (not muted).
- Nav items and controls: 15px / 21px, semibold.
- Small labels, badges and footnotes: 13–14px. Line heights stay at least 1.4× the font size.

## Shape and spacing

- Radius: `--radius` 6px for buttons, cards and sidebar items; the search field is a 24px pill with a fully round button; tables are square.
- Buttons: 6px 10px padding, 16px semibold, `0 1px 2px rgba(0,0,0,0.05)` shadow.
- Tabs: 8px 16px blocks in `accent` text; hover or selected turns into a `selected` block with semibold text. No underline.
- Spacing steps: 4, 6, 8, 10, 16, 24, 32px. Table cells pad 5px 10px; header cells 7px 10px.
- Shadows: only `--shadow-subtle` (`0 1px 2px 0 rgba(0,0,0,0.05)`). Panels rely on borders.

## Components and behavior

- Persistent sidebar (Workspace › Company research; Valuation › Intrinsic value, 3-Year Projection, DCF Calculator; Markets › Maps, News, Earnings, Dividends), collapsing to an icon rail on narrow screens. The active item gets a `muted` fill and a 2px `primary` left rule.
- Earnings calendar: a toolbar card (round previous/today/next buttons, the week range, a Large/All switch and a search field), then a bordered week grid with one column per weekday; today's date sits in a filled `primary` circle. Report-time sections have `muted` headers with an `accent` icon. Companies are 44px white logo tiles with the ticker beneath, a `positive` or `negative` dot when they've beaten or missed, and a dashed "+N" tile. Selecting a tile opens a centred dialog.
- Dividend calendar: the same toolbar with an Ex-dividend date / Payment date switch, then a bordered Monday-to-Friday month grid; days outside the month take a `muted` fill. Tiles show the logo, ticker and the amount in `positive`, and open the same dialog. Under 900px it becomes a list of the days with dividends.
- Financials: the first sub-tab, Financials, is charts only, in a grid with the first chart (and a lone last chart) spanning both columns, stacking under 1000px. Statement sub-tabs and the Annual/Quarterly switch use `selected` blocks. The statement title is 26px bold. The chart sits in a bordered card with a centred legend; clicking a legend item toggles its series, and hidden series turn `muted-foreground`. The statement table has a sticky label column, right-aligned tabular numbers, bold totals, smaller indented growth rows coloured `positive` or `negative`, and uppercase section rows on a `muted` fill.
- Company tabs (Overview, Financials, News) sit under the company header with a 2px `title-rule` underline; the active tab is a `selected` block. The overview header shows the name at 26px, the price at 36px bold with a 24px signed change, and the quote time in `muted-foreground`. Its stat tables use 15px rows with `border-strong` rules, labels in regular weight and values in semibold, right-aligned; terms with a hover explanation get a dotted underline.
- Compact top bar with the pill ticker search, a keyboard hint and a theme toggle. A synced toggle sits at the bottom of the sidebar.
- Financial tables: sticky left label column on a `muted` fill, numbers right-aligned in tabular numerals, `border-strong` rules between rows, and a `highlight` fill on row hover. No zebra striping on statements.
- Price history: area chart drawn in `positive` when the period is up and `negative` when down, with a signed change and percentage beside the latest close. Period buttons (1M, 6M, 1Y, 5Y) and chart view switches use the tab treatment: `accent` text, `selected` block when active.
- Fundamental charts sit in bordered cards with no shadow; series use `chart-1` onward. Missing values stay blank, never zero.
- News: category tabs (Markets, Mergers & acquisitions, Forex, Crypto) use the tab treatment. Items sit in one bordered list with `border` rules between them and no thumbnails. Each shows the source in `foreground` semibold and the UTC time in `muted-foreground`, a bold headline that turns `accent` on hover, a plain-text summary, and ticker chips in `secondary`.
- Market maps: S&P 500, Nasdaq 100 and Crypto tabs use the statement tab style above the plan notice; the third-party embed sits in a bordered panel; the live dot uses `positive`, plan notices use an `accent` left rule.
- AI actions carry the spark icon. On the Income Statement, Balance Sheet, Cash Flow and Ratios tabs, a plain 22px spark glyph in `accent` sits in front of the title, with no border; it gets a `selected` block on hover and while its review is open. The review opens under the title in a card with an `accent` left rule, a short "AI review · Annual" header, plain paragraphs and a muted disclaimer.
- Valuation tools (Intrinsic value, 3-Year Projection, DCF Calculator) are separate pages under a breadcrumb and a heading with the tool name as the section label and the ticker as the title. The DCF calculator's terminal value method is a two-option switch in the chart view switch style. The 3-year calculator shares the assumptions panel, with a wrapping switch for the five scenarios above their inputs. Its results are a scenario table (the selected row gets a `highlight` fill), a year-by-year table with muted, indented growth rows and bold share prices, and a history table with an average row.
- Valuation tools: a sticky assumptions panel on the left (stacked under 1100px) and results on the right. Each input shows its source (From filings, AI suggestion, Your value) and a "What is this?" disclosure. Recommended models get a `title-rule` top border and a `primary` badge, cross-checks an `accent` outline badge. The football field uses `chart-1` bars, a `foreground` base marker and a dashed `negative` price line; the sensitivity table colours values above the price `positive` and below it `negative`.
- Keep copy concise and headings factual. Avoid decorative gradients, illustrations and oversized rounded cards.
- Do not fabricate company logos or details from a ticker; link only to sections backed by fetched data.
- Ship both themes. Either toggle stores the choice and adds or removes `.dark` on `<html>`.

## Theme tokens

The canonical values live in `src/app/globals.css` (`:root` and `.dark`), and are mapped to Tailwind colours in its `@theme inline` block (`bg-primary`, `text-positive`, `border-border-strong`, and so on).
