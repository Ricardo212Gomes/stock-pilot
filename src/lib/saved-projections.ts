import { getSql } from "./db";
import { normalizeTicker } from "./fmp";
import { isSavedTool, SCHEMA_VERSIONS, type SavedTool, type SavedValue } from "./saved-projection-inputs";
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH, MAX_SAVED_PROJECTIONS } from "./saved-projection-limits";

// Saved projections (see docs/valuation.md, "Saved projections"), kept per Google account in Postgres.

export { MAX_NAME_LENGTH, MAX_NOTE_LENGTH, MAX_SAVED_PROJECTIONS };

// Every tool's inputs fit in a few kilobytes; anything far larger isn't one of them.
const MAX_INPUTS_BYTES = 64_000;

export type SavedProjection = {
  id: string;
  tool: SavedTool;
  symbol: string;
  name: string;
  note: string | null;
  inputs: unknown;
  schemaVersion: number;
  baseYear: number | null;
  priceAtSave: number | null;
  valueAtSave: SavedValue[];
  currency: string;
  createdAt: string;
  updatedAt: string;
};

// The list leaves the inputs out.
export type SavedProjectionSummary = Omit<SavedProjection, "inputs">;

type Row = {
  id: string | number;
  tool: string;
  symbol: string;
  name: string;
  note: string | null;
  inputs?: unknown;
  schema_version: number;
  base_year: number | null;
  price_at_save: string | number | null;
  value_at_save: unknown;
  currency: string;
  created_at: Date;
  updated_at: Date;
};

