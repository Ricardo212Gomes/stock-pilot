-- StockPilot database schema. Run with `npm run db:setup`; safe to run again.

create table if not exists favorites (
  -- The Google account id (Auth.js token subject).
  user_id text not null,
  symbol text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

-- Earnings call transcripts from Alpha Vantage, kept so each one is requested only once.
-- An empty segments array means Alpha Vantage had none yet; it's asked again later.
create table if not exists transcripts (
  symbol text not null,
  quarter text not null,
  segments jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (symbol, quarter)
);

-- The AI summary of each transcript (see src/lib/transcript-summary.ts), made once on request.
alter table transcripts add column if not exists summary jsonb;

-- Telegram notifications: each user's chat and what they want to receive.
create table if not exists notification_settings (
  user_id text primary key,
  telegram_chat_id text,
  telegram_name text,
  earnings_alerts boolean not null default true,
  transcript_summaries boolean not null default true,
  -- A one-time code sent as /start <code> to the bot to link the chat; cleared once linked.
  link_code text,
  link_code_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- What was already sent, so a notification goes out once (e.g. kind 'transcript', item 'CRWD:2026Q4').
create table if not exists notification_log (
  user_id text not null,
  kind text not null,
  item text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, item)
);
