"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signInFromAction } from "../favorites/actions";
import { defaultSaveName, type SavedTool, type SavedValue } from "@/lib/saved-projection-inputs";
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from "@/lib/saved-projection-limits";
import { useModalDialog } from "../components/use-modal-dialog";
import { saveProjectionAction } from "./saved-actions";
import type { SaveStatus } from "./saved-data";

// What a tool hands over when the user saves: its inputs, and the value and price to compare later.
export type ProjectionSnapshot = {
  inputs: object;
  baseYear: number | null;
  priceAtSave: number | null;
  valueAtSave: SavedValue[];
  currency: string;
};

type Draft = { name: string; note: string };

// The Save button on each valuation tool, with its dialog. Without sign-in it offers to sign in.
export function SaveProjection({
  tool,
  symbol,
  status,
  opened,
  snapshot,
}: {
  tool: SavedTool;
  symbol: string;
  status: SaveStatus;
  opened: { id: string; name: string; note: string | null } | null;
  snapshot: () => ProjectionSnapshot;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { dialog, shown } = useModalDialog(draft);
  const ids = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const isOpen = draft !== null;

  // Runs after the dialog opens (useModalDialog's effect comes first), which otherwise focuses its close button.
  useEffect(() => {
    if (isOpen) nameField.current?.select();
  }, [isOpen]);

  if (status === "unavailable") return null;

  function open() {
    setError(null);
    if (status === "signed-out") {
      startTransition(async () => {
        await signInFromAction(`${window.location.pathname}${window.location.search}`);
      });
      return;
    }
    setDraft({ name: opened?.name ?? defaultSaveName(symbol, tool), note: opened?.note ?? "" });
  }

  function save(asNew: boolean) {
    if (!draft) return;
    setError(null);
    const name = asNew && opened && draft.name.trim() === opened.name ? `${opened.name} (copy)` : draft.name;
    startTransition(async () => {
      const result = await saveProjectionAction({
        ...snapshot(),
        tool,
        symbol,
        name,
        note: draft.note,
        id: asNew ? null : opened?.id ?? null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft(null);
      setSavedAt(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
      // A new save opens, so the next save updates it.
      if (asNew || !opened) router.push(`${pathname}?symbol=${encodeURIComponent(symbol)}&saved=${result.id}`);
    });
  }

  const label = status === "signed-out" ? "Sign in to save" : opened ? "Save…" : "Save";
  return (
    <>
      <button
        className="assumptions-reset saved-save-button"
        type="button"
        onClick={open}
        disabled={pending && draft === null}
        title={status === "signed-out" ? "Saved projections are kept in your Google account" : "Save this projection under a name"}
      >
        {label}
      </button>
      {savedAt && !draft && <span className="saved-confirmation" role="status">Saved at {savedAt}</span>}
      <dialog
        ref={dialog}
        className="earnings-dialog saved-dialog"
        onClose={() => setDraft(null)}
        onClick={(click) => { if (click.target === dialog.current) setDraft(null); }}
        aria-labelledby={`${ids}-title`}
      >
        {shown && (
          <form
            className="earnings-dialog-body saved-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              save(!opened);
            }}
          >
            <div className="earnings-dialog-heading">
              <h2 id={`${ids}-title`}>{opened ? "Save projection" : "Save this projection"}</h2>
              <button type="button" className="ai-review-close" onClick={() => setDraft(null)} aria-label="Close">×</button>
            </div>
            <p className="saved-dialog-help">
              {opened
                ? <>Update <strong>{opened.name}</strong> with what&apos;s on screen now, or keep it and save a copy under a new name.</>
                : "Saved to your account with today's price, so you can open it on any device and see how it compares later."}
            </p>
            <label className="saved-field" htmlFor={`${ids}-name`}>
              <span>Name</span>
              <input
                id={`${ids}-name`}
                value={draft?.name ?? shown.name}
                maxLength={MAX_NAME_LENGTH}
                required
                ref={nameField}
                onChange={(event) => setDraft((current) => current && { ...current, name: event.target.value })}
              />
            </label>
            <label className="saved-field" htmlFor={`${ids}-note`}>
              <span>Note <small>(optional)</small></span>
              <textarea
                id={`${ids}-note`}
                rows={3}
                value={draft?.note ?? shown.note}
                maxLength={MAX_NOTE_LENGTH}
                placeholder="Why you think this, what to watch for…"
                onChange={(event) => setDraft((current) => current && { ...current, note: event.target.value })}
              />
            </label>
            {error && <p className="ai-analysis-error" role="alert">{error}</p>}
            {/* Dialog actions: right-aligned, the main one last (DESIGN.md, "Buttons, dialogs and confirmations"). */}
            <div className="dialog-actions">
              <button className="settings-button settings-button-quiet" type="button" disabled={pending} onClick={() => setDraft(null)}>Cancel</button>
              {opened && (
                <button className="settings-button settings-button-quiet" type="button" disabled={pending} onClick={() => save(true)}>Save as a copy</button>
              )}
              <button className="settings-button" type="submit" disabled={pending}>{pending ? "Saving…" : opened ? "Update" : "Save"}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
