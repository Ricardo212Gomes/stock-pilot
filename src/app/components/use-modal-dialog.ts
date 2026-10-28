"use client";

import { useEffect, useRef, useState } from "react";

// The control behind the latest click, so a dialog can grow out of it and shrink back into it.
let opener: DOMRect | null = null;

function rememberOpener(click: MouseEvent) {
  const control = click.target instanceof Element ? click.target.closest("button, a, [role='button']") : null;
  opener = control ? control.getBoundingClientRect() : null;
}

// Shows a modal <dialog> while `item` is set. The last item stays rendered while the dialog animates
// out, and the dialog's transform origin points at the control that opened it (`--dialog-origin`).
export function useModalDialog<T>(item: T | null) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState(item);
  if (item !== null && item !== shown) setShown(item);

  useEffect(() => {
    document.addEventListener("click", rememberOpener, true);
    return () => document.removeEventListener("click", rememberOpener, true);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (item !== null && !element.open) {
      element.showModal();
      if (opener) {
        const box = element.getBoundingClientRect();
        const x = opener.left + opener.width / 2 - box.left;
        const y = opener.top + opener.height / 2 - box.top;
        element.style.setProperty("--dialog-origin", `${x}px ${y}px`);
      } else {
        element.style.removeProperty("--dialog-origin");
      }
    }
    if (item === null && element.open) element.close();
  }, [item]);

  return { dialog, shown };
}
