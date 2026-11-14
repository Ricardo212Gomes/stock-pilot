// Prints users' holdings as TradingAgents' portfolio JSON, for the reviews in agents/review.py
// (see docs/portfolio-reviews.md). The Portfolio page's own logic works them out: splits, average cost and currencies.
//   npm run -s portfolio:holdings -- --user <id>   — one user
//   npm run -s portfolio:holdings -- --opted-in    — every user who turned the reviews on
// Prints {"users": [{"userId", "currency", "positions": [{"ticker", "quantity", "average_price"}]}]} on stdout.
import { closeDb, isDatabaseConfigured } from "@/lib/db";
import { getPortfolio } from "@/lib/portfolio";
import { listReviewUsers, tradingAgentsBook } from "@/lib/portfolio-reviews";
import { listIncome, listTrades } from "@/lib/portfolio-trades";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<number> {
  if (!isDatabaseConfigured()) {
    console.error("Set DATABASE_URL first (see docs/portfolio-reviews.md).");
    return 1;
  }
  const user = argument("--user");
  if (!user && !process.argv.includes("--opted-in")) {
    console.error("Usage: npm run -s portfolio:holdings -- --user <id> | --opted-in");
    return 1;
  }
  try {
    const userIds = user ? [user] : await listReviewUsers();
    const users = [];
    for (const userId of userIds) {
      const [trades, income] = await Promise.all([listTrades(userId), listIncome(userId)]);
      if (trades.length === 0) continue;
      // Dollars, whatever the page is shown in: TradingAgents' prices are in dollars.
      const view = await getPortfolio(trades, new Date(), "USD", income);
      users.push({ userId, ...tradingAgentsBook(view.holdings, "USD") });
    }
    process.stdout.write(`${JSON.stringify({ users })}\n`);
    return 0;
  } finally {
    await closeDb();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
