"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

// A row of the AI reviews table that opens the review wherever it's clicked. The company cell keeps a real link,
// so keyboards and screen readers reach the review the usual way; clicks on links inside are left to them, and a
// click while selecting text doesn't navigate.
export function ReviewRow({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className={["portfolio-review-row", className].filter(Boolean).join(" ")}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a") || window.getSelection()?.toString()) return;
        if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
        else router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
