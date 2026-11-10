import { getDocumentProxy } from "unpdf";

// A PDF's text as rows of cells, for reading a broker's statement. pdf.js (through unpdf, which runs it without a
// worker on the server) gives each piece of text with its position; pieces on the same line make a row, read left
// to right. Trading 212's tables put each cell in its own piece, so a row's cells are its columns.

export type TextItem = { str: string; x: number; y: number };

// A statement runs to a few hundred pages at most; anything longer isn't one.
const MAX_PAGES = 2000;

export function rowsFromItems(items: TextItem[]): string[][] {
  const rows: { y: number; cells: { x: number; str: string }[] }[] = [];
  for (const item of items) {
    const str = item.str.trim();
    if (!str) continue;
    // Within a point counts as the same line.
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 1);
    if (!row) {
      row = { y: item.y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x: item.x, str });
  }
  // PDF coordinates grow upwards, so the top of the page comes first.
  return rows.sort((top, bottom) => bottom.y - top.y).map((row) => row.cells.sort((left, right) => left.x - right.x).map((cell) => cell.str));
}

// Every page's pieces of text with their positions, in order. Throws when pdf.js can't read the file.
export async function readPdfItems(data: Uint8Array): Promise<TextItem[][]> {
  // Errors only: a broken upload shouldn't fill the server's log with pdf.js warnings.
  const pdf = await getDocumentProxy(data, { verbosity: 0 });
  try {
    if (pdf.numPages > MAX_PAGES) throw new Error(`The PDF has ${pdf.numPages} pages.`);
    const pages: TextItem[][] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      pages.push(content.items.flatMap((item): TextItem[] => ("str" in item ? [{ str: item.str, x: item.transform[4], y: item.transform[5] }] : [])));
    }
    return pages;
  } finally {
    // Lets go of the document: this pdf.js frees it through its loading task.
    await pdf.loadingTask.destroy();
  }
}

// Every page's rows, in order.
export async function readPdfRows(data: Uint8Array): Promise<string[][]> {
  return (await readPdfItems(data)).flatMap(rowsFromItems);
}
