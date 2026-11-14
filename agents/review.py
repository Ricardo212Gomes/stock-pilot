"""TradingAgents' reviews of users' holdings (see docs/portfolio-reviews.md).

Each run takes the one or two holdings whose review is oldest, for each user who turned the reviews on, and has
TradingAgents analyse them against the user's actual position (shares and average cost). The rating, plan and report
go to portfolio_reviews, which the Portfolio page reads.

    npm run portfolio:review -- --opted-in            # the daily job: 2 holdings per user
    npm run portfolio:review -- --user <id> --ticker NVDA
    npm run portfolio:review -- --user <id> --all     # every holding now (one Gemini-heavy analysis each)

Add --dry-run to print the reviews without saving them.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent

# TradingAgents' settings, tuned for Gemini's free plan (20 requests a day per model): two analysts, one round of
# debate, at most three look-ups per analyst, and the quick and deep tiers on different models so each has its own
# daily allowance. About 15-20 requests and 8 minutes an analysis. The environment can override any of them.
SETTINGS = {
    "TRADINGAGENTS_LLM_PROVIDER": "google",
    "TRADINGAGENTS_QUICK_THINK_LLM": "gemini-3.6-flash",
    "TRADINGAGENTS_DEEP_THINK_LLM": "gemini-3.5-flash",
    "TRADINGAGENTS_GOOGLE_THINKING_LEVEL": "high",
    "TRADINGAGENTS_OUTPUT_LANGUAGE": "English",
    "TRADINGAGENTS_MAX_DEBATE_ROUNDS": "1",
    "TRADINGAGENTS_MAX_RISK_ROUNDS": "1",
    "TRADINGAGENTS_MAX_TOOL_ROUNDS": "3",
    # A run cut off by the daily limit resumes from its last step the next time, instead of starting over.
    "TRADINGAGENTS_CHECKPOINT_ENABLED": "true",
    # Few retries: once the day's allowance is gone, waiting doesn't bring it back.
    "TRADINGAGENTS_LLM_MAX_RETRIES": "4",
    "TRADINGAGENTS_NO_UPDATE_CHECK": "1",
}

ANALYSTS = ["market", "news"]
DAILY_LIMIT = 2
RATINGS = ("Buy", "Overweight", "Hold", "Underweight", "Sell")

# The report as TradingAgents saves it (save_reports), by the ids the Portfolio page shows them under.
REPORT_FILES = {
    "market": "1_analysts/market.md",
    "news": "1_analysts/news.md",
    "bull": "2_research/bull.md",
    "bear": "2_research/bear.md",
    "manager": "2_research/manager.md",
    "trader": "3_trading/trader.md",
    "aggressive": "4_risk/aggressive.md",
    "conservative": "4_risk/conservative.md",
    "neutral": "4_risk/neutral.md",
    "decision": "5_portfolio/decision.md",
}


def configure_environment() -> None:
    """StockPilot's .env, then TradingAgents' key and settings. Must run before tradingagents is imported."""
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    # A key from its own Google project, so the reviews can't use up the app's Gemini allowance.
    if not os.environ.get("GOOGLE_API_KEY") and os.environ.get("AGENTS_GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ["AGENTS_GOOGLE_API_KEY"]
    if os.environ.get("SEC_USER_AGENT") and not os.environ.get("SEC_EDGAR_USER_AGENT"):
        os.environ["SEC_EDGAR_USER_AGENT"] = os.environ["SEC_USER_AGENT"]
    for key, value in SETTINGS.items():
        os.environ.setdefault(key, value)


def field(text: str, label: str) -> str | None:
    """A "**Label**: value" field of the portfolio manager's decision, up to the next field."""
    match = re.search(rf"\*\*{re.escape(label)}\*\*:\s*(.+?)(?=\n\s*\*\*[A-Z][^*\n]*\*\*:|\Z)", text, re.S)
    value = match.group(1).strip() if match else ""
    return None if not value or value.lower() == "not provided" else value


def parse_decision(text: str) -> dict:
    """The rating, summary, price target and horizon from the decision TradingAgents renders."""
    rating = field(text, "Rating") or ""
    rating = next((name for name in RATINGS if rating.lower().startswith(name.lower())), "Review")
    target = field(text, "Price Target")
    number = re.search(r"-?\d[\d,]*(?:\.\d+)?", target or "")
    price = float(number.group(0).replace(",", "")) if number else None
    horizon = field(text, "Time Horizon")
    return {
        "rating": rating,
        "summary": (field(text, "Executive Summary") or text.strip())[:2000],
        "price_target": price if price is not None and price > 0 else None,
        "horizon": horizon[:120] if horizon else None,
    }


def pick_symbols(positions: list[dict], last_reviewed: dict[str, str], today: str, limit: int, ticker: str | None = None) -> list[str]:
    """The holdings to review now: one ticker when asked for; otherwise those never reviewed, in the book's order,
    then the oldest reviews, skipping any already reviewed today."""
    held = [position["ticker"] for position in positions]
    if ticker:
        return [ticker] if ticker in held else []
    due = [symbol for symbol in held if last_reviewed.get(symbol) != today]
    due.sort(key=lambda symbol: (symbol in last_reviewed, last_reviewed.get(symbol, "")))
    return due[:limit]


def new_york_today() -> str:
    return dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def load_books(user: str | None) -> list[dict]:
    """Users' holdings from StockPilot's own code (scripts/portfolio-holdings.ts)."""
    command = ["npm", "run", "-s", "portfolio:holdings", "--", *(["--user", user] if user else ["--opted-in"])]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"portfolio:holdings failed: {result.stderr.strip()[-800:]}")
    line = next((line for line in reversed(result.stdout.splitlines()) if line.startswith("{")), "")
    return json.loads(line)["users"]


