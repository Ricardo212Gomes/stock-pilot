// Rebuilds src/data/us-stocks.json from Nasdaq's public symbol directory (no API key).
// The app searches this file in the browser, so typing in the search box makes no requests.
import { writeFile } from "node:fs/promises";

const SOURCES = {
  nasdaq: "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
  other: "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
};
// Not ordinary shares: warrants, rights, units, preferred shares, notes and the like.
const EXCLUDED_NAME = /\b(warrants?|rights?|units?|preferred|preference|notes?|debentures?|ETNs?|exchange traded notes?|due|subordinated)\b|%/i;
// Lower tiers come first when names tie: Nasdaq Global Select and NYSE, then the rest.
const NASDAQ_TIER = { Q: 0, G: 1, S: 2 };
const OTHER_TIER = { N: 0, P: 1, A: 2, Z: 2, V: 2 };

async function rows(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  const header = lines[0].split("|");
  // The last line is "File Creation Time: …".
  return lines.slice(1, -1).map((line) => Object.fromEntries(line.split("|").map((value, index) => [header[index], value])));
}

export function cleanName(raw) {
  return raw
    .split(" - ")[0]
    .replace(/\s*\(The\)/i, "")
    .replace(/\s+(New\s+)?(Class [A-Z]\s+)?(Common Stock|Common Shares?|Ordinary Shares?|Subordinate Voting Shares|Shares of Beneficial Interest|American Depositary Shares|American Depository Shares|ADS|ADRs?)\b.*$/i, "")
    .replace(/[\s,]+$/, "")
    .trim();
}

const stocks = new Map();
function add(symbol, name, tier) {
  // Share classes use a dash in the app and FMP (BRK-B), a dot in the directory (BRK.B).
  const appSymbol = symbol.replace(/\./g, "-");
  if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(appSymbol) || EXCLUDED_NAME.test(name)) return;
  const clean = cleanName(name);
  if (clean && !stocks.has(appSymbol)) stocks.set(appSymbol, [appSymbol, clean, tier]);
}

for (const row of await rows(SOURCES.nasdaq)) {
  if (row["Test Issue"] === "N" && row.ETF === "N") add(row.Symbol, row["Security Name"], NASDAQ_TIER[row["Market Category"]] ?? 2);
}
for (const row of await rows(SOURCES.other)) {
  if (row["Test Issue"] === "N" && row.ETF === "N") add(row["ACT Symbol"], row["Security Name"], OTHER_TIER[row.Exchange] ?? 2);
}

const list = [...stocks.values()].sort((left, right) => left[0].localeCompare(right[0]));
await writeFile(new URL("../src/data/us-stocks.json", import.meta.url), `${JSON.stringify(list)}\n`);
console.log(`Saved ${list.length} US stocks to src/data/us-stocks.json.`);
