import { describe, expect, it } from "vitest";
import {
  defaultSaveName,
  droppedNotice,
  headlineValue,
  migrateInputs,
  restoreIntrinsicValue,
  restoreJeremy,
  restorePlumas,
  sortSaved,
  valueGap,
  type MigrationStep,
} from "./saved-projection-inputs";
import { INPUT_FIELDS, SCENARIOS, type BaseYear, type ScenarioId, type ScenarioInputs } from "./plumas-projection";
import { CASES, CASE_FIELDS, type CaseId, type CaseInputs } from "./jeremy-projection";

const yearly = (value: number) => [value, value, value, value, value];

const plumasScenarios = Object.fromEntries(SCENARIOS.map(({ id }) => [id, Object.fromEntries(INPUT_FIELDS.map((field) => [field, yearly(0.1)]))])) as
  Record<ScenarioId, ScenarioInputs>;
const base: BaseYear = { year: 2025, periodEnding: "2025-12-31", revenue: 100, costOfRevenue: 40, operatingIncome: 30, pretaxIncome: 28, netIncome: 22 };
const jeremyCases = Object.fromEntries(CASES.map(({ id }) => [id, Object.fromEntries(CASE_FIELDS.map((field) => [field, yearly(0.2)]))])) as
  Record<CaseId, CaseInputs>;

describe("saved projection basics", () => {
  it("names a save after the company, tool and day", () => {
    expect(defaultSaveName("NVDA", "plumas-projection", new Date("2026-11-14T12:00:00Z"))).toBe("NVDA · Plumas · 14 Nov 2026");
    expect(defaultSaveName("AAPL", "intrinsic-value", new Date("2026-01-02T12:00:00Z"))).toBe("AAPL · Intrinsic Value · 2 Jan 2026");
  });

  it("compares the blended value or the base scenario with a price", () => {
    const values = [{ id: "bear", label: "Bear", value: 80 }, { id: "base", label: "Base", value: 120 }];
    expect(headlineValue(values)?.value).toBe(120);
    expect(headlineValue([{ id: "blended", label: "Blended", value: 50 }, { id: "dcf", label: "DCF", value: 60 }])?.id).toBe("blended");
    expect(valueGap(120, 100)).toBeCloseTo(0.2);
    expect(valueGap(null, 100)).toBeNull();
    expect(valueGap(120, 0)).toBeNull();
  });

  it("sorts by date or gap, rows without a gap last", () => {
    const rows = [
      { id: "a", gap: 0.1, updatedAt: "2026-01-01T00:00:00Z" },
      { id: "b", gap: null, updatedAt: "2026-03-01T00:00:00Z" },
      { id: "c", gap: -0.2, updatedAt: "2026-02-01T00:00:00Z" },
    ];
    expect(sortSaved(rows, "date", "desc").map(({ id }) => id)).toEqual(["b", "c", "a"]);
    expect(sortSaved(rows, "gap", "desc").map(({ id }) => id)).toEqual(["a", "c", "b"]);
    expect(sortSaved(rows, "gap", "asc").map(({ id }) => id)).toEqual(["c", "a", "b"]);
  });
});

describe("migrateInputs", () => {
  it("leaves current inputs as they are", () => {
    expect(migrateInputs("plumas-projection", 1, { scenarios: {} })).toEqual({ ok: true, inputs: { scenarios: {} }, dropped: [] });
  });

  it("runs each step from the saved version, naming what was dropped", () => {
    const steps: Record<number, MigrationStep> = {
      1: ({ oldOption, ...rest }) => ({ inputs: { ...rest, v2: true }, dropped: oldOption === undefined ? [] : ["old option"] }),
      2: (inputs) => ({ inputs: { ...inputs, v3: true }, dropped: [] }),
    };
    expect(migrateInputs("intrinsic-value", 1, { oldOption: 1, keep: 2 }, steps, 3)).toEqual({
      ok: true,
      inputs: { keep: 2, v2: true, v3: true },
      dropped: ["old option"],
    });
    expect(migrateInputs("intrinsic-value", 2, { keep: 2 }, steps, 3)).toMatchObject({ ok: true, inputs: { keep: 2, v3: true } });
  });

  it("refuses inputs from a newer version, a missing step or no inputs", () => {
    expect(migrateInputs("jeremy-projection", 2, {})).toMatchObject({ ok: false, reason: expect.stringMatching(/newer version/) });
    expect(migrateInputs("jeremy-projection", 1, {}, {}, 2)).toMatchObject({ ok: false });
    expect(migrateInputs("jeremy-projection", 1, null)).toMatchObject({ ok: false });
    expect(migrateInputs("jeremy-projection", 0, {})).toMatchObject({ ok: false });
  });
});

