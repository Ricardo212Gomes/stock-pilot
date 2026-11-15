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
import {
  PROJECTION_AI_INSTRUCTIONS,
  PROJECTION_AI_SCHEMA,
  buildProjectionPrompt,
  parseProjectionResponse,
  type ProjectionSuggestions,
} from "@/lib/plumas-projection-autofill";
import { loadPriceProjectionData, loadProjectionData } from "./data";

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

export type ProjectionAutofillResult =
  | ({ ok: true } & ProjectionSuggestions)
  | { ok: false; error: string };

// Same safeguard as above: only the ticker comes from the browser.
export async function autofillPlumasProjection(rawSymbol: unknown): Promise<ProjectionAutofillResult> {
  const symbol = normalizeTicker(rawSymbol);
  if (!symbol) return { ok: false, error: "Enter a valid ticker symbol first." };

  const loaded = await loadPriceProjectionData(symbol);
  if (!loaded.ok) {
    return { ok: false, error: providerFailureMessage(loaded.reason, "the financial statements") };
  }

  const result = await generateGeminiText({
    instructions: PROJECTION_AI_INSTRUCTIONS,
    prompt: buildProjectionPrompt({ symbol, defaults: loaded.data.plumas }),
    generationConfig: {
      temperature: 0.2,
      // Five scenarios × nine fields × five years, plus a reason for each scenario.
      maxOutputTokens: 6000,
      responseMimeType: "application/json",
      responseSchema: PROJECTION_AI_SCHEMA,
    },
    subject: "autofill",
  });
  if (!result.ok) return result;

  const parsed = parseProjectionResponse(result.text);
  if (!parsed) return { ok: false, error: "Gemini's suggestions could not be read. Please try again." };
  return { ok: true, ...parsed };
}
