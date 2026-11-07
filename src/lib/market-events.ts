import {
  addDays,
  decisionOutcome,
  getCalendarFeed,
  getCensusReleases,
  getFedTarget,
  getFomcMeetings,
  getNationalElections,
  isoDate,
  SOURCE_URLS,
  type CalendarEntry,
  type CensusRelease,
  type DecisionOutcome,
  type FedTarget,
  type FomcMeeting,
  type NationalElection,
} from "./event-sources";

// Scheduled events that can move US markets: Fed decisions and key data releases from the official
// calendars, elections and deadlines set by law, and national elections in major economies. Events the
// news mentions (summits, trade deadlines) come from the AI scan in news-events.ts, on request.

export type EventCategory = "fed" | "data" | "politics" | "global";

export const EVENT_CATEGORIES: { id: EventCategory; label: string }[] = [
  { id: "fed", label: "Fed & rates" },
  { id: "data", label: "Economic data" },
  { id: "politics", label: "US politics" },
  { id: "global", label: "Global" },
];

export type MarketEvent = {
  id: string;
  // What it is, for picking "the next CPI report" and the like: "fomc", "cpi", "jobs", "election"…
  kind: string;
  // The day it happens; Eastern time for US releases.
  date: string;
  endDate: string | null;
  // Only the month is known so far; `date` is then the first of it.
  monthOnly: boolean;
  // Eastern time, e.g. "8:30 AM"; null for all-day events.
  time: string | null;
  category: EventCategory;
  importance: "high" | "medium";
  title: string;
  detail: string | null;
  // For a past Fed decision, what it did.
  outcome: string | null;
  tags: string[];
  source: { label: string; url: string };
  // Found in the news by the AI scan rather than an official calendar.
  ai: boolean;
};

type EventInput = Pick<MarketEvent, "kind" | "date" | "category" | "importance" | "title" | "source"> & Partial<MarketEvent>;

export function marketEvent(input: EventInput): MarketEvent {
  return {
    id: `${input.kind}-${input.date}-${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    endDate: null,
    monthOnly: false,
    time: null,
    detail: null,
    outcome: null,
    tags: [],
    ai: false,
    ...input,
  };
}

function monthDay(isoDay: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${isoDay}T12:00:00Z`));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

