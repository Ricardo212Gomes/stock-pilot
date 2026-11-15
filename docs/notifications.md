# Notifications

Signed-in users get four kinds of notifications about their [favorites](./favorites.md), and a weekly one about their portfolio. Each one is kept in StockPilot, where the **bell** in the top bar and the **Notifications** page show it, and is also sent to **Telegram** when the user has a chat linked and "Also send to Telegram" on. Telegram is optional: with only the database set up, notifications still come to the bell.

- **Upcoming earnings** (`npm run notify:earnings`): which favorites report in the next 7 days, with the day, the time (before the open, after the close…) and the EPS and revenue estimates, from Finnhub's free earnings calendar. One message per user, sent only when at least one favorite reports.
- **Earnings call summaries** (`npm run notify:transcripts`): when a favorite reported in the last 21 days and Alpha Vantage has the call's transcript, the AI summary from the Transcripts tab (overview, highlights, outlook, analysts' questions and tone). Each call is sent once per user (`notification_log`); a call that isn't transcribed yet is tried again on the next run.

- **Relevant news** (`npm run notify:news`): one digest of the last 26 hours' headlines about the user's favorites (up to 6 per company, newest first, from Finnhub). Gemini picks at most 6 that matter to a shareholder (results, guidance, deals, regulation, lawsuits, management changes, major products or customers, large analyst moves), skipping roundups, "stocks to buy" lists and passing mentions, and adds a one-line reason for each. If Gemini fails twice, the two newest headlines per company are sent instead, labelled as such. Each article is sent once (`notification_log`), and nothing is sent when nothing qualifies.
- **SEC filing analysis** (`npm run notify:filings`): each new 10-K, 10-Q (or 20-F, 40-F) and significant 8-K (items such as 1.01 agreements, 2.02 results, 2.03 debt, 5.02 executive changes, 7.01 and 8.01 announcements; not vote results or exhibit-only filings) from the last 3 days, at most 3 per company per run. The document is read from sec.gov as plain text (for a 10-K or 10-Q, from Management's Discussion and Analysis; for an earnings 8-K, its press release) and Gemini writes a headline, summary, key points with figures, what to watch and whether it's positive, neutral or negative for shareholders. The analysis is saved in `filing_analyses`, so a filing is analyzed once however many users follow the company, and each filing is sent once per user.

- **Weekly AI reviews of your portfolio** (`npm run notify:reviews`): on Sundays, the latest TradingAgents rating of each of the user's holdings from the Portfolio's AI reviews (see [`portfolio-reviews.md`](./portfolio-reviews.md)): first the ratings that changed this week (Hold → Underweight), then every reviewed holding grouped as Underweight or Sell, Hold, and Overweight or Buy, with the target and the review's date, and the plan's first sentence for the Underweight and Sell ones. Each ticker links to its report when `APP_URL` is set. It's plain code over the stored reviews, with no AI request of its own. Sent once a week (`notification_log`, item: the week's Monday), only to users whose reviews are on, and not at all before the first review.

The four about favorites are on by default for everyone with favorites, Telegram or not; the weekly reviews are off until the user turns them on. Each has its switch in **Notifications › Settings** (`/notifications?tab=settings`, also in the account menu).

## The bell

A bell sits in the top bar between the theme toggle and the account menu, for signed-in users with a database (`src/app/components/notification-bell.tsx`). A badge shows how many are unread, as "9+" above nine. The count comes with each page from the server; opening the bell asks again (`refreshBellAction`), and nothing polls in between.

The panel lists the latest 10, newest first: each kind's icon, the title, the kind and the time ago, unread ones in bold with a dot. A notification opens its page and is marked as read (`notificationHref` in `src/lib/notification-kinds.ts`):

| Kind | Opens |
| --- | --- |
| Upcoming earnings | The earnings calendar |
| Earnings call | The company's Transcripts tab |
| News | The company's News, or Favorites when it covers several companies |
| SEC filing | The company's Filings tab |
| AI reviews | The Portfolio, with its AI reviews |

**Mark all as read** clears the badge; **See all notifications** goes to the page. On phones the panel spans the top bar.

## The Notifications page

`/notifications` has two tabs:

- **History**: every notification kept, newest first, 25 to a page, filtered by kind and by company (`?kind=filings&symbol=NVDA`). Each card shows the title, the kind, the date and time, what happened on Telegram (also sent, failed, not connected, or turned off), whether it's read, **Mark as read**, **Open**, and the full message.
- **Settings**: the five alert switches, and the Telegram card: connecting a chat, a test message, disconnecting, and **Also send to Telegram**. Turning that off keeps the chat linked but sends only to the bell.

`/settings` (**Data sources** in the account menu) keeps the data sources overview and points to the new place for notification settings.

### Showing a message safely

Messages are written in Telegram's HTML: `<b>`, `<i>` and `<a href>` around escaped text. The page never inserts them as HTML. `parseTelegramHtml` (`src/lib/telegram-html.ts`) reads them into a small tree that `NotificationMessage` renders as React elements:
- only bold, italics and links are kept, and anything else stays visible as text;
- links go only to `http(s)` addresses or the app's own paths (never `javascript:`, `data:` or `//host`);
- a link to the app's public address (`APP_URL`) becomes its path, so it opens in place.

## The table

Each delivered notification is a row in `notifications`, with these columns:
- `user_id` and `kind`: `earnings`, `transcripts`, `news`, `filings` or `reviews`;
- `title`: one line for the bell;
- `body`: the message as sent;
- `symbols`: the tickers it's about, for links and the company filter;
- `telegram_status`: `sent`, `failed`, `not-linked` or `off`;
- `created_at` and `read_at`.

