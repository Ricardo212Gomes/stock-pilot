import {
  INPUT_FIELDS,
  PROJECTION_YEARS,
  SCENARIOS,
  type ProjectionMode,
  type ScenarioCount,
  type ScenarioId,
  type ScenarioInputs,
} from "@/lib/plumas-projection";
import { CASES, CASE_FIELDS, JEREMY_YEARS, type CaseId, type CaseInputs } from "@/lib/jeremy-projection";

// Each company's projections are saved in the browser, so edits survive a reload. Where storage is
// unavailable (some private windows) they're kept in memory for the visit instead.
const CHANGE_EVENT = "stockpilot-projection-change";
const memory = new Map<string, string>();

// Simple or Advanced, and 3 or 5 scenarios: one choice for every company.
export const VIEW_KEY = "stockpilot-projection-view";

// A new fiscal year starts a fresh projection. The Plumas key predates Jeremy's projection.
export function projectionKey(symbol: string, baseYear: number): string {
  return `stockpilot-projection:${symbol}:${baseYear}`;
}

export function jeremyKey(symbol: string, startYear: number): string {
  return `stockpilot-jeremy:${symbol}:${startYear}`;
}

export function subscribeSaved(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  // Edits made in another tab.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readSaved(key: string): string | null {
  const kept = memory.get(key);
  if (kept !== undefined) return kept;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// null removes the saved value.
export function writeSaved(key: string, value: string | null) {
  memory.delete(key);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    if (value !== null) memory.set(key, value);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export type SavedProjection = {
  scenarios: Record<ScenarioId, ScenarioInputs>;
  ai: { summary: string; rationale: Partial<Record<ScenarioId, string>> } | null;
};

function isYearly(value: unknown, length = PROJECTION_YEARS): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

// Anything unreadable, such as a projection saved by an older version, falls back to the defaults.
export function parseSavedProjection(text: string | null): SavedProjection | null {
  if (!text) return null;
  try {
    const payload = JSON.parse(text) as { scenarios?: Record<string, Record<string, unknown>>; ai?: { summary?: unknown; rationale?: Record<string, unknown> } | null };
    const scenarios = {} as Record<ScenarioId, ScenarioInputs>;
    for (const { id } of SCENARIOS) {
      const saved = payload.scenarios?.[id];
      if (!saved || !INPUT_FIELDS.every((field) => isYearly(saved[field]))) return null;
      scenarios[id] = Object.fromEntries(INPUT_FIELDS.map((field) => [field, saved[field]])) as ScenarioInputs;
    }
    const rationale = Object.fromEntries(SCENARIOS.flatMap(({ id }) => {
      const reason = payload.ai?.rationale?.[id];
      return typeof reason === "string" ? [[id, reason]] : [];
    }));
    const ai = typeof payload.ai?.summary === "string" ? { summary: payload.ai.summary, rationale } : null;
    return { scenarios, ai };
  } catch {
    return null;
  }
}

export type ProjectionView = { mode: ProjectionMode | null; count: ScenarioCount };

// A null mode means the user hasn't picked one: each company starts in the mode that suits it.
export function parseView(text: string | null): ProjectionView {
  try {
    const payload = JSON.parse(text ?? "{}") as { mode?: unknown; count?: unknown };
    return {
      mode: payload.mode === "simple" || payload.mode === "advanced" ? payload.mode : null,
      count: payload.count === 5 ? 5 : 3,
    };
  } catch {
    return { mode: null, count: 3 };
  }
}

export type SavedJeremy = {
  cases: Record<CaseId, CaseInputs>;
  // Starting figures typed over the defaults; null keeps the default.
  start: { revenue: number | null; netIncome: number | null; shares: number | null };
};

export function parseSavedJeremy(text: string | null): SavedJeremy | null {
  if (!text) return null;
  try {
    const payload = JSON.parse(text) as { cases?: Record<string, Record<string, unknown>>; start?: Record<string, unknown> };
    const cases = {} as Record<CaseId, CaseInputs>;
    for (const { id } of CASES) {
      const saved = payload.cases?.[id];
      if (!saved || !CASE_FIELDS.every((field) => isYearly(saved[field], JEREMY_YEARS))) return null;
      cases[id] = Object.fromEntries(CASE_FIELDS.map((field) => [field, saved[field]])) as CaseInputs;
    }
    const figure = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    return { cases, start: { revenue: figure(payload.start?.revenue), netIncome: figure(payload.start?.netIncome), shares: figure(payload.start?.shares) } };
  } catch {
    return null;
  }
}
