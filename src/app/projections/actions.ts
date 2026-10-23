"use server";

import { normalizeTicker } from "@/lib/fmp";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { generateGeminiText } from "@/lib/gemini";
import {
  AUTOFILL_INSTRUCTIONS,
  AUTOFILL_SCHEMA,
  buildAutofillPrompt,
  parseAutofillResponse,
  type AutofillSuggestions,
} from "@/lib/valuation/autofill";
import { loadProjectionData } from "./data";

export type AutofillResult =
  | ({ ok: true } & AutofillSuggestions)
  | { ok: false; error: string };

// Takes only the ticker and reloads the data on the server, so the prompt never
// contains figures supplied by the browser.
export async function autofillAssumptions(rawSymbol: unknown): Promise<AutofillResult> {
  const symbol = normalizeTicker(rawSymbol);
  if (!symbol) return { ok: false, error: "Enter a valid ticker symbol first." };

  const loaded = await loadProjectionData(symbol);
  if (!loaded.ok) {
    return { ok: false, error: providerFailureMessage(loaded.reason, "the financial statements") };
  }

  const { fundamentals, profile, classification, defaults } = loaded.data;
  const result = await generateGeminiText({
    instructions: AUTOFILL_INSTRUCTIONS,
    prompt: buildAutofillPrompt({
      symbol,
      profile,
      financials: fundamentals.annualFinancials,
      classification,
      defaults: defaults.assumptions,
    }),
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2000,
      responseMimeType: "application/json",
      responseSchema: AUTOFILL_SCHEMA,
    },
    subject: "autofill",
  });
  if (!result.ok) return result;

  const parsed = parseAutofillResponse(result.text);
  if (!parsed) {
    return { ok: false, error: "Gemini's suggestions could not be read. Please try again." };
  }
  return { ok: true, ...parsed };
}
