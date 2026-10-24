import { lookupCik, secHeaders } from "./sec";

// A company's SEC filings from EDGAR's free submissions API: annual and quarterly reports,
// earnings releases, other 8-K events, proxies and insider forms, with links to the documents.

const SUBMISSIONS_URL = "https://data.sec.gov/submissions";
const ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data";
// New filings appear within the day; the list (~150 KB) fits the Next.js data cache.
const FILINGS_REVALIDATE_SECONDS = 60 * 60 * 6;
// A filing never changes once it's made.
const INDEX_REVALIDATE_SECONDS = 60 * 60 * 24 * 30;

export type Filing = {
  accession: string;
  form: string;
  filed: string;
  // The period a report covers, or the event date of an 8-K.
  period: string | null;
  items: string[];
  description: string;
  documentUrl: string;
  indexUrl: string;
};

export type FilingType = "important" | "reports" | "earnings" | "events" | "proxy" | "insider";

export const FILING_TYPES: { id: FilingType; label: string }[] = [
  { id: "important", label: "Important" },
  { id: "reports", label: "Annual & quarterly" },
  { id: "earnings", label: "Earnings releases" },
  { id: "events", label: "Other events" },
  { id: "proxy", label: "Proxy" },
  { id: "insider", label: "Insider" },
];

export type FilingsResult =
  | { ok: true; data: { name: string; cik: string; filings: Filing[] } }
  | { ok: false; reason: "not-found" | "provider-error" };

const REPORT_FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "6-K"]);
const EVENT_FORMS = new Set(["8-K", "8-K/A"]);
const PROXY_FORMS = new Set(["DEF 14A", "DEFA14A", "PRE 14A", "DEFM14A"]);
const INSIDER_FORMS = new Set(["3", "4", "5", "3/A", "4/A", "5/A", "144", "144/A"]);
const OTHER_IMPORTANT = new Set(["S-1", "S-1/A", "S-3", "S-3ASR", "S-4", "424B4", "10-12B", "SC TO-T", "SC 13D", "SC 13D/A"]);

const FORM_DESCRIPTIONS: Record<string, string> = {
  "10-K": "Annual report",
  "10-K/A": "Annual report (amended)",
  "10-Q": "Quarterly report",
  "10-Q/A": "Quarterly report (amended)",
  "20-F": "Annual report (foreign company)",
  "40-F": "Annual report (Canadian company)",
  "6-K": "Report from a foreign company",
  "DEF 14A": "Proxy statement for the shareholder meeting",
  DEFA14A: "Additional proxy materials",
  "PRE 14A": "Preliminary proxy statement",
  DEFM14A: "Proxy statement for a merger",
  "3": "Insider's initial holdings",
  "4": "Insider trade",
  "4/A": "Insider trade (amended)",
  "5": "Insider's annual holdings report",
  "144": "Planned insider sale",
  "144/A": "Planned insider sale (amended)",
  "S-1": "Registration for a share offering",
  "S-3": "Shelf registration for securities",
  "S-3ASR": "Shelf registration for securities",
  "S-4": "Registration for a merger or exchange offer",
  "S-8": "Shares for an employee stock plan",
  "424B5": "Prospectus for an offering",
  "SC 13G": "A holder owns more than 5%",
  "SC 13G/A": "Update from a holder of more than 5%",
  "SCHEDULE 13G": "A holder owns more than 5%",
  "SCHEDULE 13G/A": "Update from a holder of more than 5%",
  "SC 13D": "Activist stake over 5%",
  "SC 13D/A": "Update to an activist stake",
  ARS: "Annual report to shareholders",
};

// 8-K item numbers, from the SEC's Form 8-K instructions.
const EIGHT_K_ITEMS: Record<string, string> = {
  "1.01": "New material agreement",
  "1.02": "Agreement ended",
  "1.05": "Cybersecurity incident",
  "2.01": "Acquisition or sale of assets completed",
  "2.02": "Earnings results",
  "2.03": "New debt or obligation",
  "2.05": "Restructuring or exit costs",
  "2.06": "Impairment",
  "3.01": "Listing notice or transfer",
  "3.02": "Unregistered share sale",
  "3.03": "Change to shareholders' rights",
  "4.01": "Auditor change",
  "4.02": "Earlier financials no longer reliable",
  "5.01": "Change in control",
  "5.02": "Executive or director change",
  "5.03": "Bylaws or fiscal year change",
  "5.07": "Shareholder vote results",
  "7.01": "Regulation FD disclosure",
  "8.01": "Other events",
};