`notification_settings.telegram_alerts` is the Also send to Telegram switch.

A notification counts as delivered once it's kept. When Telegram fails, its status says so, and it isn't sent again later, so the bell never gets the same one twice. A dry run keeps nothing. `notification_log` still records what was sent, so nothing goes out twice.

## Removing old notifications

`npm run notifications:prune` (`scripts/prune-notifications.ts`) deletes notifications older than **90 days** (`NOTIFICATION_RETENTION_DAYS`) and `notification_log` rows older than **180 days**. It prints how many it removed; `-- --dry-run` only counts them. `.github/workflows/notifications-prune.yml` runs it every day at 04:00 UTC and needs only `DATABASE_URL`.

The sent log is kept longer on purpose. It's what stops a resend, and each kind only looks back a short while: news 26 hours, filings 3 days, transcripts 21 days, and the weekly summary its own week. 180 days is far beyond any of them, and never shorter than the notifications' own retention.

## Set up the bot

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, and pick a name and a username ending in `bot`.
2. Add its token and username to the environment file:

   ```
   TELEGRAM_BOT_TOKEN=123456789:AA...
   TELEGRAM_BOT_USERNAME=YourStockPilotBot
   ```

3. Run `npm run db:setup` to create the `notification_settings`, `notification_log` and `notifications` tables, and restart the server.

Optionally set `APP_URL` to the app's public address; messages then link each ticker to its page.

## Connect a chat

In **Notifications › Settings**:

1. **Connect Telegram** creates a one-time code (valid 30 minutes) and shows a link to `t.me/<bot>?start=<code>`.
2. In Telegram, press **Start**. Telegram sends the bot `/start <code>`.
3. **I've pressed Start** reads the bot's pending messages (`getUpdates`), finds the code, saves the chat and sends a confirmation there.

Reading pending messages instead of receiving them on a webhook means linking works without the app being on a public address. Don't set a webhook on the bot: Telegram blocks `getUpdates` while one is active.

**Send a test message** checks the connection; **Disconnect** forgets the chat.

## Run the commands

```bash
npm run notify:earnings
npm run notify:transcripts
```

```bash
npm run notify:news
npm run notify:filings
npm run notify:reviews
```

Add `-- --dry-run` (for example `npm run notify:filings -- --dry-run`) to print the messages instead of keeping and sending them; nothing is marked as sent, so a real run still delivers them.

They use the same code as the app (through `tsx`), read the environment file, and print one line per user or ticker: whether the notification was saved and what Telegram did. They need `DATABASE_URL`, `FINNHUB_API_KEY`, and for summaries, news and filings `GEMINI_API_KEY` (plus `ALPHAVANTAGE_API_KEY` for summaries). Without `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`, notifications go to the app only, and the run says so. Long Gemini requests here wait up to 90 seconds and are retried once.

## Schedule them with GitHub Actions

`.github/workflows/notifications.yml` runs them on GitHub's servers, so the app doesn't need to be deployed:

- Mondays at 07:00 UTC: upcoming earnings.
- Every day at 13:00 UTC: new earnings call summaries.
- Weekdays at 21:30 UTC, after the US close: relevant news.
- Every day at 22:30 UTC, after the evening's 8-Ks: filing analyses.
- Sundays at 18:00 UTC: the weekly AI reviews.
- Every day at 04:00 UTC (`notifications-prune.yml`): old notifications removed.
- **Run workflow** (Actions tab) runs either one on demand.

To turn it on:

1. In the repository's **Settings → Secrets and variables → Actions**, add `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `FINNHUB_API_KEY`, `ALPHAVANTAGE_API_KEY`, `GEMINI_API_KEY` and, optionally, `APP_URL` and `SEC_USER_AGENT` (see [`data-fallbacks.md`](./data-fallbacks.md)).
2. Push the workflow to the default branch (`main`). GitHub only runs scheduled workflows from the default branch, and may start them a few minutes late.

On a public repository, GitHub pauses scheduled workflows after 60 days without commits; re-enable them from the Actions tab.

## Limits

- Transcripts and summaries are saved, so each call costs one Alpha Vantage request (of 25 a day) and one Gemini request, however many users favorite it.
- News costs one Finnhub request per company and one Gemini request per user each run; filings cost one SEC request per company, plus a document download and a Gemini request per new filing.
- Messages over Telegram's 4,096-character limit are split at paragraph breaks.

## Files

- `src/lib/telegram.ts`: the Bot API client (sending, finding the `/start` message, friendly errors).
- `src/lib/notification-settings.ts`: settings, linking, recipients and the sent log.
- `src/lib/notifications.ts`: the messages and runs, delivery (kept in the app, and to Telegram) and the dry run.
- `src/lib/notification-inbox.ts`: the kept notifications (record, the unread count, the bell's list, the history, mark as read, pruning).
- `src/lib/notification-kinds.ts`: the kinds, their labels and pages, the badge and the time ago.
- `src/lib/telegram-html.ts`: reading a message's Telegram HTML safely.
- `src/app/components/notification-bell.tsx`, `notification-bell-panel.tsx`, `notification-message.tsx` and `notification-icon.tsx`: the bell and the message.
- `src/app/notifications/`: the Notifications page, its settings (`notification-settings.tsx`, `settings-actions.ts`) and the read actions (`inbox-actions.ts`).
- `src/lib/news-digest.ts`: Gemini's news selection and the fallback.
- `src/lib/filing-analysis.ts`: which filings count, reading them as text, and Gemini's analysis.
- `src/app/settings/`: the Data sources page.
- `scripts/notify.ts` and `scripts/prune-notifications.ts`: the command-line entry points.
- `.github/workflows/notifications.yml` and `notifications-prune.yml`: the schedules.
