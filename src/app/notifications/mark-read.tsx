"use client";

import { useTransition } from "react";
import { markAllReadAction, markReadAction } from "./inbox-actions";

// Mark one notification, or all of them, as read; the page refreshes with the new state.
export function MarkReadButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" className="text-button" disabled={pending} onClick={() => startTransition(async () => { await markReadAction([id]); })}>
      {pending ? "Marking…" : "Mark as read"}
    </button>
  );
}

export function MarkAllReadButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" className="settings-button settings-button-quiet" disabled={pending} onClick={() => startTransition(async () => { await markAllReadAction(); })}>
      {pending ? "Marking…" : "Mark all as read"}
    </button>
  );
}