function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseValues(value: unknown): SavedValue[] {
  const list = typeof value === "string" ? safeJson(value) : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { id, label, value: amount } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof label !== "string") return [];
    return [{ id, label, value: typeof amount === "number" && Number.isFinite(amount) ? amount : null }];
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toSummary(row: Row): SavedProjectionSummary {
  return {
    id: String(row.id),
    tool: row.tool as SavedTool,
    symbol: row.symbol,
    name: row.name,
    note: row.note,
    schemaVersion: row.schema_version,
    baseYear: row.base_year,
    priceAtSave: toNumber(row.price_at_save),
    valueAtSave: parseValues(row.value_at_save),
    currency: row.currency,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// Ids are bigints, so anything else is no id at all.
function parseId(id: unknown): string | null {
  return typeof id === "string" && /^\d{1,18}$/.test(id) ? id : null;
}

// A user's saved projections, newest first; for one company and tool when they're given.
export async function listSavedProjections(
  userId: string,
  filter: { symbol?: string; tool?: SavedTool } = {},
): Promise<SavedProjectionSummary[]> {
  const symbol = filter.symbol ?? null;
  const tool = filter.tool ?? null;
  const rows = await getSql()<Row[]>`
    select id, tool, symbol, name, note, schema_version, base_year, price_at_save, value_at_save, currency, created_at, updated_at
    from saved_projections
    where user_id = ${userId}
      and (${symbol}::text is null or symbol = ${symbol})
      and (${tool}::text is null or tool = ${tool})
    order by updated_at desc
    limit ${MAX_SAVED_PROJECTIONS}
  `;
  return rows.map(toSummary);
}

export async function getSavedProjection(userId: string, rawId: unknown): Promise<SavedProjection | null> {
  const id = parseId(rawId);
  if (!id) return null;
  const rows = await getSql()<Row[]>`
    select id, tool, symbol, name, note, inputs, schema_version, base_year, price_at_save, value_at_save, currency, created_at, updated_at
    from saved_projections where user_id = ${userId} and id = ${id}
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return { ...toSummary(row), inputs: typeof row.inputs === "string" ? safeJson(row.inputs) : row.inputs };
}

export type SaveInput = {
  tool: unknown;
  symbol: unknown;
  name: unknown;
  note: unknown;
  inputs: unknown;
  baseYear: unknown;
  priceAtSave: unknown;
  valueAtSave: unknown;
  currency: unknown;
};

export type SaveFailure = "invalid" | "limit" | "not-found";
export type SaveResult = { ok: true; id: string } | { ok: false; reason: SaveFailure; message: string };

type CleanSave = {
  tool: SavedTool;
  symbol: string;
  name: string;
  note: string | null;
  inputs: string;
  baseYear: number | null;
  priceAtSave: number | null;
  valueAtSave: string;
  currency: string;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Checks everything the browser sent; the user always comes from the session.
export function cleanSave(input: SaveInput): { ok: true; save: CleanSave } | { ok: false; message: string } {
  if (!isSavedTool(input.tool)) return { ok: false, message: "That isn't a valuation tool." };
  const symbol = normalizeTicker(input.symbol);
  if (!symbol) return { ok: false, message: "That isn't a valid ticker." };
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (!name) return { ok: false, message: "Give the projection a name." };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, message: `Keep the name under ${MAX_NAME_LENGTH} characters.` };
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
  if (note && note.length > MAX_NOTE_LENGTH) return { ok: false, message: `Keep the note under ${MAX_NOTE_LENGTH} characters.` };
  if (typeof input.inputs !== "object" || input.inputs === null || Array.isArray(input.inputs)) {
    return { ok: false, message: "There's nothing to save." };
  }
  const inputs = JSON.stringify(input.inputs);
  if (inputs.length > MAX_INPUTS_BYTES) return { ok: false, message: "This projection is too large to save." };
  const baseYear = finite(input.baseYear);
  const values = parseValues(input.valueAtSave);
  return {
    ok: true,
    save: {
      tool: input.tool,
      symbol,
      name,
      note,
      inputs,
      baseYear: baseYear !== null && Number.isInteger(baseYear) ? baseYear : null,
      priceAtSave: finite(input.priceAtSave),
      valueAtSave: JSON.stringify(values),
      currency: typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency) ? input.currency : "USD",
    },
  };
}

export async function createSavedProjection(userId: string, input: SaveInput): Promise<SaveResult> {
  const cleaned = cleanSave(input);
  if (!cleaned.ok) return { ok: false, reason: "invalid", message: cleaned.message };
  const { save } = cleaned;
  const sql = getSql();
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from saved_projections where user_id = ${userId}`;
  if (count >= MAX_SAVED_PROJECTIONS) {
    return { ok: false, reason: "limit", message: `You can keep up to ${MAX_SAVED_PROJECTIONS} saved projections. Delete one first.` };
  }
  const rows = await sql<{ id: string | number }[]>`
    insert into saved_projections (user_id, tool, symbol, name, note, inputs, schema_version, base_year, price_at_save, value_at_save, currency)
    values (${userId}, ${save.tool}, ${save.symbol}, ${save.name}, ${save.note}, ${save.inputs}::jsonb, ${SCHEMA_VERSIONS[save.tool]},
      ${save.baseYear}, ${save.priceAtSave}, ${save.valueAtSave}::jsonb, ${save.currency})
    returning id
  `;
  return { ok: true, id: String(rows[0].id) };
}

// Saving again over an opened projection: new inputs, values and price, the same id. The tool and company stay.
export async function updateSavedProjection(userId: string, rawId: unknown, input: SaveInput): Promise<SaveResult> {
  const id = parseId(rawId);
  if (!id) return { ok: false, reason: "not-found", message: "That saved projection no longer exists." };
  const cleaned = cleanSave(input);
  if (!cleaned.ok) return { ok: false, reason: "invalid", message: cleaned.message };
  const { save } = cleaned;
  const rows = await getSql()<{ id: string | number }[]>`
    update saved_projections set
      name = ${save.name}, note = ${save.note}, inputs = ${save.inputs}::jsonb, schema_version = ${SCHEMA_VERSIONS[save.tool]},
      base_year = ${save.baseYear}, price_at_save = ${save.priceAtSave}, value_at_save = ${save.valueAtSave}::jsonb,
      currency = ${save.currency}, updated_at = now()
    where user_id = ${userId} and id = ${id} and tool = ${save.tool} and symbol = ${save.symbol}
    returning id
  `;
  if (rows.length === 0) return { ok: false, reason: "not-found", message: "That saved projection no longer exists." };
  return { ok: true, id };
}

export async function renameSavedProjection(userId: string, rawId: unknown, rawName: unknown): Promise<SaveResult> {
  const id = parseId(rawId);
  if (!id) return { ok: false, reason: "not-found", message: "That saved projection no longer exists." };
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  if (!name) return { ok: false, reason: "invalid", message: "Give the projection a name." };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: "invalid", message: `Keep the name under ${MAX_NAME_LENGTH} characters.` };
  const rows = await getSql()<{ id: string | number }[]>`
    update saved_projections set name = ${name}, updated_at = now() where user_id = ${userId} and id = ${id} returning id
  `;
  if (rows.length === 0) return { ok: false, reason: "not-found", message: "That saved projection no longer exists." };
  return { ok: true, id };
}

export async function deleteSavedProjection(userId: string, rawId: unknown): Promise<boolean> {
  const id = parseId(rawId);
  if (!id) return false;
  const rows = await getSql()`delete from saved_projections where user_id = ${userId} and id = ${id} returning id`;
  return rows.length > 0;
}