export function describeFiling(form: string, items: string[], fallback: string): string {
  if (EVENT_FORMS.has(form)) {
    // 9.01 only lists the exhibits, so it's left out unless it's all there is.
    const described = items.filter((item) => item !== "9.01").map((item) => EIGHT_K_ITEMS[item]).filter(Boolean);
    const text = described.length ? described.join(" · ") : "Current report";
    return form === "8-K/A" ? `${text} (amended)` : text;
  }
  return FORM_DESCRIPTIONS[form] ?? (fallback || form);
}

export function isEarningsRelease(filing: Pick<Filing, "form" | "items">): boolean {
  return EVENT_FORMS.has(filing.form) && filing.items.includes("2.02");
}

export function filingMatches(filing: Filing, type: FilingType): boolean {
  switch (type) {
    case "reports":
      return REPORT_FORMS.has(filing.form);
    case "earnings":
      return isEarningsRelease(filing);
    case "events":
      return EVENT_FORMS.has(filing.form) && !isEarningsRelease(filing);
    case "proxy":
      return PROXY_FORMS.has(filing.form);
    case "insider":
      return INSIDER_FORMS.has(filing.form);
    default:
      return REPORT_FORMS.has(filing.form) || EVENT_FORMS.has(filing.form) || PROXY_FORMS.has(filing.form) || OTHER_IMPORTANT.has(filing.form);
  }
}

type RecentFilings = Record<string, unknown[] | undefined>;

// The submissions document's "recent" arrays (one value per filing, newest first) as filings.
export function parseSubmissions(document: unknown, cik: string): { name: string; filings: Filing[] } | null {
  const record = document as { name?: unknown; filings?: { recent?: RecentFilings } } | null;
  const recent = record?.filings?.recent;
  if (!recent || !Array.isArray(recent.accessionNumber)) return null;
  const at = (key: string, index: number) => {
    const value = recent[key]?.[index];
    return typeof value === "string" ? value : "";
  };
  const folder = String(Number(cik));
  const filings = recent.accessionNumber.flatMap((_, index): Filing[] => {
    const accession = at("accessionNumber", index);
    const form = at("form", index);
    if (!accession || !form) return [];
    const items = at("items", index).split(",").map((item) => item.trim()).filter(Boolean);
    const path = `${ARCHIVES_URL}/${folder}/${accession.replace(/-/g, "")}`;
    const document = at("primaryDocument", index);
    return [{
      accession,
      form,
      filed: at("filingDate", index),
      period: at("reportDate", index) || null,
      items,
      description: describeFiling(form, items, at("primaryDocDescription", index)),
      documentUrl: document ? `${path}/${document}` : `${path}/${accession}-index.htm`,
      indexUrl: `${path}/${accession}-index.htm`,
    }];
  });
  return { name: typeof record?.name === "string" ? record.name : "", filings };
}

export async function getFilings(symbol: string): Promise<FilingsResult> {
  try {
    const cik = await lookupCik(symbol);
    if (!cik) return { ok: false, reason: "not-found" };
    const response = await fetch(`${SUBMISSIONS_URL}/CIK${cik}.json`, {
      headers: secHeaders(),
      next: { revalidate: FILINGS_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, reason: response.status === 404 ? "not-found" : "provider-error" };
    const parsed = parseSubmissions(await response.json(), cik);
    return parsed ? { ok: true, data: { ...parsed, cik } } : { ok: false, reason: "provider-error" };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

// The press release attached to an earnings 8-K: exhibit 99.1, named like "…ex991.htm" or
// "…ex-99_1.htm". Found from the filing's file list; null if there's no such exhibit.
export async function pressReleaseUrl(filing: Filing): Promise<string | null> {
  const folder = filing.indexUrl.slice(0, filing.indexUrl.lastIndexOf("/"));
  try {
    const response = await fetch(`${folder}/index.json`, {
      headers: secHeaders(),
      next: { revalidate: INDEX_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { directory?: { item?: { name?: unknown }[] } };
    const names = (body.directory?.item ?? []).map((item) => (typeof item.name === "string" ? item.name : ""));
    // Exhibit 99 documents; 99.1 (the press release) first when there are several.
    const exhibits = names.filter((name) => /ex(?:hibit)?[-_]?99/i.test(name) && /\.html?$/i.test(name));
    const exhibit = exhibits.find((name) => /ex(?:hibit)?[-_]?99[-_.]?0?1(?!\d)/i.test(name)) ?? exhibits[0];
    return exhibit ? `${folder}/${exhibit}` : null;
  } catch {
    return null;
  }
}
