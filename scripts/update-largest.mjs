// Rebuilds src/data/largest-us-companies.json: the largest US companies by market cap, from Finnhub's
// free company profiles. The Stocks page falls back to it when FMP's screener isn't available (some
// plans don't include it, and every plan has a daily limit). Run it now and then, and commit the file.
import { writeFile } from "node:fs/promises";

const OUTPUT = "src/data/largest-us-companies.json";
const KEEP = 100;
// Finnhub's free plan allows 60 requests a minute.
const DELAY_MS = 1100;

// US companies that are, or were recently, among the largest ~150 by market cap. Add newcomers here;
// the ranking itself comes from Finnhub.
const CANDIDATES = `
NVDA AAPL MSFT GOOGL GOOG AMZN META AVGO TSLA BRK-B LLY JPM WMT V ORCL MA XOM NFLX COST JNJ PLTR HD ABBV
BAC PG AMD UNH KO GE CVX CSCO WFC IBM PM MS GS CRM ABT MU AXP MCD LIN RTX TMUS CAT MRK PEP DIS UBER T
INTU NOW BX VZ BKNG TMO C SCHW ISRG QCOM BLK GEV ANET AMGN TXN SPGI BA ADBE LRCX NEE ACN AMAT APH SYK
PGR ETN DHR KLAC PANW PFE LOW HON UNP GILD COF KKR DE INTC CRWD ADP MDT COP APP CMCSA LMT ADI MO NKE
SNPS CB CEG SO DASH ICE MMC PLD WELL SBUX CVS CME TT DUK BMY AMT HOOD MCK PH MSTR CDNS ABNB COIN SNOW
DELL NEM MCO WM HCA ORLY SHW GD NOC EQIX FI ELV ZTS ITW AJG MMM MRVL USB PNC CI TDG EMR RCL ECL VRTX
REGN BSX SPOT NET FTNT HWM CTAS APO
`.trim().split(/\s+/);

const apiKey = process.env.FINNHUB_API_KEY;
if (!apiKey) {
  console.error("Set FINNHUB_API_KEY in .env first.");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function profile(symbol) {
  // Finnhub writes share classes with a dot (BRK.B).
  const url = new URL("https://finnhub.io/api/v1/stock/profile2");
  url.searchParams.set("symbol", symbol.replace(/-/g, "."));
  const response = await fetch(url, { headers: { "X-Finnhub-Token": apiKey } });
  if (!response.ok) throw new Error(`${symbol}: Finnhub returned ${response.status}`);
  return response.json();
}

const companies = [];
for (const [index, symbol] of [...new Set(CANDIDATES)].entries()) {
  if (index > 0) await sleep(DELAY_MS);
  try {
    const data = await profile(symbol);
    // Finnhub reports market cap in millions, and an empty object for unknown symbols.
    const marketCap = typeof data.marketCapitalization === "number" ? data.marketCapitalization * 1e6 : null;
    if (!data.name || !marketCap || data.country !== "US") {
      console.warn(`Skipped ${symbol}: ${data.name ? `${data.country ?? "no country"}` : "no profile"}`);
      continue;
    }
    companies.push({ symbol, name: data.name, sector: data.finnhubIndustry || null, marketCap: Math.round(marketCap) });
  } catch (error) {
    console.warn(`Skipped ${error.message}`);
  }
}

companies.sort((left, right) => right.marketCap - left.marketCap);
const asOf = new Date().toISOString().slice(0, 10);
await writeFile(OUTPUT, `${JSON.stringify({ asOf, companies: companies.slice(0, KEEP) }, null, 2)}\n`);
console.log(`Wrote the ${Math.min(KEEP, companies.length)} largest of ${companies.length} companies to ${OUTPUT} (${asOf}).`);
