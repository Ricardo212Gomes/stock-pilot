// The AI portfolio's weekly rebalance (see docs/ai-portfolio.md):
//   npm run ai-portfolio:rebalance               — this week's moves, placed when AI_PORTFOLIO_TRADING_ENABLED=true
//   npm run ai-portfolio:rebalance -- --dry-run  — print the moves; store and place nothing
//   npm run ai-portfolio:rebalance -- --force    — run again in a week that's already done
import { isAlpacaConfigured } from "@/lib/alpaca";
import { runRebalance } from "@/lib/ai-portfolio/rebalance";
import { closeDb, isDatabaseConfigured } from "@/lib/db";
import { isGeminiConfigured } from "@/lib/gemini";

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const tradingEnabled = process.env.AI_PORTFOLIO_TRADING_ENABLED === "true";
  const missing = [
    !isAlpacaConfigured() && "ALPACA_API_KEY and ALPACA_SECRET_KEY",
    !isGeminiConfigured() && "GEMINI_API_KEY",
    !process.env.FMP_API_KEY && "FMP_API_KEY",
    !dryRun && !isDatabaseConfigured() && "DATABASE_URL",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`Set ${missing.join(", ")} first (see docs/ai-portfolio.md).`);
    return 1;
  }
  try {
    const report = await runRebalance({ dryRun, force, tradingEnabled });
    for (const line of report.lines) console.log(line);
    console.log(`Done: ${report.status}.`);
    return report.status === "failed" ? 1 : 0;
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
