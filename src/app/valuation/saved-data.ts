import { currentUserId, isAuthConfigured } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { migrateInputs, type SavedTool } from "@/lib/saved-projection-inputs";
import { getSavedProjection, listSavedProjections, type SavedProjectionSummary } from "@/lib/saved-projections";

// A saved projection opened in its tool (?saved=ID): its inputs brought up to the tool's current version.
export type OpenedProjection = {
  id: string;
  name: string;
  note: string | null;
  baseYear: number | null;
  updatedAt: string;
  inputs: Record<string, unknown>;
  // Inputs the migration left out because the tool no longer has them.
  dropped: string[];
};

// Whether the Save button can save, or should offer to sign in; hidden while sign-in or the database isn't set up.
export type SaveStatus = "ready" | "signed-out" | "unavailable";

export type SavingContext = {
  status: SaveStatus;
  opened: OpenedProjection | null;
  // Why ?saved=ID didn't open, if it didn't.
  openError: string | null;
  // This company's saves in this tool, newest first.
  list: SavedProjectionSummary[];
  listError: boolean;
};

export async function loadSaving(symbol: string, tool: SavedTool, savedParam: string | string[] | undefined): Promise<SavingContext> {
  const empty: SavingContext = { status: "unavailable", opened: null, openError: null, list: [], listError: false };
  if (!isAuthConfigured() || !isDatabaseConfigured()) return empty;
  const userId = await currentUserId();
  const wanted = typeof savedParam === "string" ? savedParam : null;
  if (!userId) {
    return { ...empty, status: "signed-out", openError: wanted ? "Sign in to open your saved projection." : null };
  }

  try {
    const [list, record] = await Promise.all([
      listSavedProjections(userId, { symbol, tool }),
      wanted ? getSavedProjection(userId, wanted) : Promise.resolve(null),
    ]);
    let opened: OpenedProjection | null = null;
    let openError: string | null = null;
    if (wanted) {
      if (!record || record.tool !== tool || record.symbol !== symbol) {
        openError = "That saved projection wasn't found. It may have been deleted.";
      } else {
        const migrated = migrateInputs(tool, record.schemaVersion, record.inputs);
        if (!migrated.ok) openError = migrated.reason;
        else {
          opened = {
            id: record.id,
            name: record.name,
            note: record.note,
            baseYear: record.baseYear,
            updatedAt: record.updatedAt,
            inputs: migrated.inputs,
            dropped: migrated.dropped,
          };
        }
      }
    }
    return { status: "ready", opened, openError, list, listError: false };
  } catch {
    return { status: "ready", opened: null, openError: wanted ? "Your saved projection couldn't be loaded. Check the database connection." : null, list: [], listError: true };
  }
}