def report_sections(graph, state, ticker: str) -> dict:
    """The report's sections, through TradingAgents' own report writer."""
    with tempfile.TemporaryDirectory() as folder:
        graph.save_reports(state, ticker, save_path=Path(folder), html=False)
        sections = {}
        for section, name in REPORT_FILES.items():
            path = Path(folder) / name
            if path.exists():
                sections[section] = path.read_text(encoding="utf-8")[:40_000]
        return sections


def connect():
    """A short connection for one step. An analysis takes minutes, and a connection left idle in a transaction that
    long is closed by poolers such as Neon's, so none is held across one."""
    import psycopg

    return psycopg.connect(os.environ["DATABASE_URL"], autocommit=True)


def last_reviewed(user_id: str) -> dict[str, str]:
    with connect() as connection, connection.cursor() as cursor:
        cursor.execute("select symbol, max(analysis_date) from portfolio_reviews where user_id = %s group by symbol", (user_id,))
        return {symbol: date.isoformat() for symbol, date in cursor.fetchall()}


def save_review(user_id: str, symbol: str, date: str, decision: dict, report: dict, position: dict, model: str) -> None:
    with connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            insert into portfolio_reviews
              (user_id, symbol, analysis_date, rating, summary, price_target, horizon, report, shares, average_cost, model)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (user_id, symbol, analysis_date) do update set
              rating = excluded.rating, summary = excluded.summary, price_target = excluded.price_target,
              horizon = excluded.horizon, report = excluded.report, shares = excluded.shares,
              average_cost = excluded.average_cost, model = excluded.model, created_at = now()
            """,
            (user_id, symbol, date, decision["rating"], decision["summary"], decision["price_target"], decision["horizon"],
             json.dumps(report), position["quantity"], position["average_price"], model),
        )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="TradingAgents' reviews of users' holdings.")
    who = parser.add_mutually_exclusive_group(required=True)
    who.add_argument("--user", help="A user's id (their Google account id)")
    who.add_argument("--opted-in", action="store_true", help="Every user who turned the reviews on")
    parser.add_argument("--ticker", help="Review this holding only")
    parser.add_argument("--all", action="store_true", help="Review every holding now")
    parser.add_argument("--limit", type=int, default=DAILY_LIMIT, help=f"Holdings per user (default {DAILY_LIMIT})")
    parser.add_argument("--date", help="Analysis date, YYYY-MM-DD (default: today in New York)")
    parser.add_argument("--dry-run", action="store_true", help="Print the reviews without saving them")
    args = parser.parse_args(argv)

    configure_environment()
    missing = [name for name, ok in (("AGENTS_GOOGLE_API_KEY or GOOGLE_API_KEY", os.environ.get("GOOGLE_API_KEY")),
                                     ("DATABASE_URL", os.environ.get("DATABASE_URL"))) if not ok]
    if missing:
        print(f"Set {' and '.join(missing)} first (see docs/portfolio-reviews.md).", file=sys.stderr)
        return 1

    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    from tradingagents.portfolio import PortfolioContext

    date = args.date or new_york_today()
    books = load_books(args.user)
    if not books:
        print("No one to review: no user has turned the reviews on, or their portfolios are empty.")
        return 0

    config = DEFAULT_CONFIG.copy()
    model = f"{config['quick_think_llm']} / {config['deep_think_llm']}"
    graph = TradingAgentsGraph(selected_analysts=ANALYSTS, config=config)
    reviewed = failed = 0
    # A dry run reads and writes nothing in the database, so it works before npm run db:setup.
    for book in books:
        user_id, positions = book["userId"], book["positions"]
        limit = len(positions) if args.all else args.limit
        last = {} if args.dry_run else last_reviewed(user_id)
        symbols = pick_symbols(positions, last, date, limit, args.ticker)
        if args.ticker and not symbols:
            print(f"{args.ticker} isn't one of {user_id}'s priced holdings.", file=sys.stderr)
            failed += 1
            continue
        portfolio = PortfolioContext.model_validate({"currency": book["currency"], "positions": positions})
        for symbol in symbols:
            position = next(item for item in positions if item["ticker"] == symbol)
            print(f"Reviewing {symbol} for {user_id} ({position['quantity']:g} shares at ${position['average_price']:,.2f})…", flush=True)
            try:
                state, _ = graph.propagate(symbol, date, portfolio=portfolio)
                decision = parse_decision(state.get("final_trade_decision") or "")
                report = report_sections(graph, state, symbol)
            except Exception as error:  # one holding failing (the day's Gemini limit, a data gap) shouldn't stop the rest
                print(f"  {symbol} failed: {error}", file=sys.stderr)
                failed += 1
                continue
            target = f", target ${decision['price_target']:,.2f}" if decision["price_target"] else ""
            print(f"  {decision['rating']}{target}: {decision['summary'][:300]}")
            if not args.dry_run:
                try:
                    save_review(user_id, symbol, date, decision, report, position, model)
                except Exception as error:
                    print(f"  {symbol} couldn't be saved: {error}", file=sys.stderr)
                    failed += 1
                    continue
            reviewed += 1
    print(f"Done: {reviewed} reviewed{' (dry run, nothing saved)' if args.dry_run else ''}, {failed} failed.")
    return 1 if failed and not reviewed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
