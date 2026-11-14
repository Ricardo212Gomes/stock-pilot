"""Tests for agents/review.py's parsing and choices: python -m unittest discover agents"""

import unittest

from review import parse_decision, pick_symbols

# The portfolio manager's decision as TradingAgents renders it (render_pm_decision).
DECISION = """**Rating**: Underweight

**Executive Summary**: Reduce NVDA exposure to an underweight allocation by scaling out during relief rallies.
Trim in the $175 to $185 band.

**Investment Thesis**: NVDA has broken below its 200-day SMA ($204.26).

**Price Target**: 150.0

**Time Horizon**: 1-3 months"""


class ParseDecision(unittest.TestCase):
    def test_reads_each_field(self):
        self.assertEqual(parse_decision(DECISION), {
            "rating": "Underweight",
            "summary": "Reduce NVDA exposure to an underweight allocation by scaling out during relief rallies.\nTrim in the $175 to $185 band.",
            "price_target": 150.0,
            "horizon": "1-3 months",
        })

    def test_fields_not_provided_and_unknown_ratings(self):
        decision = parse_decision("**Rating**: Strong opinion\n\n**Executive Summary**: x\n\n**Price Target**: not provided\n\n**Time Horizon**: not provided")
        self.assertEqual((decision["rating"], decision["price_target"], decision["horizon"]), ("Review", None, None))

    def test_targets_written_as_money(self):
        self.assertEqual(parse_decision("**Rating**: Buy\n\n**Price Target**: $1,250.50 (12 months)")["price_target"], 1250.5)


class PickSymbols(unittest.TestCase):
    positions = [{"ticker": symbol} for symbol in ("AAPL", "NVDA", "MSFT", "AMZN")]

    def test_never_reviewed_first_then_oldest_skipping_today(self):
        last = {"AAPL": "2026-11-01", "NVDA": "2026-11-14", "MSFT": "2026-10-20"}
        self.assertEqual(pick_symbols(self.positions, last, "2026-11-14", 2), ["AMZN", "MSFT"])
        self.assertEqual(pick_symbols(self.positions, last, "2026-11-14", 10), ["AMZN", "MSFT", "AAPL"])

    def test_one_ticker_when_asked_and_held(self):
        self.assertEqual(pick_symbols(self.positions, {"NVDA": "2026-11-14"}, "2026-11-14", 2, "NVDA"), ["NVDA"])
        self.assertEqual(pick_symbols(self.positions, {}, "2026-11-14", 2, "TSLA"), [])


if __name__ == "__main__":
    unittest.main()
