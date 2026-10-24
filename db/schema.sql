-- StockPilot database schema. Run with `npm run db:setup`; safe to run again.

create table if not exists favorites (
  -- The Google account id (Auth.js token subject).
  user_id text not null,
  symbol text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

-- Earnings call transcripts from Alpha Vantage, kept so each one is requested only once.
-- An empty segments array means Alpha Vantage had none yet; it's asked again after a day.
create table if not exists transcripts (
  symbol text not null,
  quarter text not null,
  segments jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (symbol, quarter)
);