describe("restoring saved inputs", () => {
  it("restores a Plumas projection with its own fiscal year", () => {
    const saved = { scenarios: plumasScenarios, ai: null, view: { mode: "advanced", count: 5 }, base, start: { price: null, shares: 12 } };
    const restored = restorePlumas(saved, { scenarios: plumasScenarios, base: { ...base, year: 2026 }, mode: "simple" });
    expect(restored.dropped).toEqual([]);
    expect(restored.inputs.base.year).toBe(2025);
    expect(restored.inputs.view).toEqual({ mode: "advanced", count: 5 });
    expect(restored.inputs.start).toEqual({ price: null, shares: 12 });
  });

  it("names Plumas inputs that no longer exist or can't be read, and falls back for them", () => {
    const fallback = { scenarios: plumasScenarios, base, mode: "simple" as const };
    const broken = {
      scenarios: { ...plumasScenarios, base: { ...plumasScenarios.base, revenueGrowth: [1, 2], oldField: yearly(1) } },
      retired: true,
      base: { year: "2025" },
    };
    const restored = restorePlumas(broken, fallback);
    expect(restored.dropped).toEqual(expect.arrayContaining(["retired", "Base old field", "Base revenue growth", "starting year"]));
    expect(restored.inputs.scenarios.base.revenueGrowth).toEqual(plumasScenarios.base.revenueGrowth);
    expect(restored.inputs.base).toBe(base);
    expect(restored.inputs.view).toEqual({ mode: "simple", count: 3 });
  });

  it("restores Jeremy's cases and start, naming what's unreadable", () => {
    const start = { year: 2026, revenue: 500, netIncome: 50, shares: 10 };
    const good = restoreJeremy({ cases: jeremyCases, start, entryPrice: 90 }, { cases: jeremyCases, start: { ...start, year: 2027 } });
    expect(good).toEqual({ inputs: { cases: jeremyCases, start, entryPrice: 90 }, dropped: [] });

    const bad = restoreJeremy({ cases: { bull: jeremyCases.bull }, start: null }, { cases: jeremyCases, start });
    expect(bad.inputs.cases.base).toEqual(jeremyCases.base);
    expect(bad.dropped).toEqual(expect.arrayContaining(["Base case revenue growth", "Bear case pe low", "starting year"]));
  });

  it("restores Intrinsic Value's assumptions and choices, leaving out retired ones", () => {
    const restored = restoreIntrinsicValue({
      assumptions: { currentPrice: null, growthRate: 0.12, discountRate: "high", oldKnob: 3 },
      sources: { growthRate: "edited", discountRate: "edited", currentPrice: "bogus" },
      dcfOptions: { firstYearFcf: 4.2, terminalMethod: "multiple", retiredOption: true },
      fcfBasis: { basis: "smoothed", stockCompAsCost: false },
      aiNotes: { growthRate: "Because." },
      aiSummary: "Outlook",
    });
    expect(restored.inputs.assumptions).toEqual({ currentPrice: null, growthRate: 0.12 });
    expect(restored.inputs.sources).toEqual({ growthRate: "edited" });
    expect(restored.inputs.dcfOptions).toEqual({ firstYearFcf: 4.2, terminalMethod: "multiple" });
    expect(restored.inputs.fcfBasis).toEqual({ basis: "smoothed", stockCompAsCost: false });
    expect(restored.inputs.aiSummary).toBe("Outlook");
    expect(restored.dropped).toEqual(expect.arrayContaining(["old knob", "Discount rate", "DCF retired option"]));
    expect(droppedNotice(restored.dropped)).toMatch(/old knob/);
    expect(droppedNotice([])).toBeNull();
  });
});
