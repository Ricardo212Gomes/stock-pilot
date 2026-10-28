# Telegram notifications

Signed-in users can get four kinds of Telegram messages about their [favorites](./favorites.md):

- **Upcoming earnings** (`npm run notify:earnings`): which favorites report in the next 7 days, with the day, the time (before the open, after the close…) and the EPS and revenue estimates, from Finnhub's free earnings calendar. One message per user, sent only when at least one favorite reports.
- **Earnings call summaries** (`npm run notify:transcripts`): when a favorite reported in the last 21 days and Alpha Vantage has the call's transcript, the AI summary from the Transcripts tab (overview, highlights, outlook, analysts' questions and tone). Each call is sent once per user (`notification_log`); a call that isn't transcribed yet is tried again on the next run.

- **Relevant news** (`npm run notify:news`): one digest of the last 26 hours' headlines about the user's favorites (up to 6 per company, newest first, from Finnhub). Gemini picks at most 6 that matter to a shareholder (results, guidance, deals, regulation, lawsuits, management changes, major products or customers, large analyst moves), skipping roundups, "stocks to buy" lists and passing mentions, and adds a one-line reason for each. If Gemini fails twice, the two newest headlines per company are sent instead, labelled as such. Each article is sent once (`notification_log`), and nothing is sent when nothing qualifies.
- **SEC filing analysis** (`npm run notify:filings`): each new 10-K, 10-Q (or 20-F, 40-F) and significant 8-K (items such as 1.01 agreements, 2.02 results, 2.03 debt, 5.02 executive changes, 7.01 and 8.01 announcements; not vote results or exhibit-only filings) from the last 3 days, at most 3 per company per run. The document is read from sec.gov as plain text (for a 10-K or 10-Q, from Management's Discussion and Analysis; for an earnings 8-K, its press release) and Gemini writes a headline, summary, key points with figures, what to watch and whether it's positive, neutral or negative for shareholders. The analysis is saved in `filing_analyses`, so a filing is analyzed once however many users follow the company, and each filing is sent once per user.

All four are on by default once Telegram is connected, and each can be turned off in **Settings → Notifications** (`/settings`, in the account menu).

## Set up the bot

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, and pick a name and a username ending in `bot`.
2. Add its token and username to the environment file:

   ```
   TELEGRAM_BOT_TOKEN=123456789:AA...
   TELEGRAM_BOT_USERNAME=YourStockPilotBot
   ```

3. Run `npm run db:setup` to create the `notification_settings` and `notification_log` tables, and restart the server.

Optionally set `APP_URL` to the app's public address; messages then link each ticker to its page.

## Connect a chat

In **Settings → Notifications**:

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
```

Add `-- --dry-run` (for example `npm run notify:filings -- --dry-run`) to print the messages instead of sending them; nothing is marked as sent, so a real run still delivers them.

They use the same code as the app (through `tsx`), read the environment file, and print one line per user or ticker and how many messages were sent. They need `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `FINNHUB_API_KEY`, and for summaries, news and filings `GEMINI_API_KEY` (plus `ALPHAVANTAGE_API_KEY` for summaries). Long Gemini requests here wait up to 90 seconds and are retried once.

## Schedule them with GitHub Actions

`.github/workflows/notifications.yml` runs them on GitHub's servers, so the app doesn't need to be deployed:

- Mondays at 07:00 UTC: upcoming earnings.
- Every day at 13:00 UTC: new earnings call summaries.
- Weekdays at 21:30 UTC, after the US close: relevant news.
- Every day at 22:30 UTC, after the evening's 8-Ks: filing analyses.
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
- `src/lib/notification-settings.ts`: settings, linking and the sent log.
- `src/lib/notifications.ts`: the four messages and runs, and the dry run.
- `src/lib/news-digest.ts`: Gemini's news selection and the fallback.
- `src/lib/filing-analysis.ts`: which filings count, reading them as text, and Gemini's analysis.
- `src/app/settings/`: the Settings page and its server actions.
- `scripts/notify.ts`: the command-line entry point.
- `.github/workflows/notifications.yml`: the schedule.
