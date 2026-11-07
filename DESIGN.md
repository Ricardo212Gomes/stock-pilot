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
- Page title (`h1`): 26px / 32px, bold; 20.8px / 28px on phones. Home hero: 36px / 44px (26px on phones). One `h1` per page: on company tabs it is the company header, and section titles below it are `h2` in the same style.
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

- Persistent sidebar (Workspace › Home, Stocks, Compare, Favorites; Markets › Maps, News, Earnings, Dividends; Stocks stays active on the valuation pages), collapsing to an icon rail on narrow screens. The active item gets a `muted` fill and a 2px `primary` left rule.
- Earnings calendar: a toolbar card (round previous/today/next buttons, the week range, a Large/All switch and a search field), then a bordered week grid with one column per weekday; today's date sits in a filled `primary` circle. Report-time sections have `muted` headers with an `accent` icon. Companies are 44px white logo tiles with the ticker beneath, a `positive` or `negative` dot when they've beaten or missed, and a dashed "+N" tile. Selecting a tile opens a centred dialog.
- Dividend calendar: the same toolbar with an Ex-dividend date / Payment date switch, then a bordered Monday-to-Friday month grid; days outside the month take a `muted` fill. Tiles show the logo, ticker and the amount in `positive`, and open the same dialog. Under 900px it becomes a list of the days with dividends.
- Financials: the first sub-tab, Financials, is charts only, in a grid with the first chart (and a lone last chart) spanning both columns, stacking under 1000px. Statement sub-tabs and the Annual/Quarterly switch use `selected` blocks. The statement title is 26px bold. The chart sits in a bordered card with a centred legend; clicking a legend item toggles its series, and hidden series turn `muted-foreground`. The statement table has a sticky label column, right-aligned tabular numbers, bold totals, smaller indented growth rows coloured `positive` or `negative`, and uppercase section rows on a `muted` fill.
- Company tabs (Overview, Financials, News, Transcripts, Filings, Valuation) sit under the company header with a 2px `title-rule` underline; the active tab is a `selected` block. The overview header shows the name at 26px, the price at 36px bold with a 24px signed change, and the quote time in `muted-foreground`. Its stat tables use 15px rows with `border-strong` rules, labels in regular weight and values in semibold, right-aligned; terms with a hover explanation get a dotted underline.
- Filings: type filters in the statement tab style, then a table with the date, a small `secondary` form badge (filled `primary` for earnings releases), the description with the period in `muted-foreground` beneath, and `accent` text links.
- Transcripts: fiscal-quarter tabs in the statement tab style (quarters known to be missing are struck through in `muted-foreground`), a bordered participants card in a grid, then one turn per speaker with the name in semibold, the title in `muted-foreground`, 16px / 27px text in a column up to 820px, and `border` rules between turns. The operator's lines are muted. A `title-rule` divider starts the Q&A. The AI summary sits above the participants in the AI review card (accent left rule), with a tone pill on the right and three bulleted columns (Highlights, Outlook, What analysts asked); before it's made, a muted box holds the Summarize with AI button. Strong sentiment shows as a small `positive` or `negative` pill.
- Settings (Notifications): bordered cards with a `title-rule` top border. The Telegram card shows the connected chat with a `positive` dot, or numbered steps with `primary` buttons; the What to send card lists checkboxes (accent `primary`) with a bold label and a muted description. Each card shows its own result: `positive` text, or the error style.
- Compare: the pill search with an Add button, then the compared tickers as 32px pills (ticker in `accent` semibold, a round 24px × in `muted-foreground` that turns into a `selected` circle on hover), above one bordered table with a column per stock and a Typical column. Each stock header is right-aligned to the same edge as its figures: a 32px logo tile and the ticker in `accent` (linking to the overview), then the name, price and market cap, and the estimate years in 13px `muted-foreground`. Header cells align to the bottom, so Metric and Typical sit beside each stock's last line. Uppercase section rows sit on a `muted` fill, the sticky label column keeps metric names (dotted underline, explained on hover) in view while the stock columns scroll on phones, and growth is signed in `positive` or `negative`. The best value in each row is bold with a 2px underline, and the Typical column is 14px `muted-foreground`.
- Favorites: an outlined "Add to favorites" button beside the company name, with a star that fills in `chart-3` when saved. The Favorites page is a table with logo, ticker in `accent` and name, price, signed change, market cap, tool links and a compact star to remove; phones keep only the company, price, change and star. Notices that aren't errors use `.empty-state-info`, with an `accent` rule instead of `destructive`.
- Home page: a hero (section label, 36px headline, lede in `muted-foreground`, a wide search and pill chips for popular tickers and, when signed in, favorites), then three card grids (Every company, Valuation, Markets). Cards have a `title-rule` top border, a bold title, a muted description and an `accent` link line, and turn `highlight` on hover; the grid fits as many 210px columns as there's room for.
- Stocks without a ticker: a "Stocks" heading under a "Leaderboards" label, leaderboard tabs (Largest companies, Top gainers, Top losers, Most active) in the statement tab style, and a table with a muted rank, the ticker in `accent` beside the name, and signed changes in `positive` or `negative`; phones keep the rank, ticker and figures.
- Top bar label: "TICKER · Section" on company pages and tools, the section name elsewhere.
- Compact top bar with the pill search (company or ticker; suggestions open in a card under it with the ticker in `accent` and the name, the highlighted row on `highlight`, spanning the top bar on phones), a keyboard hint, a theme toggle and, when Google sign-in is configured, a Sign in button in the theme toggle style (icon only on phones) or a 40px round avatar that opens a small card with the name, email and Sign out. The bottom of the sidebar holds a Collapse button that shrinks it to a 64px icon rail on wide screens (remembered in the browser); phones always show the rail.
- Financial tables: sticky left label column on a `muted` fill, numbers right-aligned in tabular numerals, `border-strong` rules between rows, and a `highlight` fill on row hover. No zebra striping on statements.
- Price history: area chart drawn in `positive` when the period is up and `negative` when down, with a signed change and percentage beside the latest close. Period buttons (1M, 6M, 1Y, 5Y) and chart view switches use the tab treatment: `accent` text, `selected` block when active.
- Fundamental charts sit in bordered cards with no shadow; series use `chart-1` onward. Missing values stay blank, never zero.
- News: category tabs (Markets, Mergers & acquisitions, Forex, Crypto) use the tab treatment. Items sit in one bordered list with `border` rules between them and no thumbnails. Each shows the source in `foreground` semibold and the UTC time in `muted-foreground`, a bold headline that turns `accent` on hover, a plain-text summary, and ticker chips in `secondary`.
- Market maps: S&P 500, Nasdaq 100 and Crypto tabs use the statement tab style above the plan notice; the third-party embed sits in a bordered panel; the live dot uses `positive`, plan notices use an `accent` left rule.
- AI actions carry the spark icon. On the Income Statement, Balance Sheet, Cash Flow and Ratios tabs, a plain 22px spark glyph in `accent` sits in front of the title, with no border; it gets a `selected` block on hover and while its review is open. The review opens under the title in a card with an `accent` left rule, a short "AI review · Annual" header, plain paragraphs and a muted disclaimer.
- Valuation tools (Intrinsic Value, Jeremy's Projection, Plumas Projection, DCF Calculator) are a company's Valuation tab: the company header and tabs, then the four tools as sub-tabs in the statement tab style, a 15px `muted-foreground` line on what the open tool does, and the tool. The DCF calculator's terminal value method is a two-option switch in the chart view switch style. Its summary adds the growth the price implies as a fourth stat, Implied growth; a Reverse DCF section restates it as a 17px sentence with the figures in bold, and a History table lists free cash flow by fiscal year with an indented, muted growth row coloured `positive` or `negative`.
- Both projections open with a Which projection fits card: a 3px `accent` left rule, the verdict on the left (a `primary` Best fit badge, the tool name, a link to it or "This page", the stock type in bold and the reason in `muted-foreground`), and on the right one bordered box per projection saying what it's best for; the recommended one gets an `accent` border on a `highlight` fill. It stacks under 900px.
- Jeremy's Projection follows the Plumas sheet's look: the same toolbar card (stock price, market cap, and inputs for the share count and the starting year's revenue and net income), then three stacked case cards, bull (`positive`), base (`chart-1`) and bear (`negative`), each with a 3px top rule in its colour, its last year's price target and CAGR at the right of the heading, and a table with a Consensus (or Reported) column then four Projected ones. Amounts are full figures (`$50,893,000,000`), percentages whole, CAGR signed from the third column. The Price projections card holds the live price, an Adjust entry price input and Reset at the right of its heading, and a chart with each case's mid-price line, low–high error bars, a dashed price line and a tooltip listing each case's range and CAGR in its colour.
- The Plumas Projection is table-first, with no assumptions panel. A toolbar card with a `title-rule` top border holds today's price and share count (inputs), market cap and P/E, then the Simple/Advanced and 3/5 scenario switches in the chart view switch style, Autofill with AI and Reset. Scenario cards follow, one per scenario, each with a coloured dot, the last year's price target and a signed CAGR range; the selected card takes a ring in its colour. Scenario colours run from the worst case to the best through tokens only: `negative`, `chart-1`, `positive` for three, and `negative`, `chart-3`, `chart-1`, `chart-6`, `positive` for five. The sheet card below takes a 3px top rule in the selected scenario's colour. Its table has Reported and Projected column groups split by a `border-strong` rule, muted reported values, a sticky label column, 84px boxed inputs with a muted `%` or `×` and a fill-across arrow beside each input row, indented muted margin rows, a bold EPS row, muted indented analysts' rows (consensus average, with the range and analyst count as the cell's title) under Revenue and EPS, semibold prices and signed CAGR in `positive` or `negative`. Use analysts' estimates and Copy Base inputs sit at the right of the sheet heading. On phones, the cards sit two to a row and the sheet opens at the last reported year. The All scenarios card shows each scenario's mid price as a line (the selected one thicker, with its low–high range shaded), today's price as a dashed `muted-foreground` line, and a comparison table whose selected column gets a `highlight` fill. AI notes use the accent left rule on a `muted` fill.
- Valuation tools: a sticky assumptions panel on the left (stacked under 1100px) and results on the right. Each input shows its source (From filings, AI suggestion, Your value) and a "What is this?" disclosure. Recommended models get a `title-rule` top border and a `primary` badge, cross-checks an `accent` outline badge. The football field uses `chart-1` bars, a `foreground` base marker and a dashed `negative` price line; the sensitivity table colours values above the price `positive` and below it `negative`.
- Keep copy concise and headings factual. Avoid decorative gradients, illustrations and oversized rounded cards.
- Do not fabricate company logos or details from a ticker; link only to sections backed by fetched data.
- Ship both themes. The top bar toggle stores the choice and adds or removes `.dark` on `<html>`.

## Motion and feel

Interaction follows Apple's fluid interface guidelines; the look above doesn't change.

- One curve, `--ease-out` (`cubic-bezier(0.32, 0.72, 0, 1)`), close to a critically damped spring: fast start, no overshoot. No bounce anywhere, since nothing in the app is flicked or thrown.
- Buttons and `summary` toggles scale to 0.97 on pointer-down (60ms) and ease back over 180ms on release. Full-width rows, such as the scenario table buttons, skip it.
- The top bar is translucent (`background` at 78% with a 20px blur), so content scrolls underneath it. It goes solid under `prefers-reduced-transparency` or `prefers-contrast: more`.
- Search suggestions and the user menu fade and scale in from 0.96 over 180ms, from their top edge (the menu from its top right).
- Calendar dialogs grow out of the tile that opened them and shrink back into it when they close (`useModalDialog` sets the origin). The backdrop fades in with them.
- Large type is tracked in: -0.02em at 36px, -0.01em at 26px. Body text keeps the default.
- Under `prefers-reduced-motion`, press scaling, popover motion and dialog scaling switch off, and dialogs only fade.

## Theme tokens

The canonical values live in `src/app/globals.css` (`:root` and `.dark`), and are mapped to Tailwind colours in its `@theme inline` block (`bg-primary`, `text-positive`, `border-border-strong`, and so on).
