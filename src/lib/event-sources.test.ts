import { describe, expect, it } from "vitest";
import {
  decisionOutcome,
  easternDateTime,
  parseCensusCalendar,
  parseElectoralCalendar,
  parseFedTarget,
  parseFomcCalendar,
  parseIcs,
} from "./event-sources";

const meetingRow = (month: string, date: string) => `
  <div class="row fomc-meeting">
    <div class="fomc-meeting--shaded fomc-meeting__month col-xs-5 col-sm-3 col-md-2"><strong>${month}</strong></div>
    <div class="fomc-meeting__date col-xs-4 col-sm-9 col-md-10 col-lg-1">${date}</div>
  </div>`;

describe("parseFomcCalendar", () => {
  it("reads each year's meetings, their decision day and whether they publish projections", () => {
    const html = `
      <h4><a id="1">2026 FOMC Meetings</a></h4>${meetingRow("January", "27-28")}${meetingRow("March", "17-18*")}${meetingRow("August", "22 (notation vote)")}
      <h4><a id="2">2027 FOMC Meetings</a></h4>${meetingRow("April/May", "30-1*")}${meetingRow("December", "7-8*")}`;
    expect(parseFomcCalendar(html)).toEqual([
      { start: "2026-01-27", end: "2026-01-28", projections: false },
      { start: "2026-03-17", end: "2026-03-18", projections: true },
      { start: "2027-04-30", end: "2027-05-01", projections: true },
      { start: "2027-12-07", end: "2027-12-08", projections: true },
    ]);
  });
});

describe("parseFedTarget and decisionOutcome", () => {
  const target = parseFedTarget([
    "observation_date,DFEDTARU,DFEDTARL",
    "2026-09-15,3.75,3.50",
    "2026-09-16,3.75,3.50",
    "2026-09-17,4.00,3.75",
    "2026-09-18,.,.",
    "2026-10-29,4.00,3.75",
    "2026-11-06,4.00,3.75",
  ].join("\n"))!;

  it("keeps each change of the range and the last day with data", () => {
    expect(target.changes).toEqual([
      { date: "2026-09-15", lower: 3.5, upper: 3.75 },
      { date: "2026-09-17", lower: 3.75, upper: 4 },
    ]);
    expect(target.asOf).toBe("2026-11-06");
  });

  it("matches a meeting to the change that took effect in the following week", () => {
    expect(decisionOutcome("2026-09-16", target)).toEqual({ action: "raised", lower: 3.75, upper: 4, change: 0.25 });
    expect(decisionOutcome("2026-10-28", target)).toEqual({ action: "held", lower: 3.75, upper: 4, change: 0 });
    // FRED hasn't caught up with this decision yet.
    expect(decisionOutcome("2026-11-06", target)).toBeNull();
  });
});

describe("parseIcs", () => {
  it("unfolds long lines, unescapes text and converts UTC times to Eastern", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;TZID=US-Eastern:20261110T083000",
      "SUMMARY:Consumer Price Index",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE-TIME:20261125T133000Z",
      "SUMMARY:GDP (Second Estimate) and Corporate Profits\\, 3rd Quarter",
      "  2026",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    expect(parseIcs(ics)).toEqual([
      { date: "2026-11-10", time: "8:30 AM", summary: "Consumer Price Index" },
      { date: "2026-11-25", time: "8:30 AM", summary: "GDP (Second Estimate) and Corporate Profits, 3rd Quarter 2026" },
    ]);
  });

  it("follows daylight saving time and the date line", () => {
    expect(easternDateTime("20260715T123000Z")).toEqual({ date: "2026-07-15", time: "8:30 AM" });
    expect(easternDateTime("20261201T030000Z")).toEqual({ date: "2026-11-30", time: "10:00 PM" });
    expect(easternDateTime("20261201")).toEqual({ date: "2026-12-01", time: null });
  });
});

describe("parseCensusCalendar", () => {
  it("reads the indicator, date, time and period from each row", () => {
    const html = `<table><tr><th>Indicator</th><th>Release Date</th><th>Time</th><th>Period Covered</th></tr>
      <tr><td><a href="#">Advance Monthly Sales for Retail and Food Services</a></td><td>November 17, 2026</td><td>8:30 AM</td><td>October 2026</td><td>x</td></tr>
      <tr><td>Construction Spending</td><td>December 1, 2026</td><td>10:00 AM</td><td>October 2026</td></tr></table>`;
    expect(parseCensusCalendar(html)).toEqual([
      { indicator: "Advance Monthly Sales for Retail and Food Services", date: "2026-11-17", time: "8:30 AM", period: "October 2026" },
      { indicator: "Construction Spending", date: "2026-12-01", time: "10:00 AM", period: "October 2026" },
    ]);
  });
});

describe("parseElectoralCalendar", () => {
  it("reads dated, nested and month-only entries and skips the rest", () => {
    const wikitext = [
      "Intro text",
      "==January==",
      "* 16 January: [[Elections in Nigeria|Nigeria]], [[2027 Nigerian general election|President, Senate and House]]<ref>{{cite web|url=x}}</ref>",
      "==March==",
      "* March: [[Estonia]], [[Next Estonian parliamentary election|Parliament]]",
      "* 6 March ''[[Elections in Northern Cyprus|Northern Cyprus]], [[2027 Northern Cypriot election|Assembly]]''",
      "==April==",
      "* 18 April:",
      "** [[Elections in France|France]], [[2027 French presidential election|President]]<ref name=\"a\" />",
      "** ''[[Somaliland]], [[2027 Somaliland election|Parliament]]''",
      "==Indirect elections==",
      "* 9 December: [[Elections in Switzerland|Switzerland]], [[2027 Swiss Federal Council election|Federal Council]]",
      "==Unknown date==",
      "* [[Elections in Bahrain|Bahrain]], [[Next Bahraini general election|Parliament]]",
    ].join("\n");
    expect(parseElectoralCalendar(wikitext, 2027)).toEqual([
      { date: "2027-01-16", monthOnly: false, country: "Nigeria", article: "2027 Nigerian general election", offices: "President, Senate and House" },
      { date: "2027-03-01", monthOnly: true, country: "Estonia", article: "Next Estonian parliamentary election", offices: "Parliament" },
      { date: "2027-04-18", monthOnly: false, country: "France", article: "2027 French presidential election", offices: "President" },
    ]);
  });
});
