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

-- News and filing alerts, added after the first two kinds.
alter table notification_settings add column if not exists news_alerts boolean not null default true;
alter table notification_settings add column if not exists filing_alerts boolean not null default true;

-- Portfolio trades: each buy or sell a user records. Holdings, gains and history are worked out from them
-- (see src/lib/portfolio.ts); shares and prices are as entered, and later splits are applied when reading.
create table if not exists portfolio_trades (
  id bigint generated always as identity primary key,
  user_id text not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  shares numeric not null check (shares > 0),
  price numeric not null check (price > 0),
  traded_on date not null,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_trades_user_idx on portfolio_trades (user_id, traded_on);

-- Added with statement imports: the currency each trade's price is in, and the broker's id for an imported trade,
-- so importing the same statement twice adds nothing twice.
alter table portfolio_trades add column if not exists currency text not null default 'USD' check (currency in ('USD', 'EUR'));
alter table portfolio_trades add column if not exists external_id text;
create unique index if not exists portfolio_trades_external_idx on portfolio_trades (user_id, external_id) where external_id is not null;

-- Added with full statement imports: an imported trade's ISIN, and for an instrument StockPilot keeps no prices
-- for (a company sold before it was imported, or one with no US listing) priced = false, with the broker's code
-- (label) and a name when one is known. Its gains come from its trades alone.
alter table portfolio_trades add column if not exists isin text;
alter table portfolio_trades add column if not exists label text;
alter table portfolio_trades add column if not exists name text;
alter table portfolio_trades add column if not exists priced boolean not null default true;
create index if not exists portfolio_trades_isin_idx on portfolio_trades (user_id, isin) where isin is not null;

-- Dividends (after withholding tax) and interest imported from a broker's statement. A dividend belongs to the
-- position it was paid on: the same symbol as its trades.
create table if not exists portfolio_income (
  id bigint generated always as identity primary key,
  user_id text not null,
  kind text not null check (kind in ('dividend', 'interest')),
  symbol text,
  isin text,
  amount numeric not null,
  currency text not null check (currency in ('USD', 'EUR')),
  paid_on date not null,
  external_id text,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_income_user_idx on portfolio_income (user_id, paid_on);
create unique index if not exists portfolio_income_external_idx on portfolio_income (user_id, external_id) where external_id is not null;

-- The currency each user's portfolio is shown in.
create table if not exists portfolio_settings (
  user_id text primary key,
  currency text not null default 'USD' check (currency in ('USD', 'EUR')),
  updated_at timestamptz not null default now()
);

-- AI analyses of SEC filings, made once per filing and shared by everyone who follows the company.
create table if not exists filing_analyses (
  accession text primary key,
  symbol text not null,
  form text not null,
  filed date not null,
  analysis jsonb not null,
  created_at timestamptz not null default now()
);
