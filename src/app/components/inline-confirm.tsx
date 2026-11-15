"use client";

import { useEffect, useRef } from "react";

// Asks once more in place before something is deleted: "Delete it? Delete · Keep". Used instead of the browser's
// confirm dialog, which ignores the theme (see DESIGN.md, "Buttons, dialogs and confirmations"). Keep takes the focus,
// so Enter doesn't delete by accident, and Escape keeps.
export function InlineConfirm({
  question,
  confirmLabel = "Delete",
  pendingLabel = "Deleting…",
  pending,
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel?: string;
  pendingLabel?: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keep.current?.focus();
  }, []);

  return (
    <span
      className="inline-confirm"
      role="group"
      aria-label={question}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <span>{question}</span>
      <button className="inline-confirm-danger" type="button" onClick={onConfirm} disabled={pending}>
        {pending ? pendingLabel : confirmLabel}
      </button>
      <button ref={keep} className="text-button" type="button" onClick={onCancel} disabled={pending}>Keep</button>
    </span>
  );
}