// "Today", "In 3 days", "2 days ago".
export function countdown(today: string, date: string): string {
  const days = daysBetween(today, date);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

// Today in New York, where the US calendars run.
export function easternToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

// --- Fed --------------------------------------------------------------------------------------------

const FED_SOURCE = { label: "Federal Reserve", url: SOURCE_URLS.fomc };

export function formatRange(lower: number, upper: number): string {
  return `${lower.toFixed(2)}–${upper.toFixed(2)}%`;
}

export function describeOutcome(outcome: DecisionOutcome): string {
  const size = `${Math.abs(outcome.change).toFixed(2)} pt`;
  const range = formatRange(outcome.lower, outcome.upper);
  if (outcome.action === "raised") return `Raised by ${size} to ${range}`;
  if (outcome.action === "lowered") return `Cut by ${size} to ${range}`;
  return `Held at ${range}`;
}

export function fedEvents(meetings: FomcMeeting[], target: FedTarget | null, today: string): MarketEvent[] {
  return meetings.flatMap((meeting) => {
    const outcome = target && meeting.end < today ? decisionOutcome(meeting.end, target) : null;
    const span = meeting.start === meeting.end ? monthDay(meeting.end) : `${monthDay(meeting.start)}–${monthDay(meeting.end)}`;
    // The Fed publishes the minutes three weeks after each decision, at 2:00 PM.
    const minutesDate = addDays(meeting.end, 21);
    return [
      marketEvent({
        kind: "fomc",
        date: meeting.end,
        time: "2:00 PM",
        category: "fed",
        importance: "high",
        title: "Fed rate decision",
        detail: `FOMC meeting ${span}: the policy statement at 2:00 PM ET, then the Chair's press conference.${meeting.projections ? " Comes with new economic projections and the dot plot." : ""}`,
        outcome: outcome ? describeOutcome(outcome) : null,
        tags: meeting.projections ? ["Projections"] : [],
        source: FED_SOURCE,
      }),
      marketEvent({
        kind: "fomc-minutes",
        date: minutesDate,
        time: "2:00 PM",
        category: "fed",
        importance: "medium",
        title: "Fed meeting minutes",
        detail: `The record of the ${monthDay(meeting.end)} meeting: how officials argued the decision.`,
        source: FED_SOURCE,
      }),
    ];
  });
}

// --- Economic data ------------------------------------------------------------------------------------

type Release = { kind: string; title: string; importance: MarketEvent["importance"]; detail: string };

const BLS_RELEASES: Record<string, Release & { page: string }> = {
  "Employment Situation": { kind: "jobs", page: "empsit", title: "Jobs report", importance: "high", detail: "Payrolls, the unemployment rate and wage growth for the month before." },
  "Consumer Price Index": { kind: "cpi", page: "cpi", title: "CPI inflation", importance: "high", detail: "Consumer prices for the month before: the most watched inflation reading." },
  "Producer Price Index": { kind: "ppi", page: "ppi", title: "Producer prices (PPI)", importance: "medium", detail: "What businesses charge for goods and services: inflation further up the pipeline." },
  "Job Openings and Labor Turnover Survey": { kind: "jolts", page: "jolts", title: "Job openings (JOLTS)", importance: "medium", detail: "Openings, hires and quits: how tight the labor market is." },
  "Employment Cost Index": { kind: "eci", page: "eci", title: "Employment Cost Index", importance: "medium", detail: "Quarterly wages and benefits, a measure of wage pressure the Fed watches." },
};

export function blsEvents(entries: CalendarEntry[]): MarketEvent[] {
  return entries.flatMap((entry) => {
    const release = BLS_RELEASES[entry.summary];
    if (!release) return [];
    return [marketEvent({
      kind: release.kind,
      title: release.title,
      importance: release.importance,
      detail: release.detail,
      date: entry.date,
      time: entry.time,
      category: "data",
      source: { label: "Bureau of Labor Statistics", url: `https://www.bls.gov/schedule/news_release/${release.page}.htm` },
    })];
  });
}

const BEA_SOURCE = { label: "Bureau of Economic Analysis", url: SOURCE_URLS.beaSchedule };

// GDP estimates and the monthly Personal Income and Outlays report (PCE inflation); BEA's other releases
// rarely move markets.
export function beaEvents(entries: CalendarEntry[]): MarketEvent[] {
  return entries.flatMap((entry): MarketEvent[] => {
    const { summary } = entry;
    const base = { date: entry.date, time: entry.time, category: "data" as const, source: BEA_SOURCE };
    if (/^Personal Income and Outlays/i.test(summary)) {
      const period = summary.split(",").slice(1).join(",").trim();
      return [marketEvent({
        ...base,
        kind: "pce",
        importance: "high",
        title: `PCE inflation and spending${period ? `, ${period}` : ""}`,
        detail: "The PCE price index, the Fed's preferred inflation gauge, with incomes and consumer spending.",
      })];
    }
    if (/^(GDP|Gross Domestic Product)\b/i.test(summary) && !/\bby (County|State)\b/i.test(summary)) {
      const estimate = /advance/i.test(summary) ? "advance" : /second/i.test(summary) ? "second" : /third/i.test(summary) ? "third" : null;
      const quarter = /(\d)(?:st|nd|rd|th) Quarter(?: and Year)? (\d{4})/i.exec(summary);
      return [marketEvent({
        ...base,
        kind: "gdp",
        importance: estimate === "advance" ? "high" : "medium",
        title: `GDP${quarter ? `, Q${quarter[1]} ${quarter[2]}` : ""}${estimate ? ` (${estimate} estimate)` : ""}`,
        detail: estimate === "advance" ? "The first estimate of how fast the economy grew last quarter." : "A revised estimate of last quarter's growth.",
      })];
    }
    return [];
  });
}

const CENSUS_RELEASES: (Release & { match: RegExp })[] = [
  { match: /^Advance Monthly Sales for Retail and Food Services/i, kind: "retail", title: "Retail sales", importance: "medium", detail: "What consumers spent in stores and online, the month before." },
  { match: /^Advance Report on Durable Goods/i, kind: "durables", title: "Durable goods orders", importance: "medium", detail: "Orders for long-lasting goods, a read on business investment." },
];

export function censusEvents(releases: CensusRelease[], currentYear: number): MarketEvent[] {
  return releases.flatMap((entry) => {
    const release = CENSUS_RELEASES.find((candidate) => candidate.match.test(entry.indicator));
    if (!release) return [];
    const year = Number(entry.date.slice(0, 4));
    return [marketEvent({
      kind: release.kind,
      importance: release.importance,
      detail: release.detail,
      title: `${release.title}, ${entry.period}`,
      date: entry.date,
      time: entry.time,
      category: "data",
      source: { label: "Census Bureau", url: SOURCE_URLS.census(year === currentYear ? year : undefined) },
    })];
  });
}

// --- US politics: dates set by law ----------------------------------------------------------------------

// Federal elections are on the Tuesday after the first Monday in November (2 U.S.C. § 7).
export function electionDay(year: number): string {
  const firstMonday = 1 + ((8 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7);
  return isoDate(year, 10, firstMonday + 1);
}

function ordinal(value: number): string {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th";
  return `${value}${suffix}`;
}

const AMENDMENT_XX = { label: "20th Amendment", url: "https://www.archives.gov/founding-docs/amendments-11-27" };

// Elections, new Congresses, inaugurations and fiscal-year deadlines from `fromYear` for `years` years.
export function usPoliticalEvents(fromYear: number, years: number): MarketEvent[] {
  const events: MarketEvent[] = [];
  for (let year = fromYear; year < fromYear + years; year++) {
    if (year % 2 === 0) {
      const presidential = year % 4 === 0;
      events.push(marketEvent({
        kind: "election",
        date: electionDay(year),
        category: "politics",
        importance: "high",
        title: presidential ? "US presidential election" : "US midterm elections",
        detail: presidential
          ? "The presidency, all 435 House seats and a third of the Senate are on the ballot."
          : "All 435 House seats, a third of the Senate and most governors are on the ballot.",
        source: { label: "USAGov", url: "https://www.usa.gov/when-to-vote" },
      }));
    } else {
      // Congresses run two years from 1789; the one elected in November meets on January 3.
      events.push(marketEvent({
        kind: "congress",
        date: isoDate(year, 0, 3),
        category: "politics",
        importance: "medium",
        title: `The ${ordinal((year - 1789) / 2 + 1)} Congress convenes`,
        detail: "Members elected in November take their seats, at noon unless Congress sets another day by law.",
        source: AMENDMENT_XX,
      }));
      if (year % 4 === 1) {
        events.push(marketEvent({
          kind: "inauguration",
          date: isoDate(year, 0, 20),
          category: "politics",
          importance: "high",
          title: "Presidential inauguration",
          detail: "The president elected in November takes office at noon.",
          source: AMENDMENT_XX,
        }));
      }
    }
    events.push(marketEvent({
      kind: "fiscal-year",
      date: isoDate(year, 8, 30),
      category: "politics",
      importance: "medium",
      title: `Fiscal ${year} ends: funding deadline`,
      detail: `Unless fiscal ${year + 1} funding is already law, Congress must pass spending bills or a stopgap or the government shuts down on October 1.`,
      source: { label: "31 U.S.C. § 1102", url: "https://www.law.cornell.edu/uscode/text/31/1102" },
    }));
  }
  return events;
}

// --- Elections abroad -------------------------------------------------------------------------------------

// The G20 economies and a few others whose votes US markets watch; the G7's count as high impact.
const MAJOR_ECONOMIES = new Set([
  "Argentina", "Australia", "Brazil", "Canada", "China", "France", "Germany", "India", "Indonesia", "Italy", "Japan",
  "Mexico", "Russia", "Saudi Arabia", "South Africa", "South Korea", "Turkey", "United Kingdom",
  "Israel", "Netherlands", "Poland", "Spain", "Taiwan", "Ukraine",
]);
const G7 = new Set(["Canada", "France", "Germany", "Italy", "Japan", "United Kingdom"]);

export function electionEvents(elections: NationalElection[]): MarketEvent[] {
  return elections.filter((election) => MAJOR_ECONOMIES.has(election.country)).map((election) => marketEvent({
    kind: "election",
    date: election.date,
    monthOnly: election.monthOnly,
    category: "global",
    importance: G7.has(election.country) ? "high" : "medium",
    title: election.article,
    detail: `${election.country} votes for: ${election.offices}.`,
    source: { label: "Wikipedia", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(election.article.replace(/ /g, "_"))}` },
  }));
}

// --- All together -----------------------------------------------------------------------------------------

// How far back the timeline reaches, so recent decisions and their outcomes stay in view.
export const PAST_DAYS = 45;
// Elections and other dates set by law, years ahead.
const POLITICAL_YEARS = 4;

function minutesOfDay(time: string | null): number {
  const match = time ? /^(\d{1,2}):(\d{2}) ([AP])M$/.exec(time) : null;
  return match ? (Number(match[1]) % 12) * 60 + Number(match[2]) + (match[3] === "P" ? 720 : 0) : -1;
}

export function compareEvents(left: MarketEvent, right: MarketEvent): number {
  return left.date.localeCompare(right.date)
    || minutesOfDay(left.time) - minutesOfDay(right.time)
    || (left.importance === right.importance ? 0 : left.importance === "high" ? -1 : 1)
    || left.title.localeCompare(right.title);
}

export type FedSnapshot = {
  lower: number;
  upper: number;
  asOf: string;
  // The last change: the decision day when a meeting matches it, else the day it took effect.
  lastChange: { date: string; change: number } | null;
};

export type MarketEventsData = {
  events: MarketEvent[];
  today: string;
  fed: FedSnapshot | null;
  // Sources that didn't load, named for the page.
  missing: string[];
};

function fedSnapshot(target: FedTarget, meetings: FomcMeeting[]): FedSnapshot {
  const [previous, last] = target.changes.slice(-2);
  const lastChange = previous && last
    ? {
        // The decision whose next week saw the change.
        date: meetings.find((meeting) => meeting.end < last.date && addDays(meeting.end, 7) >= last.date)?.end ?? last.date,
        change: Math.round((last.upper - previous.upper) * 100) / 100,
      }
    : null;
  const current = target.changes.at(-1)!;
  return { lower: current.lower, upper: current.upper, asOf: target.asOf, lastChange };
}

export async function getMarketEvents(now = new Date()): Promise<MarketEventsData> {
  const today = easternToday(now);
  const year = Number(today.slice(0, 4));
  const [meetings, target, bls, bea, census, electionsNow, electionsNext] = await Promise.all([
    getFomcMeetings(),
    getFedTarget(),
    getCalendarFeed(SOURCE_URLS.bls),
    getCalendarFeed(SOURCE_URLS.bea),
    getCensusReleases(year),
    getNationalElections(year),
    getNationalElections(year + 1),
  ]);

  const from = addDays(today, -PAST_DAYS);
  const events = [
    ...fedEvents(meetings ?? [], target, today),
    ...blsEvents(bls ?? []),
    ...beaEvents(bea ?? []),
    ...censusEvents(census ?? [], year),
    ...usPoliticalEvents(year, POLITICAL_YEARS),
    ...electionEvents([...(electionsNow ?? []), ...(electionsNext ?? [])]),
  ]
    .filter((event) => (event.endDate ?? event.date) >= from)
    .sort(compareEvents);

  const missing = [
    !meetings && "the Fed's meeting calendar",
    !target && "FRED's fed funds target",
    !bls && "BLS's release calendar",
    !bea && "BEA's release calendar",
    !census && "Census's release calendar",
    !electionsNow && !electionsNext && "Wikipedia's electoral calendar",
  ].filter((name): name is string => !!name);

  return { events, today, fed: target ? fedSnapshot(target, meetings ?? []) : null, missing };
}
