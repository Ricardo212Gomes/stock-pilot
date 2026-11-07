// The official calendars behind the events timeline: the Fed's FOMC meetings, the fed funds target from
// FRED, BLS's and BEA's release calendars, Census's economic indicators and Wikipedia's national electoral
// calendar. Each loader returns null when its source fails, so the page can say which one is missing.

// Release schedules change a few times a year; the target range only on decision days.
const SCHEDULE_REVALIDATE_SECONDS = 60 * 60 * 24;
const TARGET_REVALIDATE_SECONDS = 60 * 60 * 6;
// FRED and BLS turn away requests without a User-Agent they accept; this one works for every source.
const USER_AGENT = "StockPilot/1.0 (personal stock research app)";

export const SOURCE_URLS = {
  fomc: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
  fedTarget: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU,DFEDTARL",
  bls: "https://www.bls.gov/schedule/news_release/bls.ics",
  bea: "https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics",
  beaSchedule: "https://www.bea.gov/news/schedule",
  // The default page lists the newest year's schedule; earlier years have their own.
  census: (year?: number) => `https://www.census.gov/economic-indicators/calendar-listview${year ? `-${year}` : ""}.html`,
  electoralCalendar: (year: number) => `https://en.wikipedia.org/wiki/${year}_national_electoral_calendar`,
};

async function fetchText(url: string, revalidate = SCHEDULE_REVALIDATE_SECONDS): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate },
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// "April", "Apr" or "apr." → 3; -1 when it isn't a month.
export function monthIndex(name: string): number {
  const key = name.trim().toLowerCase().replace(/\.$/, "");
  return key.length >= 3 ? MONTHS.findIndex((month) => month.startsWith(key)) : -1;
}

