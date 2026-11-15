import Link from "next/link";
import { droppedNotice } from "@/lib/saved-projection-inputs";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Inside a tool while a saved projection is open: which one, from which fiscal year, and the way back to the draft.
export function OpenedBanner({
  name,
  updatedAt,
  draftHref,
  baseYear,
  latestYear,
  dropped,
}: {
  name: string;
  updatedAt: string;
  draftHref: string;
  // The fiscal year the save starts from, and the one the latest report starts from.
  baseYear: number | null;
  latestYear: number | null;
  dropped: string[];
}) {
  const notice = droppedNotice(dropped);
  return (
    <div className="saved-banner" role="status">
      <p>
        <strong>{name}</strong>, saved {DATE.format(new Date(updatedAt))}. Edits stay on this page until you save them;
        your browser draft is left as it was. <Link href={draftHref}>Back to your draft</Link>
      </p>
      {baseYear !== null && latestYear !== null && baseYear !== latestYear && (
        <p>
          This projection starts from fiscal {baseYear}, as when it was saved; the latest report is fiscal {latestYear}.
          Open your draft for a projection from the new report.
        </p>
      )}
      {notice && <p>{notice}</p>}
    </div>
  );
}
