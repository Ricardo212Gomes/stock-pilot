import type { TextItem } from "./statement-pdf";
import { numberRepeats, type Money, type Statement, type StatementDividend, type StatementInterest, type StatementTrade } from "./statements";

// Trade Republic's account statement (the app's "account statement" PDF), read from the positions of its text
// (see lib/statement-pdf.ts). It's one table of cash movements: date, type, description, money in, money out and
// balance. A trade is a description ("Buy trade US0231351067 AMAZON.COM INC. DL-,01, quantity: 5") with what it
// cost or brought in, fees included; interest and dividends are their own rows. It lists no open positions and
// no order ids, so what's held is what the trades add up to, and ids come from each row's own fields.
//
// Each row is a band of lines: the day and month above the year in the date column, the type and amounts in the
// middle, the description on one line or wrapped over two. The column headers, in whatever language, mark where
// each column starts.

const ISIN = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/;
// The same three lines in a row: the date's two and the description's wrap fit in this.
const BAND = 14;

// Month names and abbreviations, without accents, in Trade Republic's languages.
const MONTHS: string[][] = [
  ["jan", "janv", "january", "janeiro", "januar", "ene", "enero", "janvier", "gen", "gennaio"],
  ["feb", "fev", "fevr", "february", "fevereiro", "februar", "febrero", "fevrier", "febbraio"],
  ["mar", "mars", "march", "marco", "marz", "maerz", "marzo"],
  ["apr", "abr", "avr", "april", "abril", "avril", "aprile"],
  ["may", "mai", "maio", "mayo", "mag", "maggio"],
  ["jun", "juin", "june", "junho", "juni", "junio", "giu", "giugno"],
  ["jul", "juil", "july", "julho", "juli", "julio", "juillet", "lug", "luglio"],
  ["aug", "ago", "aou", "aout", "august", "agosto"],
  ["sep", "sept", "set", "september", "setembro", "septiembre", "septembre", "settembre"],
  ["oct", "out", "okt", "october", "outubro", "oktober", "octubre", "octobre", "ott", "ottobre"],
  ["nov", "november", "novembro", "noviembre", "novembre"],
  ["dec", "dez", "dic", "december", "dezembro", "dezember", "diciembre", "decembre", "dicembre"],
];

function monthOf(word: string): number | null {
  const plain = word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.$/, "");
  const index = MONTHS.findIndex((names) => names.includes(plain));
  return index === -1 ? null : index + 1;
}

