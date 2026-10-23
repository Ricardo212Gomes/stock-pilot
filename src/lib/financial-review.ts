import {
  STATEMENTS,
  type StatementId,
  type StatementTable,
  type ValueFormat,
} from "./financial-statements";

// Every statement tab gets an AI review; the charts-only Financials tab doesn't.
export type ReviewStatement = StatementId;

export const REVIEW_STATEMENTS: ReviewStatement[] = ["income", "balance", "cash-flow", "ratios"];

export function isReviewStatement(value: unknown): value is ReviewStatement {
  return REVIEW_STATEMENTS.some((statement) => statement === value);
}

export function reviewLabel(statement: ReviewStatement): string {
  return STATEMENTS.find((item) => item.id === statement)!.title;
}

// What a careful analyst reads each statement for.
const FOCUS: Record<ReviewStatement, string> = {
  income: [
    "Focus on how the business earns money: revenue growth, gross, operating and profit margins,",
    "how research and SG&A spending move against revenue, and whether EPS grows faster than net income",
    "because the share count is falling.",
  ].join(" "),
  balance: [
    "Focus on financial strength: cash and short-term investments against short-term debt and current",
    "liabilities, total debt and net cash (debt), how shareholders' equity and book value per share change,",
    "and anything unusual in what the company owns.",
  ].join(" "),
  "cash-flow": [
    "Focus on cash generation and use: operating cash flow against net income, capital expenditures,",
    "free cash flow and its margin, and how the cash is spent on dividends, share repurchases and debt.",
    "Mention stock-based compensation if it is large.",
  ].join(" "),
  ratios: [
    "Focus on three groups: valuation (PE, PS, PB and P/FCF ratios and dividend yield compared with their own history),",
    "profitability (margins, return on equity and on assets) and financial health (current ratio, debt to equity,",
    "interest coverage). Briefly say what each ratio you mention means.",
  ].join(" "),
};

export function reviewInstructions(statement: ReviewStatement): string {
  return [
    `You are an objective equity research assistant explaining a company's ${statement === "ratios" ? "financial ratios" : reviewLabel(statement).toLowerCase()} in plain language.`,
    "Address the reader directly and never mention their experience level.",
    FOCUS[statement],
    "Use only the supplied figures. Do not invent facts, news or reasons that are not in the data.",
    "Figures are already formatted; quote them exactly as written. Null means unavailable.",
    "Don't list every period: compare the newest period with the previous one and the oldest, using at most",
    "six figures in total.",
    "Write about 120 words of plain text with no Markdown, in three short paragraphs:",
    "what this statement shows, the most important trends, and what to watch.",
    "Do not give a buy, sell or price recommendation.",
  ].join(" ");
}

// Formatted like the page ("$466.8B", "+6.4%"), so the model quotes readable figures
// instead of raw numbers such as 466823000000 or 0.0643.
export function formatForPrompt(value: number | null, format: ValueFormat, currency: string): string | null {
  if (value === null) return null;
  const money = (options: Intl.NumberFormatOptions) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, ...options }).format(value);
    } catch {
      return `${new Intl.NumberFormat("en-US", options).format(value)} ${currency}`;
    }
  };
  switch (format) {
    case "money":
      return money({ notation: "compact", maximumFractionDigits: 1 });
    case "shares":
      return `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)} shares`;
    case "perShare":
      return money({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "growth":
      return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
    case "ratio":
      return value.toFixed(2);
  }
}

export function buildReviewPrompt({ symbol, table }: { symbol: string; table: StatementTable }): string {
  const statement = {
    columns: table.columns.map((column) => `${column.label}${column.periodEnding ? ` (${column.periodEnding})` : ""}`),
    rows: table.rows.map((row) => ({
      item: row.label,
      values: row.values.map((value) => formatForPrompt(value, row.format, table.currency)),
    })),
  };
  return [
    `Explain ${symbol}'s ${reviewLabel(table.statement as ReviewStatement)} (${table.period} periods, newest first; TTM means trailing twelve months).`,
    JSON.stringify(statement),
  ].join("\n\n");
}

// Models sometimes add Markdown despite the instructions; the panel shows plain paragraphs.
export function reviewParagraphs(text: string): string[] {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}
