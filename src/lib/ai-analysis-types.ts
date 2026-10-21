export type AIAnalysisResult =
  | { ok: true; analysis: string }
  | { ok: false; error: string };
