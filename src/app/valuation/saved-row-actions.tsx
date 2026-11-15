"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_NAME_LENGTH } from "@/lib/saved-projection-limits";
import { deleteProjectionAction, renameProjectionAction } from "./saved-actions";

// Rename and delete for one saved projection. Deleting asks once more in place (no browser dialog), and deleting the
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
          <button className="assumptions-reset" type="submit" disabled={pending}>{pending ? "Saving…" : "Rename"}</button>
          <button className="saved-link-button" type="button" onClick={() => setMode("idle")}>Cancel</button>
        </form>
      ) : mode === "delete" ? (
        <span className="saved-confirm">
          <span>Delete it?</span>
          <button className="saved-danger" type="button" onClick={remove} disabled={pending}>{pending ? "Deleting…" : "Delete"}</button>
          <button className="saved-link-button" type="button" onClick={() => setMode("idle")}>Keep</button>
        </span>
      ) : (
        <>
          <button className="saved-link-button" type="button" onClick={() => { setValue(name); setMode("rename"); }} aria-label={`Rename ${name}`}>Rename</button>
          <button className="saved-link-button saved-link-danger" type="button" onClick={() => setMode("delete")} aria-label={`Delete ${name}`}>Delete</button>
        </>
      )}
      {error && <span className="favorite-error" role="alert">{error}</span>}
    </div>
  );
}