// "16 out." and "2026" → "2026-10-16".
function dateOf(day: string, month: string, year: string): string | null {
  const number = monthOf(month);
  const date = Number(day);
  if (!number || date < 1 || date > 31) return null;
  return `${year}-${String(number).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

const DAY_MONTH = /^(\d{1,2})\.?\s+(\p{L}+\.?)(?:\s+(\d{4}))?$/u;
const PERIOD = /(\d{1,2})\.?\s+(\p{L}+)\.?\s+(\d{4})\s*[-–]\s*(\d{1,2})\.?\s+(\p{L}+)\.?\s+(\d{4})/u;
const MONEY = /-?\s?€\s?\d[\d.,\s  ]*\d|-?\d[\d.,\s  ]*\s?€/g;

// "1 120,29 €", "€1,120.29", "1.120,29 €"; the last separator before two digits is the decimal one.
export function amountOf(text: string): number | null {
  const negative = /^\s*-/.test(text);
  const digits = text.replace(/[€\s  -]/g, "");
  if (!/^\d[\d.,]*$/.test(digits)) return null;
  const decimal = /[.,](\d{1,2})$/.exec(digits);
  const whole = (decimal ? digits.slice(0, decimal.index) : digits).replace(/[.,]/g, "");
  const value = Number(decimal ? `${whole}.${decimal[1]}` : whole);
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

// "5", "1.5", "0.067899"; "1,5" too.
function quantityOf(text: string): number | null {
  const normal = text.includes(".") ? text.replace(/,/g, "") : text.replace(",", ".");
  const value = Number(normal);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// "AMAZON.COM INC. DL-,01" → "AMAZON.COM INC.", without the share's par value; a fund's
// "iShares VII plc - iShares Core S&P 500 UCITS ETF USD (Acc)" → the fund's own name.
function cleanName(name: string): string {
  const own = name.includes(" - ") ? name.slice(name.lastIndexOf(" - ") + 3) : name;
  return own.replace(/\s*\b[A-Z]{2}\s?-?,\d+$/, "").trim() || name.trim();
}

function caps(text: string): boolean {
  return /\p{Lu}/u.test(text) && /^[\p{Lu}\s.()&/-]+$/u.test(text.trim());
}

// The transactions table's six column starts (date, type, description, money in, money out, balance): the
// header's capitalized words, two lines high for "money in" and "money out". The summary table above has five.
function columnsOf(items: TextItem[]): { y: number; starts: number[] } | null {
  const headers = items.filter((item) => caps(item.str));
  for (const seed of headers) {
    const near = headers.filter((item) => Math.abs(item.y - seed.y) <= 4);
    const starts: number[] = [];
    for (const x of near.map((item) => item.x).sort((left, right) => left - right)) {
      if (starts.length === 0 || x - starts[starts.length - 1] > 3) starts.push(x);
    }
    if (starts.length === 6) return { y: Math.min(...near.map((item) => item.y)), starts };
  }
  return null;
}

export type TradeRepublicRow = { date: string; type: string; description: string; moneyIn: number | null; moneyOut: number | null; balance: number | null };

// One page's transactions, in the statement's order.
export function tradeRepublicRows(items: TextItem[]): TradeRepublicRow[] {
  const columns = columnsOf(items);
  if (!columns) return [];
  const [dateX, typeX, descriptionX, inX, outX, balanceX] = columns.starts;
  const below = items.filter((item) => item.y < columns.y - 2 && item.str.trim());
  const inDateColumn = (item: TextItem) => Math.abs(item.x - dateX) <= 6;
  const rows: TradeRepublicRow[] = [];
  for (const dayItem of below.filter((item) => inDateColumn(item) && DAY_MONTH.test(item.str.trim()))) {
    const [, day, month, sameYear] = DAY_MONTH.exec(dayItem.str.trim())!;
    const yearItem = sameYear
      ? null
      : below.find((item) => inDateColumn(item) && /^\d{4}$/.test(item.str.trim()) && item.y < dayItem.y && dayItem.y - item.y < BAND);
    const year = sameYear ?? yearItem?.str.trim();
    const date = year ? dateOf(day, month, year) : null;
    if (!date) continue;
    const bottom = (yearItem?.y ?? dayItem.y - BAND / 2) - 2;
    const band = below
      .filter((item) => item !== dayItem && item !== yearItem && item.y <= dayItem.y + 2 && item.y >= bottom)
      .sort((left, right) => right.y - left.y || left.x - right.x);
    const type = band.filter((item) => item.x >= typeX - 4 && item.x < descriptionX - 4).map((item) => item.str.trim()).join(" ");
    const description = band.filter((item) => item.x >= descriptionX - 4 && item.x < inX - 12).map((item) => item.str.trim()).join(" ");
    // Amounts go to the nearest column; one piece of text can hold two (what went out, then the balance).
    const amounts: (number | null)[] = [null, null, null];
    for (const item of band.filter((entry) => entry.x >= inX - 12)) {
      const nearest = [inX, outX, balanceX].map((x) => Math.abs(item.x - x));
      let column = nearest.indexOf(Math.min(...nearest));
      for (const token of item.str.match(MONEY) ?? []) {
        if (column < 3) amounts[column] = amountOf(token);
        column++;
      }
    }
    rows.push({ date, type, description, moneyIn: amounts[0], moneyOut: amounts[1], balance: amounts[2] });
  }
  return rows;
}

const TRADE = /^(Buy|Sell) trade ([A-Z]{2}[A-Z0-9]{9}\d) (.+?),? quantity: ([\d.,]+)$/i;
const PLAN = /^((?:Savings plan|Saveback|Round ?up) execution) ([A-Z]{2}[A-Z0-9]{9}\d) (.+?),? quantity: ([\d.,]+)$/i;
const INTEREST_TYPES = /^(Juros|Interest|Zinsen|Intereses|Int[eé]r[eê]ts|Interessi)$/i;
const DIVIDEND = /dividend|distribution|aussch|ertrag|rendimento/i;

// Null when the text isn't a Trade Republic account statement.
export function parseTradeRepublic(pages: TextItem[][]): Statement | null {
  const all = pages.flat();
  if (!all.some((item) => /trade republic/i.test(item.str))) return null;
  const rows = pages.flatMap(tradeRepublicRows);
  if (rows.length === 0) return null;

  const period = all.map((item) => PERIOD.exec(item.str)).find(Boolean);
  const from = period ? dateOf(period[1], period[2], period[3]) : null;
  const to = period ? dateOf(period[4], period[5], period[6]) : null;

  const currency = "EUR";
  const money = (amount: number): Money => ({ amount, currency });
  const tradeKey = numberRepeats();
  const incomeKey = numberRepeats();
  const trades: StatementTrade[] = [];
  const dividends: StatementDividend[] = [];
  const interest: StatementInterest[] = [];
  let otherCash = 0;
  for (const row of rows) {
    const trade = TRADE.exec(row.description);
    const plan = trade ? null : PLAN.exec(row.description);
    if (trade || plan) {
      const [, kind, isin, name, quantity] = (trade ?? plan)!;
      const side = trade && kind.toLowerCase() === "sell" ? "sell" : "buy";
      const shares = quantityOf(quantity);
      const total = side === "buy" ? row.moneyOut : row.moneyIn;
      if (!shares) {
        otherCash++;
        continue;
      }
      const time = `${row.date}T12:00:00Z`;
      trades.push({
        id: tradeKey(`tr:${row.date}:${isin}:${side}:${shares}:${total ?? "-"}`),
        time,
        code: cleanName(name),
        isin,
        side,
        shares,
        // Trade Republic gives what was paid, not the price: the total over the shares stands in.
        price: money(total !== null ? Math.abs(total) / shares : 0),
        accountValue: total !== null ? money(side === "buy" ? -Math.abs(total) : Math.abs(total)) : null,
        result: null,
        orderType: plan ? plan[1] : "Market",
      });
      continue;
    }
    const isin = ISIN.exec(row.description)?.[1];
    if (isin && row.moneyIn !== null && (DIVIDEND.test(row.type) || DIVIDEND.test(row.description))) {
      const shares = quantityOf(/quantity: ([\d.,]+)/i.exec(row.description)?.[1] ?? "") ?? 0;
      dividends.push({ id: incomeKey(`tr:dividend:${row.date}:${isin}:${row.moneyIn}`), code: isin, isin, shares, paidOn: row.date, amount: money(row.moneyIn) });
      continue;
    }
    if (row.moneyIn !== null && (INTEREST_TYPES.test(row.type) || /^interest payment/i.test(row.description))) {
      interest.push({ id: incomeKey(`tr:interest:${row.date}:${row.moneyIn}`), paidOn: row.date, kind: "cash", amount: money(row.moneyIn) });
      continue;
    }
    otherCash++;
  }
  return { broker: "traderepublic", from, to, accountCurrency: currency, trades, positions: [], dividends, interest, otherCash };
}
