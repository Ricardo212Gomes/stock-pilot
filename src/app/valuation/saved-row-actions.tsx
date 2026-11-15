"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_NAME_LENGTH } from "@/lib/saved-projection-limits";
import { InlineConfirm } from "../components/inline-confirm";
import { deleteProjectionAction, renameProjectionAction } from "./saved-actions";

// Rename and delete for one saved projection. Deleting asks once more in place (InlineConfirm), and deleting the
// projection that's open goes back to the browser draft.
export function SavedRowActions({ id, name, closeHref }: { id: string; name: string; closeHref: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function rename(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await renameProjectionAction(id, value);
      if (!result.ok) setError(result.error);
      else setMode("idle");
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteProjectionAction(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (closeHref) router.push(closeHref);
    });
  }

  return (
    <div className="saved-row-actions">
      {mode === "rename" ? (
        <form className="saved-rename" onSubmit={rename}>
          <input
            aria-label={`New name for ${name}`}
            value={value}
            maxLength={MAX_NAME_LENGTH}
            required
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setMode("idle"); }}
          />
          <button className="settings-button" type="submit" disabled={pending}>{pending ? "Saving…" : "Rename"}</button>
          <button className="text-button" type="button" onClick={() => setMode("idle")}>Cancel</button>
        </form>
      ) : mode === "delete" ? (
        <InlineConfirm question="Delete it?" pending={pending} onConfirm={remove} onCancel={() => setMode("idle")} />
      ) : (
        <>
          <button className="text-button" type="button" onClick={() => { setValue(name); setMode("rename"); }} aria-label={`Rename ${name}`}>Rename</button>
          <button className="text-button text-button-danger" type="button" onClick={() => setMode("delete")} aria-label={`Delete ${name}`}>Delete</button>
        </>
      )}
      {error && <span className="favorite-error" role="alert">{error}</span>}
    </div>
  );
}