export function isoDate(year: number, monthZeroBased: number, day: number): string {
  return `${year}-${String(monthZeroBased + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function decodeHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

// "8:30 AM" from 8 and 30.
function clockTime(hours: number, minutes: number): string {
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

// --- FOMC meetings ---------------------------------------------------------------------------------

export type FomcMeeting = {
  start: string;
  // The decision day: the statement comes out at 2:00 PM ET on the meeting's last day.
  end: string;
  // Meetings marked * publish the Summary of Economic Projections (the "dot plot").
  projections: boolean;
};

// Reads the Fed's meeting calendar, a panel per year with rows like "March" / "17-18*". Notation votes
// and unscheduled calls, which have notes in brackets, aren't regular meetings and are left out.
export function parseFomcCalendar(html: string): FomcMeeting[] {
  const panels = html.split(/<h4><a id="\d+">(\d{4}) FOMC Meetings<\/a><\/h4>/);
  const meetings = new Map<string, FomcMeeting>();
  const row = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>\s*<\/div>\s*<div class="fomc-meeting__date[^"]*">([^<]+)<\/div>/g;
  for (let index = 1; index < panels.length; index += 2) {
    const year = Number(panels[index]);
    for (const [, monthText, dateText] of panels[index + 1].matchAll(row)) {
      if (dateText.includes("(")) continue;
      const days = /^\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*(\*)?\s*$/.exec(dateText);
      // A meeting across two months reads "April/May" and "30-1".
      const [startName, endName = startName] = decodeHtml(monthText).split("/");
      const startMonth = monthIndex(startName);
      const endMonth = monthIndex(endName);
      if (!days || startMonth < 0 || endMonth < 0) continue;
      const meeting = {
        start: isoDate(year, startMonth, Number(days[1])),
        end: isoDate(endMonth < startMonth ? year + 1 : year, endMonth, Number(days[2] ?? days[1])),
        projections: days[3] === "*",
      };
      meetings.set(meeting.end, meeting);
    }
  }
  return [...meetings.values()].sort((left, right) => left.end.localeCompare(right.end));
}

export async function getFomcMeetings(): Promise<FomcMeeting[] | null> {
  const html = await fetchText(SOURCE_URLS.fomc);
  const meetings = html ? parseFomcCalendar(html) : [];
  return meetings.length > 0 ? meetings : null;
}

// --- Fed funds target range -------------------------------------------------------------------------

export type FedTarget = {
  // Each change of the target range, oldest first: the day it took effect and the new range in percent.
  changes: { date: string; lower: number; upper: number }[];
  // The last day FRED has a value for.
  asOf: string;
};

// FRED's CSV of the target range's upper and lower limits, one row per day since 2008.
export function parseFedTarget(csv: string): FedTarget | null {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const columns = header.split(",");
  const upperColumn = columns.indexOf("DFEDTARU");
  const lowerColumn = columns.indexOf("DFEDTARL");
  if (upperColumn < 0 || lowerColumn < 0) return null;

  const changes: FedTarget["changes"] = [];
  let asOf = "";
  for (const line of lines) {
    const cells = line.split(",");
    // Missing days are "." (or empty), never zero.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0]) || !/^\d/.test(cells[upperColumn] ?? "") || !/^\d/.test(cells[lowerColumn] ?? "")) continue;
    const upper = Number(cells[upperColumn]);
    const lower = Number(cells[lowerColumn]);
    asOf = cells[0];
    const last = changes.at(-1);
    if (!last || last.upper !== upper || last.lower !== lower) changes.push({ date: cells[0], lower, upper });
  }
  return changes.length > 0 ? { changes, asOf } : null;
}

export async function getFedTarget(): Promise<FedTarget | null> {
  const csv = await fetchText(SOURCE_URLS.fedTarget, TARGET_REVALIDATE_SECONDS);
  return csv ? parseFedTarget(csv) : null;
}

export type DecisionOutcome = { action: "raised" | "lowered" | "held"; lower: number; upper: number; change: number };

export function addDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// What a past meeting decided: a new range takes effect the day after the decision, so a change within
// the following week is that meeting's. Null when FRED's data doesn't reach past the decision yet.
export function decisionOutcome(decisionDate: string, target: FedTarget): DecisionOutcome | null {
  if (target.asOf <= decisionDate) return null;
  const before = target.changes.filter((change) => change.date <= decisionDate).at(-1);
  if (!before) return null;
  const after = target.changes.find((change) => change.date > decisionDate && change.date <= addDays(decisionDate, 7));
  if (!after) return { action: "held", lower: before.lower, upper: before.upper, change: 0 };
  const change = Math.round((after.upper - before.upper) * 100) / 100;
  return { action: change > 0 ? "raised" : change < 0 ? "lowered" : "held", lower: after.lower, upper: after.upper, change };
}

// --- iCalendar feeds (BLS, BEA) --------------------------------------------------------------------

export type CalendarEntry = { date: string; time: string | null; summary: string };

const EASTERN = "America/New_York";

// A calendar time as the New York date and clock time: UTC times ("…Z") are converted, local ones (BLS
// writes TZID=US-Eastern) are already Eastern, and plain dates have no time.
export function easternDateTime(value: string): { date: string; time: string | null } | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hours, minutes, , utc] = match;
  if (!hours) return { date: `${year}-${month}-${day}`, time: null };
  if (!utc) return { date: `${year}-${month}-${day}`, time: clockTime(Number(hours), Number(minutes)) };

  const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)));
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: EASTERN, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: clockTime(Number(parts.hour), Number(parts.minute)) };
}

// Each VEVENT's start and summary. Long lines are folded onto lines starting with a space, and commas
// and semicolons are escaped with a backslash.
export function parseIcs(text: string): CalendarEntry[] {
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  return unfolded.split("BEGIN:VEVENT").slice(1).flatMap((block): CalendarEntry[] => {
    const fields = new Map<string, string>();
    for (const line of block.split("END:VEVENT")[0].split("\n")) {
      const colon = line.indexOf(":");
      if (colon > 0) fields.set(line.slice(0, colon).split(";")[0].toUpperCase(), line.slice(colon + 1));
    }
    const start = easternDateTime(fields.get("DTSTART") ?? "");
    const summary = (fields.get("SUMMARY") ?? "").replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ").trim();
    return start && summary ? [{ ...start, summary }] : [];
  });
}

export async function getCalendarFeed(url: string): Promise<CalendarEntry[] | null> {
  const text = await fetchText(url);
  const entries = text ? parseIcs(text) : [];
  return entries.length > 0 ? entries : null;
}

// --- Census economic indicators ----------------------------------------------------------------------

export type CensusRelease = { indicator: string; date: string; time: string | null; period: string };

// The list view's table: indicator, release date ("January 14, 2026"), time ("8:30 AM") and period.
export function parseCensusCalendar(html: string): CensusRelease[] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(([, row]): CensusRelease[] => {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, cell]) => decodeHtml(cell));
    const date = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(cells[1] ?? "");
    if (cells.length < 4 || !date || monthIndex(date[1]) < 0) return [];
    const time = /^(\d{1,2}):(\d{2}) ?([AP])M$/i.exec(cells[2]);
    const hours = time ? (Number(time[1]) % 12) + (time[3].toUpperCase() === "P" ? 12 : 0) : 0;
    return [{
      indicator: cells[0],
      date: isoDate(Number(date[3]), monthIndex(date[1]), Number(date[2])),
      time: time ? clockTime(hours, Number(time[2])) : null,
      period: cells[3],
    }];
  });
}

export async function getCensusReleases(year: number): Promise<CensusRelease[] | null> {
  const pages = await Promise.all([fetchText(SOURCE_URLS.census(year)), fetchText(SOURCE_URLS.census())]);
  const seen = new Set<string>();
  const releases = pages.flatMap((html) => (html ? parseCensusCalendar(html) : [])).filter((release) => {
    const key = `${release.indicator}|${release.date}`;
    return !seen.has(key) && seen.add(key);
  });
  return releases.length > 0 ? releases : null;
}

// --- National elections (Wikipedia) --------------------------------------------------------------------

export type NationalElection = {
  // The first day of voting; for a month-only entry, the first of the month.
  date: string;
  // Only the month is known so far.
  monthOnly: boolean;
  country: string;
  // The election's Wikipedia article, e.g. "2027 French presidential election".
  article: string;
  // What's being elected, e.g. "President, Senate and Chamber of Deputies".
  offices: string;
};

function wikiLinks(text: string): { target: string; label: string }[] {
  return [...text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map(([, target, label]) => ({ target: target.trim(), label: (label ?? target).trim() }));
}

// Wikipedia's "YYYY national electoral calendar": a section per month with lines like
// "* 18 April:" followed by "** [[Elections in France|France]], [[2027 French presidential election|President]]".
// Italic entries are partly recognised states, and the indirect and unknown-date sections are skipped.
export function parseElectoralCalendar(wikitext: string, year: number): NationalElection[] {
  const text = wikitext.replace(/<!--[\s\S]*?-->/g, "").replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
  const elections: NationalElection[] = [];
  let sectionMonth = -1;
  let pendingDate: string | null = null;

  const add = (dateText: string, entry: string) => {
    if (entry.trim().startsWith("''")) return;
    const date = /^(?:(\d{1,2})(?:\s*[–-]\s*\d{1,2})?\s+)?([A-Za-z]+)$/.exec(dateText.trim());
    const month = date ? monthIndex(date[2]) : -1;
    const [country, election] = wikiLinks(entry);
    if (!date || month < 0 || !country || !election) return;
    elections.push({
      date: isoDate(year, month, date[1] ? Number(date[1]) : 1),
      monthOnly: !date[1],
      country: country.label.replace(/^Elections in (the )?/, ""),
      article: election.target,
      offices: election.label,
    });
  };

  for (const line of text.split("\n")) {
    const heading = /^==\s*([^=]+?)\s*==\s*$/.exec(line);
    if (heading) {
      sectionMonth = monthIndex(heading[1]);
      pendingDate = null;
      continue;
    }
    if (sectionMonth < 0) continue;
    const nested = /^\*\*\s*(.+)$/.exec(line);
    if (nested) {
      if (pendingDate) add(pendingDate, nested[1]);
      continue;
    }
    const bullet = /^\*\s*([^:[\]]+?)\s*:\s*(.*)$/.exec(line);
    if (!bullet) continue;
    pendingDate = bullet[1];
    if (bullet[2].trim()) add(bullet[1], bullet[2]);
  }
  return elections;
}

export async function getNationalElections(year: number): Promise<NationalElection[] | null> {
  const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({
    action: "parse",
    page: `${year}_national_electoral_calendar`,
    prop: "wikitext",
    format: "json",
    formatversion: "2",
  })}`;
  const json = await fetchText(url);
  if (!json) return null;
  try {
    const wikitext = (JSON.parse(json) as { parse?: { wikitext?: unknown } }).parse?.wikitext;
    return typeof wikitext === "string" ? parseElectoralCalendar(wikitext, year) : null;
  } catch {
    return null;
  }
}
