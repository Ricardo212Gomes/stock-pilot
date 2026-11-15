import { spacing } from "../concurrency";
import { savedAnalysis, type FilingAnalysis } from "../filing-analysis";
import { filingMatches, getFilings, type Filing } from "../sec-filings";

// Each candidate's own recent SEC filings for the AI portfolio's prompt (docs/ai-portfolio.md): what the company
// filed in the last 30 days (reports, 8-Ks, proxies and other important forms, not insider forms), at most five,
// and for holdings the stored AI analysis of a recent report or 8-K, if the filing alerts have made one. One
// EDGAR request per company, spaced under SEC's limit of 10 a second; no new Gemini requests.

export const FILING_DAYS = 30;
export const FILINGS_PER_CANDIDATE = 5;
// Reports and 8-Ks whose stored analysis a holding's row carries.
const ANALYSED_FORMS = new Set(["8-K", "10-Q", "10-K"]);
// About 7 requests a second, comfortably under SEC's 10.
const SEC_INTERVAL_MS = 150;

export type RecentFiling = {
  form: string;
  filed: string;
  description: string;
  // A holding's stored analysis of this filing, in a sentence or two.
  analysis?: string;
};

// The important filings of the last `days` days, newest first, at most `limit`.
export function pickRecentFilings(filings: Filing[], today: string, days = FILING_DAYS, limit = FILINGS_PER_CANDIDATE): Filing[] {
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - days);
  const cutoff = since.toISOString().slice(0, 10);
  return filings
    .filter((filing) => filing.filed >= cutoff && filing.filed <= today && filingMatches(filing, "important"))
    .sort((left, right) => right.filed.localeCompare(left.filed))
    .slice(0, limit);
}

export type FilingsDeps = {
  filings: (symbol: string) => ReturnType<typeof getFilings>;
  analysis: (accession: string) => Promise<FilingAnalysis | null>;
  space: () => Promise<void>;
};

export function defaultFilingsDeps(): FilingsDeps {
  return { filings: getFilings, analysis: savedAnalysis, space: spacing(SEC_INTERVAL_MS) };
}

// A candidate's recent filings; null when EDGAR couldn't say (the prompt then shows none, and the run says so). A
// company EDGAR doesn't know, such as some foreign listings, has an empty list.
export async function loadRecentFilings(symbol: string, held: boolean, today: string, deps: FilingsDeps): Promise<RecentFiling[] | null> {
  await deps.space();
  const result = await deps.filings(symbol);
  if (!result.ok) return result.reason === "not-found" ? [] : null;
  const recent = pickRecentFilings(result.data.filings, today);
  return Promise.all(recent.map(async (filing): Promise<RecentFiling> => {
    const row: RecentFiling = { form: filing.form, filed: filing.filed, description: filing.description };
    if (!held || !ANALYSED_FORMS.has(filing.form)) return row;
    const stored = await deps.analysis(filing.accession).catch(() => null);
    return stored?.summary ? { ...row, analysis: stored.summary } : row;
  }));
}
