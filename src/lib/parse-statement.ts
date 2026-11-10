import { rowsFromItems, type TextItem } from "./statement-pdf";
import type { Statement } from "./statements";
import { parseTradeRepublic } from "./trade-republic";
import { parseTrading212 } from "./trading212";

// Whichever broker's statement a PDF's text is (see lib/statements.ts), or null for anything else.
export function parseStatement(pages: TextItem[][]): Statement | null {
  return parseTrading212(pages.flatMap(rowsFromItems)) ?? parseTradeRepublic(pages);
}
