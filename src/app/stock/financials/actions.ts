"use server";

import type { AIAnalysisResult } from "@/lib/ai-analysis-types";
import { getStatementTable, type StatementPeriod } from "@/lib/financial-statements";
import { normalizeTicker } from "@/lib/fmp";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { buildReviewPrompt, isReviewStatement, reviewInstructions } from "@/lib/financial-review";
import { generateGeminiText } from "@/lib/gemini";

// Takes only the ticker, statement and period and reloads the figures on the server, so the
// prompt never contains numbers supplied by the browser.
export async function reviewFinancials(
  rawSymbol: unknown,
  rawStatement: unknown,
  rawPeriod: unknown,
): Promise<AIAnalysisResult> {
  const symbol = normalizeTicker(rawSymbol);
  if (!symbol || !isReviewStatement(rawStatement)) {
    return { ok: false, error: "There is nothing to review for this tab." };
  }
  const period: StatementPeriod = rawPeriod === "quarterly" ? "quarterly" : "annual";

  const table = await getStatementTable(symbol, rawStatement, period);
  if (!table.ok) {
    return { ok: false, error: providerFailureMessage(table.reason, "the financial statements") };
  }

  const result = await generateGeminiText({
    instructions: reviewInstructions(rawStatement),
    prompt: buildReviewPrompt({ symbol, table: table.data }),
    generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
    subject: "review",
  });
  return result.ok ? { ok: true, analysis: result.text } : result;
}
