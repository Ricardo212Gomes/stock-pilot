-- StockPilot database schema. Run with `npm run db:setup`; safe to run again.

create table if not exists favorites (
  -- The Google account id (Auth.js token subject).
  user_id text not null,
  symbol text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, symbol)
);
